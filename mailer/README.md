# Work's private Pi email sender

The application uses Better Auth on Cloudflare/D1. This small Python service submits only Work verification and password-recovery messages to a local send-only Postfix instance. It has no mailbox UI, external SDK, or third-party email account. The existing compiler remains a separate service.

## Current feasibility

Read-only checks on 16 October 2026 found:

- Pi architecture: ARM64; Cloudflare Tunnel is running.
- Outbound port 25 reaches Gmail and Outlook and receives SMTP greetings. No messages were sent.
- The observed network is TPG. The owner believes its public IP is dynamic.
- The ISP reverse-DNS hostname did not resolve forward to the observed sending IP. Forward-confirmed reverse DNS is not ready.
- No Postfix or DKIM service was installed during this work. The policy-list check could not be completed because `dig` was unavailable; no conclusion about listing status was drawn.

Direct delivery is **not ready to activate**. Confirm a static address, ISP permission, configurable PTR/forward DNS and IP reputation before changing mail/DNS services. A successful TCP connection does not establish inbox delivery. Run `python3 mailer/check-network.py` on the Pi for fresh diagnostics; it does not send email. Keep current IP addresses and credentials out of Git.

If ISP requirements cannot be met affordably, choose another transport explicitly. No relay or paid email service is enabled as a fallback.

## SMTP and domain prerequisites

Choose the sender and mail hostname before installation; proposed names are `accounts@work.manavdodia.com` and `mail.work.manavdodia.com`. Confirm these do not conflict with existing routing.

1. Arrange an appropriate static sending IP and PTR record with the ISP. Its PTR hostname must resolve forward to that address. Match the SMTP greeting to that hostname. SMTP DNS records must be DNS-only, not behind Cloudflare's HTTP proxy.
2. Configure SPF to authorise that IP, DKIM with a dedicated signing key and DNS selector, and DMARC with alignment and a monitored reporting destination. Set up a valid return path and bounce handling without overwriting existing MX records or other services.
3. Configure Postfix to listen only on loopback (`inet_interfaces = loopback-only`). Trust loopback only; do not create an open relay or expose port 25 on the router. Direct outbound delivery uses an empty `relayhost` and the chosen hostname, with appropriate `myorigin`/`mydestination` settings for this send-only host.
4. Use local DKIM signing and outbound TLS. Keep queues short for time-sensitive codes: configure `maximal_queue_lifetime` and `bounce_queue_lifetime` to at most 60 seconds, with suitable retry and connection timeouts. The Worker submits only while at least 60 seconds of code validity remain. SMTP queues and remote providers can still delay messages; always explain expiry and allow a fresh code.
5. Verify that SPF, DKIM and DMARC pass at real Gmail and Outlook inboxes. Check inbox/spam placement and latency. Send tests only to addresses whose owners have requested them. Review bounces rather than retrying permanent delivery failures indefinitely.

Consult [Postfix configuration](https://www.postfix.org/BASIC_CONFIGURATION_README.html), [Gmail sender requirements](https://support.google.com/mail/answer/81126?hl=en), and [Spamhaus PBL guidance](https://www.spamhaus.org/blocklists/policy-blocklist/). Installing software alone does not satisfy these prerequisites.

## Service installation

After the SMTP prerequisites pass, create `/etc/work-mailer-production.env` privately with mode `0600`:

```dotenv
WORK_MAIL_TOKEN=a-random-token-with-at-least-32-characters
WORK_MAIL_FROM=accounts@your-verified-sending-domain.example
WORK_MAIL_PORT=8789
WORK_SMTP_PORT=25
```

Generate the token privately, never in a command argument or chat. Copy the `mailer` directory to the Pi, then run `sudo sh mailer/install-pi.sh production` from its parent directory. The installer refuses to proceed without active Postfix and private configuration; it does not install/reconfigure SMTP or modify the existing compiler or Tunnel.

For staging, use `/etc/work-mailer-staging.env`, a different bearer/Access token and port (for example 8790), and `sudo sh mailer/install-pi.sh staging`. Each instance has a separate Unix identity and state directory.

The production systemd instance runs as `work-mailer-production`, binds HTTP to `127.0.0.1:8789`, restricts its writable filesystem and limits memory/tasks. Its SQLite deduplication records contain job IDs, keyed fingerprints and submission state, with no message bodies or recipient addresses. Postfix's normal restricted spool may contain email bodies until delivery/expiry; protect it accordingly.

Add a dedicated Tunnel hostname pointing to `http://127.0.0.1:8789`, validate the tunnel config, and preserve all existing routes. Protect the hostname with a dedicated Cloudflare Access **Service Auth** policy and token. The application also checks its own bearer token; both layers are required outside local development. Configure the Work Worker using `npm run auth:configure`; see [email authentication setup](../docs/email-auth-setup.md).

## API and retries

All routes require `Authorization: Bearer …`; tunnel requests additionally require the Access service credentials.

- `GET /health`: checks the local SMTP service without sending mail. It does not claim inbox delivery.
- `POST /emails`: bounded JSON with `{id,email,otp,type,from,expiresAt}`. `type` is `email-verification` or `forget-password`, `otp` is exactly six digits, `from` must equal the configured sender, and `expiresAt` is an absolute Unix millisecond timestamp. No arbitrary HTML, subjects or headers are accepted.

A `202` response means submission was accepted or deduplicated. The service constructs Work-styled text/HTML messages itself. IDs are idempotent; reusing an ID with different content fails. Temporary SMTP refusals return `503` so the Work outbox can retry. Ambiguous failures after a connection loss or process crash retain an `uncertain` state and are not resubmitted, avoiding duplicate messages; the user can request a fresh code. Local SMTP acceptance is not proof of remote delivery.

`systemctl status work-mailer@production` and `journalctl -u work-mailer@production` show service health. Request bodies, addresses, codes, credentials and upstream response text are not logged by this API. Monitor Postfix separately and protect its potentially identifying logs. Restarting the mailer preserves deduplication state.

## Verification

`npm run test:mailer` tests formatting, strict inputs, expiration, idempotency, temporary failure, ambiguous acceptance and crash recovery using a fake local SMTP transport. It sends no real email. Application integration tests separately cover the encrypted D1 outbox, leases, retries and cleanup. Real inbox delivery remains a release gate.
