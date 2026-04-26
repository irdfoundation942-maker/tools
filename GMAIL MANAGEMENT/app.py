"""Gmail Management & Auto-Responder — Flask app entry point."""

from __future__ import annotations

import logging
import os
import threading
import uuid
from typing import Any

from flask import Flask, redirect, render_template, session, url_for
from flask_session import Session

from config import Config

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
)


# Shared in-memory store for live campaign progress. Keyed by job_id.
# Each entry: {"events": [...], "done": bool, "lock": Lock, "total": int}
CAMPAIGN_JOBS: dict[str, dict[str, Any]] = {}
CAMPAIGN_JOBS_LOCK = threading.Lock()


def create_app() -> Flask:
    os.environ.setdefault(
        "OAUTHLIB_INSECURE_TRANSPORT",
        os.getenv("OAUTHLIB_INSECURE_TRANSPORT", "1"),
    )

    app = Flask(__name__, static_folder="static", template_folder="templates")
    app.config.from_object(Config)

    os.makedirs(Config.UPLOAD_DIR, exist_ok=True)
    os.makedirs(Config.SESSION_DIR, exist_ok=True)

    Session(app)

    # Expose the shared jobs store on the app so blueprints can use it.
    app.campaign_jobs = CAMPAIGN_JOBS
    app.campaign_jobs_lock = CAMPAIGN_JOBS_LOCK

    from routes.auth import auth_bp
    from routes.inbox import inbox_bp
    from routes.campaign import campaign_bp

    app.register_blueprint(auth_bp, url_prefix="/auth")
    app.register_blueprint(inbox_bp, url_prefix="/api/inbox")
    app.register_blueprint(campaign_bp, url_prefix="/api/campaign")

    @app.route("/")
    def index():
        if "credentials" not in session:
            return redirect(url_for("auth.login"))
        return render_template("dashboard.html", user_email=session.get("user_email", ""))

    @app.route("/login")
    def login_page():
        return render_template("login.html")

    @app.route("/healthz")
    def healthz():
        return {"ok": True}

    @app.context_processor
    def inject_globals():
        return {"app_name": "Gmail Manager"}

    # Helper used by blueprints to register a new job and get an id.
    def new_job_id() -> str:
        job_id = uuid.uuid4().hex
        with CAMPAIGN_JOBS_LOCK:
            CAMPAIGN_JOBS[job_id] = {
                "events": [],
                "done": False,
                "total": 0,
                "summary": None,
                "lock": threading.Lock(),
            }
        return job_id

    app.new_job_id = new_job_id
    return app


app = create_app()


if __name__ == "__main__":
    app.run(host=Config.HOST, port=Config.PORT, debug=Config.DEBUG, threaded=True)
