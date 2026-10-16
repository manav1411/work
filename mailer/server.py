#!/usr/bin/env python3
"""Private Work verification mail submission; no public relay or mailbox UI."""
import hashlib
import hmac
import json
import os
import re
import smtplib
import sqlite3
import ssl
import time
from contextlib import contextmanager
from email.message import EmailMessage
from email.utils import formatdate
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

EMAIL = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$")
JOB_ID = re.compile(r"^[a-f0-9-]{36}$")


class SubmissionError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


class Mailer:
    def __init__(self, state_dir, token, sender, smtp_port=25, smtp_mode="local", smtp_password=""):
        if len(token) < 32 or not EMAIL.fullmatch(sender):
            raise ValueError("Configure a strong token and a valid sender address.")
        if smtp_mode not in {"local", "gmail"}:
            raise ValueError("Choose local or gmail SMTP transport.")
        if smtp_mode == "gmail" and (not sender.endswith("@gmail.com") or not re.fullmatch(r"[A-Za-z0-9]{16}", smtp_password)):
            raise ValueError("Gmail needs its sender address and a 16-character App Password.")
        self.token, self.sender, self.smtp_port = token, sender, int(smtp_port)
        self.smtp_mode, self.smtp_password = smtp_mode, smtp_password
        directory = Path(state_dir)
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.db_path = directory / "submissions.sqlite3"
        with self.database() as db:
            db.execute("CREATE TABLE IF NOT EXISTS submissions(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,state TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL)")
            # A crash across SMTP acceptance has an ambiguous outcome. Avoid
            # duplicate emails; a fresh user-requested code uses a fresh job ID.
            db.execute("UPDATE submissions SET state='uncertain' WHERE state='submitting'")
        self.db_path.chmod(0o600)

    @contextmanager
    def database(self):
        db = sqlite3.connect(self.db_path, timeout=10)
        try:
            db.execute("PRAGMA busy_timeout=10000")
            with db:
                yield db
        finally:
            db.close()

    @contextmanager
    def transport(self, timeout=12):
        if self.smtp_mode == "gmail":
            # The endpoint is fixed; credentials only travel over verified TLS.
            # They never enter the Worker, HTTP API payloads or service logs.
            with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=timeout, context=ssl.create_default_context()) as smtp:
                smtp.login(self.sender, self.smtp_password)
                yield smtp
        else:
            with smtplib.SMTP("127.0.0.1", self.smtp_port, timeout=timeout) as smtp:
                yield smtp

    def health(self):
        with self.transport(timeout=8) as smtp:
            if smtp.noop()[0] != 250:
                raise smtplib.SMTPException("SMTP health check failed.")
        return {"ok": True, "transport": "gmail-smtp" if self.smtp_mode == "gmail" else "local-smtp"}

    def validate(self, job):
        fields = {"id", "email", "otp", "type", "from", "expiresAt"}
        if not isinstance(job, dict) or set(job) != fields:
            raise SubmissionError(400, "Invalid mail job.")
        if any(not isinstance(job.get(key), str) for key in fields - {"expiresAt"}):
            raise SubmissionError(400, "Invalid mail job.")
        if not JOB_ID.fullmatch(job["id"]) or not EMAIL.fullmatch(job["email"]) or len(job["email"]) > 254:
            raise SubmissionError(400, "Invalid mail job.")
        if job["from"] != self.sender or not re.fullmatch(r"[0-9]{6}", job["otp"]) or job["type"] not in {"email-verification", "forget-password"}:
            raise SubmissionError(400, "Invalid mail job.")
        expiry = job["expiresAt"]
        now = int(time.time() * 1000)
        if isinstance(expiry, bool) or not isinstance(expiry, int) or not now + 30_000 < expiry <= now + 600_000:
            raise SubmissionError(410, "This email code has expired. Request a fresh code.")

    def message(self, job):
        verify = job["type"] == "email-verification"
        title = "Your Work verification code" if verify else "Reset your Work password"
        instruction = "Enter this code in work, it expires in 5 minutes. Ignore if you didn't request this."
        message = EmailMessage()
        message["From"] = f"Work <{self.sender}>"
        message["To"] = job["email"]
        message["Subject"] = title
        message["Date"] = formatdate(localtime=False)
        message["Message-ID"] = f'<{job["id"]}@{self.sender.split("@", 1)[1]}>'
        message["Auto-Submitted"] = "auto-generated"
        message.set_content(f'{title}\n\n{job["otp"]}\n\n{instruction}\n')
        message.add_alternative(f'''<!doctype html><html><body style="margin:0;background:#f5f2e9;color:#202128;font-family:Arial,sans-serif;padding:32px 16px"><div style="max-width:420px;margin:auto"><p style="font-size:36px;font-weight:800;margin:0 0 24px">work<span style="color:#f29bbd">↗</span></p><div style="background:#fffdf7;border:2px solid #202128;border-radius:14px;padding:28px;box-shadow:5px 5px 0 #202128"><h1 style="font-size:23px;margin:0 0 12px">{title}.</h1><p style="background:#def295;border:2px solid #202128;border-radius:8px;padding:18px;text-align:center;font-size:32px;font-weight:700;letter-spacing:8px">{job["otp"]}</p><p style="font-size:14px;line-height:1.6">{instruction}</p></div></div></body></html>''', subtype="html")
        return message

    def submit(self, job):
        self.validate(job)
        fingerprint = hmac.new(self.token.encode(), json.dumps(job, sort_keys=True).encode(), hashlib.sha256).hexdigest()
        now = int(time.time() * 1000)
        with self.database() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM submissions WHERE expires_at < ?", (now - 86_400_000,))
            existing = db.execute("SELECT fingerprint,state FROM submissions WHERE id=?", (job["id"],)).fetchone()
            if existing:
                if not hmac.compare_digest(existing[0], fingerprint):
                    raise SubmissionError(409, "This job ID has already been used.")
                if existing[1] in {"accepted", "uncertain"}:
                    return {"accepted": True, "state": existing[1]}
                if existing[1] == "submitting":
                    raise SubmissionError(503, "Submission is still in progress.")
                db.execute("UPDATE submissions SET state='submitting' WHERE id=?", (job["id"],))
            else:
                if db.execute("SELECT count(*) FROM submissions WHERE created_at>?", (now - 86_400_000,)).fetchone()[0] >= 500:
                    raise SubmissionError(429, "Daily sending limit reached.")
                db.execute("INSERT INTO submissions VALUES(?,?,?,?,?)", (job["id"], fingerprint, "submitting", job["expiresAt"], now))
        state = "accepted"
        sending = False
        submitted = False
        try:
            with self.transport() as smtp:
                sending = True
                smtp.send_message(self.message(job), from_addr=self.sender, to_addrs=[job["email"]])
                submitted = True
        except (smtplib.SMTPResponseException, smtplib.SMTPRecipientsRefused, ConnectionRefusedError):
            state = "accepted" if submitted else "retry"
        except (OSError, smtplib.SMTPException):
            # Connection/TLS/login failures cannot have submitted a message.
            # A disconnect during DATA may have; avoid duplicate delivery.
            # Once DATA succeeded, a failed QUIT cannot undo acceptance.
            state = "accepted" if submitted else "uncertain" if sending else "retry"
        finally:
            with self.database() as db:
                db.execute("UPDATE submissions SET state=? WHERE id=?", (state, job["id"]))
        if state == "retry":
            raise SubmissionError(503, "Mail transport is temporarily unavailable.")
        return {"accepted": True, "state": state}


