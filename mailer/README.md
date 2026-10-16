# Work's private Pi email sender

The application uses Better Auth on Cloudflare/D1. This small Python service submits only Work verification and password-recovery messages through Gmail's authenticated SMTP service or a prepared local send-only Postfix instance. The existing compiler remains a separate service. The Gmail App Password stays in the Pi's root-readable service configuration; the Worker receives only private HTTP sender credentials.

## Gmail setup

Gmail is the selected production transport. The Pi connects directly to `smtp.gmail.com:465` using certificate-verified TLS and a Gmail App Password. No Postfix, static public IP, custom reverse DNS, or custom-domain mail records are needed for a Gmail sender. Messages display `Work <sender@gmail.com>`. Gmail applies account-wide sending limits, including other mail sent by the account; the application's sending limits do not reserve Gmail capacity. The Pi must remain online.

Production activation on 16 October 2026 passed protected health and Gmail authentication checks. A real password-recovery email was accepted on the first attempt, and the owner confirmed inbox arrival. Work's existing owner password was not changed by this delivery test.

Enable two-step verification on the sending Gmail account and create an App Password. From the local project directory, collect it with a hidden prompt:

```sh
python3 scripts/auth-gmail-password.py
```

This saves `.private/gmail-app-password` with mode `0600`. The local `.dev.vars` file configures the development Cloudflare Worker and is not the Pi's service configuration. Never put the Gmail password in Worker secrets, browser variables, chat, or source control. Changing the Gmail account password revokes App Passwords; generate a replacement and reinstall the mailer when needed. See [Google's instructions](https://support.google.com/accounts/answer/185833?hl=en).

The following operator commands use the existing SSH host `pi`, private Pi administration credential `.private/pi_pw`, and existing Cloudflare API credentials. They create a dedicated Access service identity and preserve the compiler's routing and authentication:

```sh
node scripts/mailer-cloudflare.mjs production sender@gmail.com
node scripts/mailer-pi.mjs production install
node scripts/mailer-pi.mjs production tunnel
node scripts/mailer-pi.mjs production health
npm run auth:configure -- production
```

The installer first tests Gmail authentication without sending mail. It transfers the App Password over SSH into `/etc/work-mailer-production.env` (root-owned, mode `0600`) and removes the temporary credential file on the Pi after installation. The local ignored credential copy remains available for reinstalling; it is not committed. A protected `/health` check authenticates to Gmail and runs SMTP NOOP; only a real inbox test proves delivery. Staging uses a separate instance, HTTP port, bearer token and Access identity; replace `production` with `staging` in the commands.

The service configuration for Gmail is:

```dotenv
WORK_MAIL_TOKEN=a-random-token-with-at-least-32-characters
WORK_MAIL_FROM=sender@gmail.com
WORK_MAIL_PORT=8789
WORK_SMTP_MODE=gmail
WORK_SMTP_PASSWORD=the-sixteen-character-app-password
```

The Tunnel hostname is `work-mailer.manavdodia.com`, protected by Cloudflare Access Service Auth plus the mailer's own bearer token. Check protected health before uploading the Worker settings. Request a password-recovery email through Work and confirm the message arrives promptly, including checking spam. Do not reset the owner's password just to test transport.

## Direct delivery feasibility (historical checks)

Read-only checks on 16 October 2026 found:

- Pi architecture: ARM64; Cloudflare Tunnel is running.
- Outbound port 25 reaches Gmail and Outlook and receives SMTP greetings. No messages were sent.
- The observed network is TPG. The owner believes its public IP is dynamic.
- The ISP reverse-DNS hostname did not resolve forward to the observed sending IP. Forward-confirmed reverse DNS is not ready.
- No Postfix or DKIM service was installed during this work. The policy-list check could not be completed because `dig` was unavailable; no conclusion about listing status was drawn.

Direct delivery is **not ready to activate**. Confirm a static address, ISP permission, configurable PTR/forward DNS and IP reputation before changing mail/DNS services. A successful TCP connection does not establish inbox delivery. Run `python3 mailer/check-network.py` on the Pi for fresh diagnostics; it does not send email. Keep current IP addresses and credentials out of Git.

The owner subsequently selected Gmail SMTP as the free delivery transport. The direct-delivery checks below remain relevant only if replacing Gmail with self-hosted outbound SMTP.

## SMTP and domain prerequisites

Choose the sender and mail hostname before installation; proposed names are `accounts@work.manavdodia.com` and `mail.work.manavdodia.com`. Confirm these do not conflict with existing routing.

1. Arrange an appropriate static sending IP and PTR record with the ISP. Its PTR hostname must resolve forward to that address. Match the SMTP greeting to that hostname. SMTP DNS records must be DNS-only, not behind Cloudflare's HTTP proxy.
2. Configure SPF to authorise that IP, DKIM with a dedicated signing key and DNS selector, and DMARC with alignment and a monitored reporting destination. Set up a valid return path and bounce handling without overwriting existing MX records or other services.
3. Configure Postfix to listen only on loopback (`inet_interfaces = loopback-only`). Trust loopback only; do not create an open relay or expose port 25 on the router. Direct outbound delivery uses an empty `relayhost` and the chosen hostname, with appropriate `myorigin`/`mydestination` settings for this send-only host.
4. Use local DKIM signing and outbound TLS. Keep queues short for time-sensitive codes: configure `maximal_queue_lifetime` and `bounce_queue_lifetime` to at most 60 seconds, with suitable retry and connection timeouts. The Worker submits only while at least 60 seconds of code validity remain. SMTP queues and remote providers can still delay messages; always explain expiry and allow a fresh code.
5. Verify that SPF, DKIM and DMARC pass at real Gmail and Outlook inboxes. Check inbox/spam placement and latency. Send tests only to addresses whose owners have requested them. Review bounces rather than retrying permanent delivery failures indefinitely.

Consult [Postfix configuration](https://www.postfix.org/BASIC_CONFIGURATION_README.html), [Gmail sender requirements](https://support.google.com/mail/answer/81126?hl=en), and [Spamhaus PBL guidance](https://www.spamhaus.org/blocklists/policy-blocklist/). Installing software alone does not satisfy these prerequisites.

## Local Postfix service installation

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

Add a dedicated Tunnel hostname pointing to `http://127.0.0.1:8789`, validate the tunnel config, and preserve all existing routes. Protect the hostname with a dedicated Cloudflare Access **Service Auth** policy and token. The application also checks its own bearer token; both layers are required outside local development. The tunnel and Access helpers in the Gmail section can also provision this route. Configure the Work Worker using `npm run auth:configure`; see [email authentication setup](../docs/email-auth-setup.md).

## API and retries

All routes require `Authorization: Bearer …`; tunnel requests additionally require the Access service credentials.

- `GET /health`: checks the selected SMTP service without sending mail, including authentication for Gmail. It does not claim inbox delivery.
- `POST /emails`: bounded JSON with `{id,email,otp,type,from,expiresAt}`. `type` is `email-verification` or `forget-password`, `otp` is exactly six digits, `from` must equal the configured sender, and `expiresAt` is an absolute Unix millisecond timestamp. No arbitrary HTML, subjects or headers are accepted.

A `202` response means submission was accepted or deduplicated. The service constructs Work-styled text/HTML messages itself. IDs are idempotent; reusing an ID with different content fails. SMTP connection, TLS, authentication and explicit submission refusals return `503` so the Work outbox can retry. Ambiguous failures during submission or after a process crash retain an `uncertain` state and are not resubmitted, avoiding duplicate messages; the user can request a fresh code. SMTP acceptance is not proof of inbox delivery.

`systemctl status work-mailer@production` and `journalctl -u work-mailer@production` show service health. Request bodies, addresses, codes, credentials and upstream response text are not logged by this API. Monitor Postfix separately and protect its potentially identifying logs. Restarting the mailer preserves deduplication state.

## Verification

`npm run test:mailer` tests formatting, strict inputs, expiration, idempotency, temporary failure, ambiguous acceptance, crash recovery and Gmail's verified TLS/authentication path using fake SMTP transports. It sends no real email. Application integration tests separately cover the encrypted D1 outbox, leases, retries and cleanup. Real inbox delivery remains a release gate.
