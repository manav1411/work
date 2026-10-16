#!/bin/sh
set -eu
# Prepare Postfix, DKIM, DNS and direct-delivery prerequisites before activation.
# This installer does not install or reconfigure the host's SMTP services.
instance=${1:-production}
case "$instance" in production|staging) ;; *) printf '%s\n' 'Specify production or staging.' >&2; exit 1 ;; esac
if [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' 'Run this installer with sudo.' >&2
  exit 1
fi
if ! systemctl is-active --quiet postfix; then
  printf '%s\n' 'Configure and verify the local send-only Postfix service first; see mailer/README.md.' >&2
  exit 1
fi
if [ ! -f /etc/work-mailer-${instance}.env ]; then
  printf '%s\n' "Create /etc/work-mailer-${instance}.env privately with WORK_MAIL_TOKEN and WORK_MAIL_FROM; see mailer/README.md." >&2
  exit 1
fi
cd "$(dirname "$0")"
if ! id -u "work-mailer-${instance}" >/dev/null 2>&1; then
  useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin "work-mailer-${instance}"
fi
install -d -m 0755 /opt/work-mailer
install -m 0644 server.py /opt/work-mailer/server.py
install -m 0644 work-mailer@.service /etc/systemd/system/work-mailer@.service
chown root:root /etc/work-mailer-${instance}.env
chmod 0600 /etc/work-mailer-${instance}.env
systemctl daemon-reload
systemctl enable "work-mailer@${instance}.service"
systemctl restart "work-mailer@${instance}.service"
systemctl is-active "work-mailer@${instance}.service"
