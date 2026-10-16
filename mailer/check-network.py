#!/usr/bin/env python3
"""Read-only direct SMTP feasibility probe. Never submits a message."""
import json
import shutil
import socket
import subprocess
import urllib.request

if __name__ == "__main__":
    result = {"static_ip": "requires ISP confirmation", "mail_sent": False}
    try:
        details = json.load(urllib.request.urlopen("https://ipinfo.io/json", timeout=10))
        ip = details["ip"]
        result["network"] = details.get("org", "unknown")
        try:
            hostname = socket.gethostbyaddr(ip)[0]
            result["reverse_dns"] = hostname
            try:
                result["reverse_forward_match"] = ip in socket.gethostbyname_ex(hostname)[2]
            except OSError:
                result["reverse_forward_match"] = False
        except OSError:
            result["reverse_dns"] = None
            result["reverse_forward_match"] = False
        result["policy_check"] = "not checked"
        if shutil.which("dig") and result["network"].startswith("AS7545 "):
            name = ".".join(reversed(ip.split("."))) + ".pbl.spamhaus.org"
            check = subprocess.run(["dig", "+time=4", "+tries=1", "+short", "@203.12.160.35", name], capture_output=True, text=True, timeout=6)
            replies = check.stdout.strip().splitlines()
            if any(value.startswith("127.255.") for value in replies):
                result["policy_check"] = "resolver not permitted; inconclusive"
            elif any(value in {"127.0.0.10", "127.0.0.11"} for value in replies):
                result["policy_check"] = "listed in PBL; direct delivery unsuitable until resolved"
            elif check.returncode == 0 and not replies:
                result["policy_check"] = "no PBL listing returned; not proof of deliverability"
            else:
                result["policy_check"] = "inconclusive"
    except (OSError, ValueError, subprocess.SubprocessError):
        result["network_check"] = "incomplete"
    result["smtp"] = {}
    for host in ["gmail-smtp-in.l.google.com", "outlook-com.olc.protection.outlook.com"]:
        try:
            with socket.create_connection((host, 25), timeout=6) as connection:
                connection.settimeout(6)
                result["smtp"][host] = connection.recv(160).startswith(b"220")
        except OSError:
            result["smtp"][host] = False
    print(json.dumps(result, indent=2))
