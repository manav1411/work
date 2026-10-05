#!/bin/sh
set -eu
# Run with sudo from /home/manav/base/work_project. No credentials in arguments.
cd /home/manav/base/work_project
install -d -m 0755 /opt/work-compiler
install -m 0644 server.mjs protocol.mjs run-job.sh /opt/work-compiler/
install -m 0755 runtime/bin/node /opt/work-compiler/node
install -m 0644 work-compiler.service /etc/systemd/system/work-compiler.service
if [ ! -e /etc/work-compiler.env ]; then
  /opt/work-compiler/node --input-type=module -e 'import{randomBytes}from"node:crypto";import{writeFileSync}from"node:fs";writeFileSync("/etc/work-compiler.env",`WORK_COMPILER_TOKEN=${randomBytes(36).toString("base64url")}\n`,{mode:0o600});'
fi
systemctl daemon-reload
systemctl enable --now work-compiler.service
systemctl is-active work-compiler.service
