#!/usr/bin/env python3
"""Collect the Gmail App Password privately, outside chat and shell history."""
import getpass
import os
import re
from pathlib import Path

os.umask(0o077)
directory = Path(__file__).resolve().parent.parent / ".private"
directory.mkdir(mode=0o700, exist_ok=True)
password = "".join(getpass.getpass("Gmail App Password for Work (hidden): ").split())
if not re.fullmatch(r"[A-Za-z0-9]{16}", password):
    raise SystemExit("Expected Google's 16-character App Password; nothing was saved.")
path = directory / "gmail-app-password"
with path.open("w") as file:
    file.write(password + "\n")
path.chmod(0o600)
print("App Password saved privately for Pi setup. No credential was displayed.")