def handler(mailer):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        def log_message(self, *_args):
            pass  # Request URLs, payloads and credentials never reach logs.

        def reply(self, status, body):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(data)
            self.close_connection = True

        def authorised(self):
            return hmac.compare_digest(self.headers.get("Authorization", "").encode(), f"Bearer {mailer.token}".encode())

        def setup(self):
            super().setup()
            self.connection.settimeout(15)

        def do_GET(self):
            if not self.authorised():
                return self.reply(401, {"error": "Unauthorised."})
            if self.path != "/health":
                return self.reply(404, {"error": "Not found."})
            try:
                return self.reply(200, mailer.health())
            except (OSError, smtplib.SMTPException):
                return self.reply(503, {"ok": False, "transport": "unavailable"})

        def do_POST(self):
            if not self.authorised():
                return self.reply(401, {"error": "Unauthorised."})
            if self.path != "/emails":
                return self.reply(404, {"error": "Not found."})
            try:
                if self.headers.get("Transfer-Encoding") or self.headers.get_content_type() != "application/json":
                    raise SubmissionError(400, "Use a bounded JSON body.")
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 4096:
                    raise SubmissionError(413, "Invalid message size.")
                body = self.rfile.read(length)
                if len(body) != length:
                    raise SubmissionError(400, "Incomplete request.")
                result = mailer.submit(json.loads(body))
                return self.reply(202, result)
            except (ValueError, UnicodeDecodeError):
                return self.reply(400, {"error": "Invalid mail job."})
            except SubmissionError as error:
                return self.reply(error.status, {"error": error.message})
            except (OSError, sqlite3.Error, smtplib.SMTPException):
                return self.reply(503, {"error": "Mail submission is temporarily unavailable."})
    return Handler


if __name__ == "__main__":
    os.umask(0o077)
    try:
        service = Mailer(os.environ.get("WORK_MAIL_STATE_DIR", "/var/lib/work-mailer"), os.environ.get("WORK_MAIL_TOKEN", ""), os.environ.get("WORK_MAIL_FROM", ""), os.environ.get("WORK_SMTP_PORT", "25"), os.environ.get("WORK_SMTP_MODE", "local"), os.environ.get("WORK_SMTP_PASSWORD", ""))
    except (ValueError, OSError):
        raise SystemExit("Work mailer needs valid private configuration and a writable state directory.")
    ThreadingHTTPServer(("127.0.0.1", int(os.environ.get("WORK_MAIL_PORT", "8789"))), handler(service)).serve_forever()
