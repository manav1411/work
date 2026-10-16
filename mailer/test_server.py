import importlib.util
import smtplib
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
    def __init__(self, host, port, timeout):
        assert host == "127.0.0.1"
    def __enter__(self):
        return self
    def __exit__(self, *_args):
        pass
    def send_message(self, message, from_addr, to_addrs):
        if self.failure:
            raise self.failure
        self.messages.append((message, from_addr, to_addrs))


class MailerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.mailer = server.Mailer(self.directory.name, "synthetic-token-longer-than-thirty-two-characters", "accounts@example.invalid")
        self.job = {"id": str(uuid.uuid4()), "email": "owner@example.invalid", "otp": "012345", "type": "email-verification", "from": "accounts@example.invalid", "expiresAt": int(time.time() * 1000) + 300_000}
        FakeSMTP.messages, FakeSMTP.failure = [], None
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


if __name__ == "__main__":
    unittest.main()
