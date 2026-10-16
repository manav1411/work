import importlib.util
import smtplib
import ssl
import tempfile
import time
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("work_mailer", Path(__file__).with_name("server.py"))
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class FakeSMTP:
    messages = []
    failure = None
    exit_failure = None
    def __init__(self, host, port, timeout):
        assert host == "127.0.0.1"
    def __enter__(self):
        return self
    def __exit__(self, *_args):
        if self.exit_failure:
            raise self.exit_failure
    def send_message(self, message, from_addr, to_addrs):
        if self.failure:
            raise self.failure
        self.messages.append((message, from_addr, to_addrs))
    def noop(self):
        return 250, b"OK"


class FakeGmailSMTP(FakeSMTP):
    authentication_failure = None
    def __init__(self, host, port, timeout, context):
        assert host == "smtp.gmail.com"
        assert port == 465
        assert context.check_hostname
        assert context.verify_mode == ssl.CERT_REQUIRED
        self.authenticated = False
    def login(self, username, password):
        if self.authentication_failure:
            raise self.authentication_failure
        assert username == "synthetic-work@gmail.com"
        assert password == "abcdefghijklmnop"
        self.authenticated = True
    def send_message(self, *args, **kwargs):
        assert self.authenticated
        super().send_message(*args, **kwargs)


class MailerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.mailer = server.Mailer(self.directory.name, "synthetic-token-longer-than-thirty-two-characters", "accounts@example.invalid")
        self.job = {"id": str(uuid.uuid4()), "email": "owner@example.invalid", "otp": "012345", "type": "email-verification", "from": "accounts@example.invalid", "expiresAt": int(time.time() * 1000) + 300_000}
        FakeSMTP.messages, FakeSMTP.failure, FakeSMTP.exit_failure = [], None, None
        self.smtp = patch("smtplib.SMTP", FakeSMTP)
        self.smtp.start()
        self.addCleanup(self.smtp.stop)

    def test_submission_and_retry_are_idempotent_without_storing_codes(self):
        self.assertTrue(self.mailer.submit(self.job)["accepted"])
        self.assertTrue(self.mailer.submit(self.job)["accepted"])
        self.assertEqual(len(FakeSMTP.messages), 1)
        message = FakeSMTP.messages[0][0]
        self.assertIn("012345", message.get_body(preferencelist=("plain",)).get_content())
        self.assertEqual(message["To"], self.job["email"])
        with self.mailer.database() as db:
            row = db.execute("SELECT * FROM submissions").fetchone()
            self.assertNotIn("012345", repr(row))
            self.assertNotIn("owner@example.invalid", repr(row))

    def test_refused_submission_can_retry_but_ambiguous_submission_does_not_duplicate(self):
        FakeSMTP.failure = smtplib.SMTPDataError(450, b"Try later")
        with self.assertRaises(server.SubmissionError) as result:
            self.mailer.submit(self.job)
        self.assertEqual(result.exception.status, 503)
        FakeSMTP.failure = None
        self.mailer.submit(self.job)
        self.assertEqual(len(FakeSMTP.messages), 1)
        other = {**self.job, "id": str(uuid.uuid4())}
        FakeSMTP.failure = smtplib.SMTPServerDisconnected("Lost response")
        self.assertEqual(self.mailer.submit(other)["state"], "uncertain")
        FakeSMTP.failure = None
        self.assertEqual(self.mailer.submit(other)["state"], "uncertain")
        self.assertEqual(len(FakeSMTP.messages), 1)

    def test_rejects_expired_jobs_sender_override_header_injection_and_changed_ids(self):
        for changes in [{"expiresAt": 0}, {"email": "victim@example.invalid\r\nBcc:other@example.invalid"}, {"from": "other@example.invalid"}, {"otp": "1"}, {"type": "marketing"}, {"id": "bad"}, {"expiresAt": True}, {"html": "arbitrary"}]:
            with self.assertRaises(server.SubmissionError):
                self.mailer.submit({**self.job, **changes})
        self.assertEqual(len(FakeSMTP.messages), 0)
        self.mailer.submit(self.job)
        with self.assertRaises(server.SubmissionError) as result:
            self.mailer.submit({**self.job, "otp": "654321"})
        self.assertEqual(result.exception.status, 409)

    def test_crash_recovery_does_not_resubmit_an_ambiguous_job(self):
        self.mailer.submit(self.job)
        with self.mailer.database() as db:
            db.execute("UPDATE submissions SET state='submitting'")
        restarted = server.Mailer(self.directory.name, self.mailer.token, self.mailer.sender)
        self.assertEqual(restarted.submit(self.job)["state"], "uncertain")
        self.assertEqual(len(FakeSMTP.messages), 1)

    def gmail(self):
        FakeGmailSMTP.authentication_failure = None
        mock = patch("smtplib.SMTP_SSL", FakeGmailSMTP)
        mock.start()
        self.addCleanup(mock.stop)
        self.job["from"] = "synthetic-work@gmail.com"
        return server.Mailer(self.directory.name, self.mailer.token, self.job["from"], smtp_mode="gmail", smtp_password="abcdefghijklmnop")

    def test_gmail_authenticates_over_verified_tls_and_preserves_idempotency(self):
        mailer = self.gmail()
        self.assertEqual(mailer.health(), {"ok": True, "transport": "gmail-smtp"})
        self.assertTrue(mailer.submit(self.job)["accepted"])
        self.assertTrue(mailer.submit(self.job)["accepted"])
        self.assertEqual(len(FakeSMTP.messages), 1)
        self.assertEqual(str(FakeSMTP.messages[0][0]["From"]), "Work <synthetic-work@gmail.com>")

    def test_gmail_login_failure_is_retryable_without_submitting_mail(self):
        mailer = self.gmail()
        FakeGmailSMTP.authentication_failure = smtplib.SMTPAuthenticationError(535, b"private provider response")
        with self.assertRaises(server.SubmissionError) as result:
            mailer.submit(self.job)
        self.assertEqual(result.exception.status, 503)
        self.assertNotIn("private", result.exception.message)
        self.assertEqual(len(FakeSMTP.messages), 0)
        FakeGmailSMTP.authentication_failure = None
        self.assertTrue(mailer.submit(self.job)["accepted"])
        self.assertEqual(len(FakeSMTP.messages), 1)

    def test_gmail_tls_connection_failure_is_retryable(self):
        mailer = self.gmail()
        with patch("smtplib.SMTP_SSL", side_effect=ssl.SSLError("synthetic TLS failure")):
            with self.assertRaises(server.SubmissionError):
                mailer.submit(self.job)
        with mailer.database() as db:
            self.assertEqual(db.execute("SELECT state FROM submissions").fetchone()[0], "retry")
        self.assertTrue(mailer.submit(self.job)["accepted"])

    def test_gmail_disconnect_during_submission_is_not_sent_twice(self):
        mailer = self.gmail()
        FakeSMTP.failure = smtplib.SMTPServerDisconnected("Lost response")
        self.assertEqual(mailer.submit(self.job)["state"], "uncertain")
        FakeSMTP.failure = None
        self.assertEqual(mailer.submit(self.job)["state"], "uncertain")
        self.assertEqual(len(FakeSMTP.messages), 0)

    def test_gmail_quit_failure_after_acceptance_does_not_resubmit(self):
        mailer = self.gmail()
        FakeSMTP.exit_failure = smtplib.SMTPResponseException(421, b"Connection closing")
        self.assertEqual(mailer.submit(self.job)["state"], "accepted")
        FakeSMTP.exit_failure = None
        self.assertEqual(mailer.submit(self.job)["state"], "accepted")
        self.assertEqual(len(FakeSMTP.messages), 1)

    def test_rejects_incomplete_gmail_credentials_and_unknown_transport(self):
        for settings in [dict(smtp_mode="gmail"), dict(smtp_mode="gmail", smtp_password="short"), dict(smtp_mode="other")]:
            with self.assertRaises(ValueError):
                server.Mailer(self.directory.name, self.mailer.token, self.mailer.sender, **settings)


if __name__ == "__main__":
    unittest.main()
