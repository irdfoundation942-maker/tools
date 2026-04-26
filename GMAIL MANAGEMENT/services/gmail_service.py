"""Gmail API service layer.

All Gmail-related work (fetching inbox, parsing contacts, finding prior threads,
sending replies vs. new messages) is isolated here so routes stay thin.
"""

from __future__ import annotations

import base64
import logging
import random
import re
import time
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr, getaddresses, parseaddr
from html import unescape
from typing import Callable, Iterable

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

log = logging.getLogger(__name__)

RETRYABLE_STATUS = {429, 500, 502, 503, 504}


class GmailService:
    """Thin wrapper around the Gmail API for this app's use cases."""

    def __init__(self, credentials: Credentials):
        if credentials.expired and credentials.refresh_token:
            credentials.refresh(Request())
        self._creds = credentials
        self._service = build("gmail", "v1", credentials=credentials, cache_discovery=False)
        self._profile_email: str | None = None

    # ------------------------------------------------------------------ utils

    @property
    def profile_email(self) -> str:
        if not self._profile_email:
            profile = self._service.users().getProfile(userId="me").execute()
            self._profile_email = profile.get("emailAddress", "")
        return self._profile_email

    @staticmethod
    def _retry(request_fn: Callable, max_attempts: int = 5):
        """Execute a Google API request with exponential backoff on 429/5xx."""
        delay = 1.0
        last_exc: Exception | None = None
        for attempt in range(1, max_attempts + 1):
            try:
                return request_fn()
            except HttpError as e:
                status = getattr(e.resp, "status", None)
                if status in RETRYABLE_STATUS and attempt < max_attempts:
                    sleep_for = delay + random.uniform(0, 0.5)
                    log.warning(
                        "Gmail API %s, retrying in %.1fs (attempt %d/%d)",
                        status,
                        sleep_for,
                        attempt,
                        max_attempts,
                    )
                    time.sleep(sleep_for)
                    delay = min(delay * 2, 30)
                    last_exc = e
                    continue
                raise
        if last_exc:
            raise last_exc

    # ----------------------------------------------------------------- inbox

    def list_inbox_messages(self, max_results: int = 100, query: str = "") -> list[dict]:
        """Return a list of message stubs from the INBOX."""
        messages: list[dict] = []
        page_token: str | None = None
        remaining = max_results

        while remaining > 0:
            page_size = min(remaining, 100)
            resp = self._retry(
                lambda: self._service.users()
                .messages()
                .list(
                    userId="me",
                    labelIds=["INBOX"],
                    q=query or None,
                    maxResults=page_size,
                    pageToken=page_token,
                )
                .execute()
            )
            batch = resp.get("messages", []) or []
            messages.extend(batch)
            page_token = resp.get("nextPageToken")
            remaining -= len(batch)
            if not page_token or not batch:
                break
        return messages

    def get_message_headers(self, message_id: str, header_names: Iterable[str]) -> dict:
        """Fetch only the requested headers for a message — cheap metadata call."""
        wanted = list(header_names)
        resp = self._retry(
            lambda: self._service.users()
            .messages()
            .get(
                userId="me",
                id=message_id,
                format="metadata",
                metadataHeaders=wanted,
            )
            .execute()
        )
        headers = {h["name"].lower(): h["value"] for h in resp.get("payload", {}).get("headers", [])}
        return {
            "id": resp.get("id"),
            "threadId": resp.get("threadId"),
            "internalDate": int(resp.get("internalDate", 0)),
            "headers": headers,
        }

    def fetch_inbox_contacts(self, max_results: int = 100) -> list[dict]:
        """Return deduped sender contacts extracted from inbox threads.

        Each contact is the latest incoming message from that sender and
        carries enough thread-level metadata for the UI to drive bulk
        actions: ``thread_id``, ``message_id``, ``replied`` (we have sent
        something in that thread), and ``labels`` (user labels attached
        to the thread, resolved to human names).
        """
        stubs = self.list_inbox_messages(max_results=max_results)

        seen: set[str] = set()
        thread_ids: list[str] = []
        for s in stubs:
            tid = s.get("threadId")
            if tid and tid not in seen:
                seen.add(tid)
                thread_ids.append(tid)

        id_to_name, user_label_ids = self._user_labels_maps()
        my_email = self.profile_email.lower()
        contacts: dict[str, dict] = {}

        for tid in thread_ids:
            try:
                thread = self._retry(
                    lambda tid=tid: self._service.users()
                    .threads()
                    .get(
                        userId="me", id=tid, format="metadata",
                        metadataHeaders=["From", "Subject", "Date", "Message-ID"],
                    )
                    .execute()
                )
            except HttpError as e:
                log.warning("Skipping thread %s: %s", tid, e)
                continue

            has_sent = False
            incoming: dict | None = None
            thread_labels: set[str] = set()

            for m in thread.get("messages", []) or []:
                msg_labels = m.get("labelIds", []) or []
                thread_labels.update(msg_labels)
                headers = {
                    h["name"].lower(): h["value"]
                    for h in m.get("payload", {}).get("headers", [])
                }
                from_header = headers.get("from", "")
                name, email = parseaddr(from_header)
                email = (email or "").strip().lower()
                internal_date = int(m.get("internalDate", 0))

                if "SENT" in msg_labels or (email and email == my_email):
                    has_sent = True
                    continue

                if not email:
                    continue

                if not incoming or internal_date >= incoming["_ts"]:
                    incoming = {
                        "name": (name or "").strip() or email.split("@")[0],
                        "email": email,
                        "subject": headers.get("subject", ""),
                        "date": headers.get("date", ""),
                        "_ts": internal_date,
                        "message_id": m.get("id"),
                        "thread_id": tid,
                    }

            if not incoming:
                continue

            key = incoming["email"]
            existing = contacts.get(key)
            if existing and existing["_ts"] >= incoming["_ts"]:
                continue

            incoming["replied"] = has_sent
            incoming["label_ids"] = sorted(l for l in thread_labels if l in user_label_ids)
            incoming["labels"] = [id_to_name[l] for l in incoming["label_ids"] if l in id_to_name]
            contacts[key] = incoming

        sorted_contacts = sorted(contacts.values(), key=lambda c: c["_ts"], reverse=True)
        for c in sorted_contacts:
            c.pop("_ts", None)
        return sorted_contacts

    # ---------------------------------------------------------------- labels

    def _user_labels_maps(self) -> tuple[dict[str, str], set[str]]:
        """Return (id→name map, set of user-created label ids)."""
        resp = self._retry(
            lambda: self._service.users().labels().list(userId="me").execute()
        )
        labels = resp.get("labels", []) or []
        id_to_name = {l["id"]: l.get("name", l["id"]) for l in labels}
        user_ids = {l["id"] for l in labels if l.get("type") == "user"}
        return id_to_name, user_ids

    def list_user_labels(self) -> list[dict]:
        """List user-created labels (excluding Gmail's system labels)."""
        resp = self._retry(
            lambda: self._service.users().labels().list(userId="me").execute()
        )
        labels = resp.get("labels", []) or []
        return sorted(
            [
                {"id": l["id"], "name": l.get("name", l["id"])}
                for l in labels
                if l.get("type") == "user"
            ],
            key=lambda l: l["name"].lower(),
        )

    # ------------------------------------------------------- bulk thread ops

    def archive_threads(self, thread_ids: Iterable[str]) -> int:
        """Remove the INBOX label from each thread. Returns count succeeded."""
        ok = 0
        for tid in thread_ids:
            try:
                self._retry(
                    lambda tid=tid: self._service.users()
                    .threads()
                    .modify(userId="me", id=tid, body={"removeLabelIds": ["INBOX"]})
                    .execute()
                )
                ok += 1
            except HttpError as e:
                log.warning("Archive failed for %s: %s", tid, e)
        return ok

    def trash_threads(self, thread_ids: Iterable[str]) -> int:
        """Move each thread to Trash. Returns count succeeded."""
        ok = 0
        for tid in thread_ids:
            try:
                self._retry(
                    lambda tid=tid: self._service.users()
                    .threads()
                    .trash(userId="me", id=tid)
                    .execute()
                )
                ok += 1
            except HttpError as e:
                log.warning("Trash failed for %s: %s", tid, e)
        return ok

    def modify_thread_labels(
        self,
        thread_ids: Iterable[str],
        add_label_ids: Iterable[str] | None = None,
        remove_label_ids: Iterable[str] | None = None,
    ) -> int:
        """Add and/or remove labels on each thread. Returns count succeeded."""
        body: dict = {}
        if add_label_ids:
            body["addLabelIds"] = list(add_label_ids)
        if remove_label_ids:
            body["removeLabelIds"] = list(remove_label_ids)
        if not body:
            return 0
        ok = 0
        for tid in thread_ids:
            try:
                self._retry(
                    lambda tid=tid: self._service.users()
                    .threads()
                    .modify(userId="me", id=tid, body=body)
                    .execute()
                )
                ok += 1
            except HttpError as e:
                log.warning("Label modify failed for %s: %s", tid, e)
        return ok

    # --------------------------------------------------------- thread lookup

    def find_latest_thread_with(self, email_address: str) -> dict | None:
        """Find the most recent thread that includes `email_address` as a sender.

        Returns dict with threadId, last_received_message_id (RFC Message-ID
        header, not Gmail internal id), last_subject, or None if no prior
        conversation where they emailed the user.
        """
        # Only threads where they sent to us — i.e. we received from them.
        query = f"from:{email_address}"
        resp = self._retry(
            lambda: self._service.users()
            .messages()
            .list(userId="me", q=query, maxResults=1)
            .execute()
        )
        msgs = resp.get("messages") or []
        if not msgs:
            return None

        thread_id = msgs[0]["threadId"]
        thread = self._retry(
            lambda: self._service.users()
            .threads()
            .get(userId="me", id=thread_id, format="metadata",
                 metadataHeaders=["Message-ID", "Subject", "From"])
            .execute()
        )

        last_received = None
        for m in thread.get("messages", []):
            headers = {h["name"].lower(): h["value"] for h in m.get("payload", {}).get("headers", [])}
            from_field = headers.get("from", "")
            _, sender = parseaddr(from_field)
            if sender and sender.lower() == email_address.lower():
                last_received = {
                    "message_id": headers.get("message-id", ""),
                    "subject": headers.get("subject", ""),
                }

        if not last_received or not last_received["message_id"]:
            return None

        return {
            "threadId": thread_id,
            "last_message_id": last_received["message_id"],
            "last_subject": last_received["subject"],
        }

    # ------------------------------------------------------------ send logic

    def _build_raw(self, msg: EmailMessage) -> str:
        return base64.urlsafe_b64encode(msg.as_bytes()).decode()

    @staticmethod
    def _html_to_plain(html: str) -> str:
        """Best-effort HTML → plain-text fallback for multipart messages."""
        if not html:
            return ""
        text = re.sub(r"(?is)<(script|style).*?>.*?</\1>", "", html)
        text = re.sub(r"(?i)<br\s*/?>", "\n", text)
        text = re.sub(r"(?i)</(p|div|h[1-6]|li)>", "\n", text)
        text = re.sub(r"(?i)<li[^>]*>", "• ", text)
        text = re.sub(r"<[^>]+>", "", text)
        text = unescape(text)
        return re.sub(r"\n{3,}", "\n\n", text).strip()

    def _set_body(self, msg: EmailMessage, body: str, is_html: bool) -> None:
        if is_html:
            msg.set_content(self._html_to_plain(body) or " ")
            msg.add_alternative(body, subtype="html")
        else:
            msg.set_content(body)

    def send_new_email(self, to_email: str, subject: str, body: str, is_html: bool = False) -> dict:
        msg = EmailMessage()
        msg["To"] = to_email
        msg["From"] = formataddr(("", self.profile_email))
        msg["Subject"] = subject
        self._set_body(msg, body, is_html)

        return self._retry(
            lambda: self._service.users()
            .messages()
            .send(userId="me", body={"raw": self._build_raw(msg)})
            .execute()
        )

    def send_reply(
        self,
        to_email: str,
        body: str,
        thread_id: str,
        in_reply_to_message_id: str,
        original_subject: str,
        is_html: bool = False,
    ) -> dict:
        subject = original_subject or ""
        if not re.match(r"^re:\s", subject, re.IGNORECASE):
            subject = f"Re: {subject}".strip()

        msg = EmailMessage()
        msg["To"] = to_email
        msg["From"] = formataddr(("", self.profile_email))
        msg["Subject"] = subject
        if in_reply_to_message_id:
            msg["In-Reply-To"] = in_reply_to_message_id
            msg["References"] = in_reply_to_message_id
        self._set_body(msg, body, is_html)

        body_payload = {"raw": self._build_raw(msg), "threadId": thread_id}
        return self._retry(
            lambda: self._service.users()
            .messages()
            .send(userId="me", body=body_payload)
            .execute()
        )


