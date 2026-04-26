"""Inbox sync, contact extraction, and CSV export."""

from __future__ import annotations

import logging
from functools import wraps

from flask import Blueprint, Response, jsonify, request, session

from routes.auth import credentials_from_session
from services.csv_service import contacts_to_csv
from services.gmail_service import GmailService

log = logging.getLogger(__name__)
inbox_bp = Blueprint("inbox", __name__)


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        creds = credentials_from_session()
        if not creds:
            return jsonify({"error": "Not authenticated"}), 401
        return view(creds, *args, **kwargs)
    return wrapper


@inbox_bp.route("/contacts")
@login_required
def contacts(creds):
    try:
        max_results = int(request.args.get("max", 100))
    except ValueError:
        max_results = 100
    max_results = max(10, min(max_results, 500))

    try:
        gmail = GmailService(creds)
        # Persist any refreshed token back into the session.
        session["credentials"]["token"] = gmail._creds.token
        session.modified = True
        contacts = gmail.fetch_inbox_contacts(max_results=max_results)
    except Exception as e:  # noqa: BLE001
        log.exception("Failed to fetch inbox contacts")
        return jsonify({"error": str(e)}), 500

    return jsonify({"count": len(contacts), "contacts": contacts})


@inbox_bp.route("/contacts.csv")
@login_required
def contacts_csv(creds):
    try:
        max_results = int(request.args.get("max", 100))
    except ValueError:
        max_results = 100
    max_results = max(10, min(max_results, 500))

    gmail = GmailService(creds)
    contacts = gmail.fetch_inbox_contacts(max_results=max_results)
    csv_text = contacts_to_csv(contacts)

    return Response(
        csv_text,
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=inbox_contacts.csv"},
    )


@inbox_bp.route("/labels")
@login_required
def labels(creds):
    try:
        gmail = GmailService(creds)
        session["credentials"]["token"] = gmail._creds.token
        session.modified = True
        user_labels = gmail.list_user_labels()
    except Exception as e:  # noqa: BLE001
        log.exception("Failed to list labels")
        return jsonify({"error": str(e)}), 500
    return jsonify({"labels": user_labels})


@inbox_bp.route("/bulk", methods=["POST"])
@login_required
def bulk(creds):
    payload = request.get_json(silent=True) or {}
    action = (payload.get("action") or "").strip().lower()
    thread_ids = [t for t in (payload.get("thread_ids") or []) if isinstance(t, str) and t]
    add_label_ids = [l for l in (payload.get("add_label_ids") or []) if isinstance(l, str) and l]
    remove_label_ids = [l for l in (payload.get("remove_label_ids") or []) if isinstance(l, str) and l]

    if action not in ("archive", "delete", "label"):
        return jsonify({"error": "Unknown action"}), 400
    if not thread_ids:
        return jsonify({"error": "No thread_ids provided"}), 400
    if action == "label" and not (add_label_ids or remove_label_ids):
        return jsonify({"error": "Label action requires add_label_ids or remove_label_ids"}), 400

    try:
        gmail = GmailService(creds)
        session["credentials"]["token"] = gmail._creds.token
        session.modified = True
        if action == "archive":
            ok = gmail.archive_threads(thread_ids)
        elif action == "delete":
            ok = gmail.trash_threads(thread_ids)
        else:
            ok = gmail.modify_thread_labels(
                thread_ids,
                add_label_ids=add_label_ids or None,
                remove_label_ids=remove_label_ids or None,
            )
    except Exception as e:  # noqa: BLE001
        log.exception("Bulk %s failed", action)
        return jsonify({"error": str(e)}), 500

    return jsonify({
        "action": action,
        "requested": len(thread_ids),
        "succeeded": ok,
        "failed": len(thread_ids) - ok,
    })
