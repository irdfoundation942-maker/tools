"""CSV upload + campaign execution with live SSE progress."""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from functools import wraps

from flask import Blueprint, Response, current_app, jsonify, request, session
from google.oauth2.credentials import Credentials

from config import Config
from routes.auth import credentials_from_session
from services.csv_service import CSVValidationError, parse_campaign_file
from services.gmail_service import GmailService, run_campaign

log = logging.getLogger(__name__)
campaign_bp = Blueprint("campaign", __name__)


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        creds = credentials_from_session()
        if not creds:
            return jsonify({"error": "Not authenticated"}), 401
        return view(creds, *args, **kwargs)
    return wrapper


# ------------------------------------------------------------ CSV upload

@campaign_bp.route("/upload", methods=["POST"])
@login_required
def upload(_creds):
    if "file" not in request.files:
        return jsonify({"error": "No file field in upload"}), 400
    file = request.files["file"]
    if not file or not file.filename:
        return jsonify({"error": "No file selected"}), 400
    allowed = (".csv", ".xlsx", ".xlsm", ".xltx", ".xltm", ".xls")
    if not file.filename.lower().endswith(allowed):
        return jsonify({"error": "Only .csv or .xlsx files are accepted"}), 400

    try:
        rows = parse_campaign_file(file.filename, file.stream)
    except CSVValidationError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:  # noqa: BLE001
        log.exception("CSV parse failed")
        return jsonify({"error": f"Failed to parse CSV: {e}"}), 400

    session["campaign_rows"] = rows
    session.modified = True

    preview = [
        {k: v for k, v in row.items() if k != "_row"}
        for row in rows[:50]
    ]
    return jsonify({
        "count": len(rows),
        "preview_count": len(preview),
        "preview": preview,
    })


@campaign_bp.route("/rows")
@login_required
def rows(_creds):
    return jsonify({"rows": session.get("campaign_rows", [])})


@campaign_bp.route("/clear", methods=["POST"])
@login_required
def clear(_creds):
    session.pop("campaign_rows", None)
    session.modified = True
    return jsonify({"ok": True})


# ------------------------------------------------------ kick off a campaign

@campaign_bp.route("/start", methods=["POST"])
@login_required
def start(creds):
    payload = request.get_json(silent=True) or {}
    send_mode = (payload.get("send_mode") or "auto").strip().lower()
    if send_mode not in ("auto", "reply", "new"):
        send_mode = "auto"
    override_subject = (payload.get("subject") or "").strip()
    override_body = payload.get("body") or ""
    body_format = (payload.get("body_format") or "plain").strip().lower()
    if body_format not in ("plain", "html"):
        body_format = "plain"
    ui_only_recipients = payload.get("recipients") or []

    rows = session.get("campaign_rows") or []

    # Allow sending without a CSV: caller can pass a list of recipient emails
    # alongside override subject/body to compose from the UI only.
    if not rows and ui_only_recipients:
        if not override_subject and send_mode != "reply":
            return jsonify({"error": "Subject required when sending without a CSV"}), 400
        rows = [
            {"Email": e.strip(), "Subject": override_subject, "Message_Body": override_body, "_row": i}
            for i, e in enumerate(ui_only_recipients, start=2) if e and e.strip()
        ]

    if not rows:
        return jsonify({"error": "No rows uploaded. Upload a CSV/Excel or provide recipients."}), 400

    job_id = current_app.new_job_id()
    jobs = current_app.campaign_jobs

    with current_app.campaign_jobs_lock:
        jobs[job_id]["total"] = len(rows)

    # Snapshot credentials so the background thread doesn't touch the Flask
    # session (which isn't thread-safe).
    creds_dict = dict(session["credentials"])
    delay = Config.SEND_DELAY_SECONDS

    def worker():
        job = jobs[job_id]

        def on_progress(event: dict):
            with job["lock"]:
                job["events"].append(event)

        try:
            cred_obj = Credentials(**creds_dict)
            gmail = GmailService(cred_obj)
            outcomes = run_campaign(
                gmail, rows, on_progress,
                delay_seconds=delay,
                send_mode=send_mode,
                override_subject=override_subject,
                override_body=override_body,
                body_format=body_format,
            )
            summary = {
                "total": len(outcomes),
                "replied": sum(1 for o in outcomes if o.status == "replied"),
                "new": sum(1 for o in outcomes if o.status == "new"),
                "failed": sum(1 for o in outcomes if o.status == "failed"),
            }
            with job["lock"]:
                job["summary"] = summary
                job["done"] = True
        except Exception as e:  # noqa: BLE001
            log.exception("Campaign worker crashed")
            with job["lock"]:
                job["events"].append({
                    "index": -1, "total": len(rows),
                    "email": "", "status": "failed",
                    "detail": f"Worker error: {e}",
                })
                job["summary"] = {"total": 0, "replied": 0, "new": 0, "failed": 0, "error": str(e)}
                job["done"] = True

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()

    return jsonify({"job_id": job_id, "total": len(rows)})


# ---------------------------------------------------------- SSE progress

@campaign_bp.route("/progress/<job_id>")
def progress(job_id: str):
    jobs = current_app.campaign_jobs
    if job_id not in jobs:
        return jsonify({"error": "Unknown job"}), 404

    def event_stream():
        cursor = 0
        while True:
            job = jobs.get(job_id)
            if not job:
                break

            with job["lock"]:
                events_snapshot = list(job["events"][cursor:])
                cursor = len(job["events"])
                done = job["done"]
                summary = job["summary"]

            for ev in events_snapshot:
                yield f"event: progress\ndata: {json.dumps(ev)}\n\n"

            if done:
                yield f"event: summary\ndata: {json.dumps(summary or {})}\n\n"
                yield "event: done\ndata: {}\n\n"
                break

            # Heartbeat so the connection stays alive behind proxies.
            yield ": keep-alive\n\n"
            time.sleep(0.75)

    return Response(
        event_stream(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@campaign_bp.route("/jobs/<job_id>")
def job_status(job_id: str):
    jobs = current_app.campaign_jobs
    job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "Unknown job"}), 404
    with job["lock"]:
        return jsonify({
            "done": job["done"],
            "total": job["total"],
            "processed": len(job["events"]),
            "summary": job["summary"],
            "events": job["events"],
        })