# ---------------------------------------------------------------- campaign

@dataclass
class SendOutcome:
    email: str
    status: str  # "replied" | "new" | "failed"
    detail: str
    thread_id: str | None = None


def run_campaign(
    gmail: GmailService,
    rows: list[dict],
    on_progress: Callable[[dict], None],
    delay_seconds: float = 2.0,
    send_mode: str = "auto",
    override_subject: str = "",
    override_body: str = "",
    body_format: str = "plain",
) -> list[SendOutcome]:
    """Iterate rows, decide reply vs. new, send, and stream progress events.

    send_mode:
      "auto"  — reply if a prior thread with the recipient exists, else new (default)
      "reply" — only reply; mark failed if no prior thread
      "new"   — always send as a brand-new email, ignore any existing thread

    override_subject / override_body:
      When non-empty, replace the per-row CSV values for all rows.
    """
    outcomes: list[SendOutcome] = []
    total = len(rows)
    send_mode = (send_mode or "auto").lower()
    if send_mode not in ("auto", "reply", "new"):
        send_mode = "auto"
    is_html = (body_format or "").lower() == "html" and bool(override_body)

    for idx, row in enumerate(rows, start=1):
        email = (row.get("Email") or "").strip()
        subject = (override_subject.strip() if override_subject else (row.get("Subject") or "").strip())
        body = override_body if override_body else (row.get("Message_Body") or "")

        if not email or "@" not in email:
            outcome = SendOutcome(email=email, status="failed", detail="Invalid email")
            outcomes.append(outcome)
            on_progress({
                "index": idx, "total": total, "email": email,
                "status": "failed", "detail": outcome.detail,
            })
            continue

        try:
            thread_info = None
            if send_mode in ("auto", "reply"):
                thread_info = gmail.find_latest_thread_with(email)

            if send_mode == "reply" and not thread_info:
                raise ValueError("No prior thread to reply to")

            if thread_info and send_mode in ("auto", "reply"):
                gmail.send_reply(
                    to_email=email,
                    body=body,
                    thread_id=thread_info["threadId"],
                    in_reply_to_message_id=thread_info["last_message_id"],
                    original_subject=thread_info["last_subject"] or subject,
                    is_html=is_html,
                )
                outcome = SendOutcome(
                    email=email, status="replied",
                    detail="Replied in existing thread",
                    thread_id=thread_info["threadId"],
                )
            else:
                if not subject:
                    raise ValueError("Subject required for new email")
                resp = gmail.send_new_email(email, subject, body, is_html=is_html)
                outcome = SendOutcome(
                    email=email, status="new",
                    detail="Sent as new email",
                    thread_id=resp.get("threadId"),
                )
        except HttpError as e:
            status = getattr(e.resp, "status", "?")
            outcome = SendOutcome(email=email, status="failed", detail=f"Gmail API {status}: {e}")
        except Exception as e:  # noqa: BLE001
            outcome = SendOutcome(email=email, status="failed", detail=str(e))

        outcomes.append(outcome)
        on_progress({
            "index": idx, "total": total, "email": email,
            "status": outcome.status, "detail": outcome.detail,
            "thread_id": outcome.thread_id,
        })

        if idx < total and delay_seconds > 0:
            time.sleep(delay_seconds)

    return outcomes


# Handy for routes: pulling emails from raw From-header lists, deduped.
def extract_emails(text: str) -> list[str]:
    return [addr.lower() for _, addr in getaddresses([text]) if addr]
