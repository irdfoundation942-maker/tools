import os
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = os.path.abspath(os.path.dirname(__file__))


class Config:
    SECRET_KEY = os.getenv("FLASK_SECRET_KEY", "dev-secret-change-me")
    DEBUG = os.getenv("FLASK_DEBUG", "0") == "1"
    HOST = os.getenv("FLASK_HOST", "127.0.0.1")
    PORT = int(os.getenv("FLASK_PORT", "5000"))

    CLIENT_SECRETS_FILE = os.path.join(
        BASE_DIR,
        os.getenv("GOOGLE_CLIENT_SECRETS_FILE", "mail-management-credentials.json"),
    )

    SCOPES = [
        "https://mail.google.com/",
        "openid",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
    ]

    SEND_DELAY_SECONDS = float(os.getenv("SEND_DELAY_SECONDS", "2"))

    UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
    SESSION_DIR = os.path.join(BASE_DIR, "flask_session")
    MAX_CONTENT_LENGTH = 10 * 1024 * 1024  # 10 MB CSV cap

    SESSION_TYPE = "filesystem"
    SESSION_FILE_DIR = SESSION_DIR
    SESSION_PERMANENT = False
    SESSION_USE_SIGNER = True
