"""Google OAuth 2.0 via InstalledAppFlow (Desktop client credential).

/auth/login spawns a short-lived loopback HTTP server on a random port, opens
the user's default browser to Google's consent screen, and blocks until Google
redirects back to the loopback server with an auth code. The handler then
stores credentials in the Flask session and redirects the original tab to `/`.

This flow is intended for locally-run single-user dev use. The `run_local_server`
call blocks the Flask request thread while the user clicks through Google's
consent screen — fine for localhost, unsuitable for a multi-user deployment.
"""

from __future__ import annotations

import logging

from flask import Blueprint, jsonify, redirect, session, url_for
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from config import Config

log = logging.getLogger(__name__)
auth_bp = Blueprint("auth", __name__)


def credentials_to_dict(creds: Credentials) -> dict:
    return {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": creds.scopes,
    }


def credentials_from_session() -> Credentials | None:
    data = session.get("credentials")
    if not data:
        return None
    return Credentials(**data)


@auth_bp.route("/login")
def login():
    try:
        flow = InstalledAppFlow.from_client_secrets_file(
            Config.CLIENT_SECRETS_FILE,
            scopes=Config.SCOPES,
        )
        app_url = f"http://{Config.HOST}:{Config.PORT}/"
        success_html = (
            "<!doctype html><html><head><meta charset='utf-8'>"
            "<title>Sign-in complete</title>"
            "<style>"
            "body{font-family:Inter,system-ui,sans-serif;background:#0f172a;color:#e2e8f0;"
            "display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}"
            ".card{background:#1e293b;padding:2rem 2.5rem;border-radius:12px;text-align:center;"
            "box-shadow:0 20px 40px rgba(0,0,0,.3);max-width:24rem;}"
            ".check{width:48px;height:48px;border-radius:50%;background:#10b981;"
            "display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;"
            "color:white;font-size:28px;font-weight:bold;}"
            "h2{margin:0 0 .5rem;font-weight:600;}"
            "p{margin:0;color:#94a3b8;font-size:.9rem;}"
            "a{color:#60a5fa;text-decoration:none;}"
            "</style></head><body>"
            "<div class='card'>"
            "<div class='check'>✓</div>"
            "<h2>Sign-in complete</h2>"
            f"<p id='msg'>Redirecting you back to the app…</p>"
            f"<p style='margin-top:.75rem'><a href='{app_url}'>Click here if not redirected</a></p>"
            "</div>"
            "<script>"
            "setTimeout(function(){"
            "  try { window.close(); } catch(_) {}"
            f"  window.location.replace({app_url!r});"
            "}, 800);"
            "</script></body></html>"
        )

        creds = flow.run_local_server(
            host="127.0.0.1",
            port=0,
            open_browser=True,
            authorization_prompt_message="",
            success_message=success_html,
        )
    except Exception as e:  # noqa: BLE001
        log.exception("InstalledAppFlow failed")
        return jsonify({"error": f"OAuth error: {e}"}), 400

    session["credentials"] = credentials_to_dict(creds)

    try:
        service = build("oauth2", "v2", credentials=creds, cache_discovery=False)
        userinfo = service.userinfo().get().execute()
        session["user_email"] = userinfo.get("email", "")
        session["user_name"] = userinfo.get("name", "")
        session["user_picture"] = userinfo.get("picture", "")
    except Exception:  # noqa: BLE001
        log.exception("Failed to fetch userinfo; proceeding without it")
        session["user_email"] = ""

    return redirect(url_for("index"))


@auth_bp.route("/logout", methods=["POST", "GET"])
def logout():
    session.clear()
    return redirect(url_for("login_page"))


@auth_bp.route("/me")
def me():
    if "credentials" not in session:
        return jsonify({"authenticated": False}), 401
    return jsonify({
        "authenticated": True,
        "email": session.get("user_email", ""),
        "name": session.get("user_name", ""),
        "picture": session.get("user_picture", ""),
    })
