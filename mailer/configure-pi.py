#!/usr/bin/env python3
"""Install private Gmail configuration or add its route to an existing Tunnel."""
import json
import os
import re
import smtplib
import ssl
import subprocess
import sys
import tempfile
from pathlib import Path


def run(arguments):
    result = subprocess.run(arguments, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode:
        raise RuntimeError("Pi setup command failed; private output suppressed.")


def install(environment, path):
    config = json.loads(path.read_text())
    token, sender, password = config["token"], config["sender"], config["password"]
    if not re.fullmatch(r"[A-Za-z0-9_-]{32,}", token) or not re.fullmatch(r"[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@gmail\.com", sender) or not re.fullmatch(r"[A-Za-z0-9]{16}", password):
        raise ValueError("Invalid Gmail mailer configuration.")
    # Authenticate before changing an installed service. This sends no email.
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=15, context=ssl.create_default_context()) as smtp:
        smtp.login(sender, password)
        if smtp.noop()[0] != 250:
            raise RuntimeError("Gmail SMTP health check failed.")
    content = f"WORK_MAIL_TOKEN={token}\nWORK_MAIL_FROM={sender}\nWORK_MAIL_PORT={'8789' if environment == 'production' else '8790'}\nWORK_SMTP_MODE=gmail\nWORK_SMTP_PASSWORD={password}\n"
    destination = Path(f"/etc/work-mailer-{environment}.env")
    if destination.exists():
        backup = destination.with_suffix(".env.before-gmail")
        if not backup.exists():
            backup.write_bytes(destination.read_bytes())
            backup.chmod(0o600)
    with tempfile.NamedTemporaryFile(mode="w", dir="/etc", prefix=".work-mailer-", delete=False) as file:
        file.write(content)
        temporary = Path(file.name)
    temporary.chmod(0o600)
    temporary.replace(destination)
    run(["sh", str(Path(__file__).with_name("install-pi.sh")), environment])
    path.unlink()
    print(json.dumps({"gmailAuthenticationVerified": True, "mailerInstalled": True, "temporaryPiCredentialRemoved": True}))


def tunnel(environment):
    hostname = "work-mailer.manavdodia.com" if environment == "production" else "work-mailer-staging.manavdodia.com"
    port = 8789 if environment == "production" else 8790
    path = Path("/etc/cloudflared/config.yml")
    current = path.read_text()
    match = re.search(r"^tunnel:\s*([a-f\d-]{36})\s*$", current, re.M)
    if not match:
        raise ValueError("Expected the existing tunnel UUID.")
    existing = re.search(r"^([ \t]*)- hostname:\s*" + re.escape(hostname) + r"\s*\n[ \t]*service:\s*(\S+)", current, re.M)
    service = f"http://127.0.0.1:{port}"
    if existing and existing[2] != service:
        raise ValueError("Existing mailer route differs; inspect it first.")
    if not existing:
        terminal = re.search(r"^([ \t]*)- service:\s*http_status:404\s*$", current, re.M)
        if not terminal:
            raise ValueError("Expected the existing tunnel catchall.")
        route = f"{terminal[1]}- hostname: {hostname}\n{terminal[1]}  service: {service}\n"
        updated = current[:terminal.start()] + route + current[terminal.start():]
        temporary = path.with_suffix(".yml.mailer-pending")
        try:
            temporary.write_text(updated)
            temporary.chmod(0o600)
            run(["cloudflared", "--config", str(temporary), "tunnel", "ingress", "validate"])
            # Refuse a conflicting DNS record; never overwrite another service.
            run(["cloudflared", "--origincert", "/etc/cloudflared/cert.pem", "tunnel", "route", "dns", match[1], hostname])
            backup = path.with_suffix(f".yml.before-mailer-{environment}")
            if not backup.exists():
                backup.write_text(current)
                backup.chmod(0o600)
            temporary.replace(path)
            try:
                run(["systemctl", "restart", "cloudflared"])
            except RuntimeError:
                path.write_text(current)
                path.chmod(0o600)
                run(["systemctl", "restart", "cloudflared"])
                raise
        finally:
            temporary.unlink(missing_ok=True)
    print(json.dumps({"mailerTunnelConfigured": True, "hostname": hostname}))


if __name__ == "__main__":
    os.umask(0o077)
    try:
        action, environment = sys.argv[1:3]
        if os.geteuid() != 0 or environment not in {"production", "staging"}:
            raise ValueError("Run with sudo and choose production or staging.")
        if action == "install":
            install(environment, Path(sys.argv[3]))
        elif action == "tunnel":
            tunnel(environment)
        else:
            raise ValueError("Choose install or tunnel.")
    except (OSError, ValueError, KeyError, RuntimeError, smtplib.SMTPException):
        raise SystemExit("Pi mailer setup failed; credentials and provider responses suppressed.")
