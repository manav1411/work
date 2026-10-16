# Security and data boundaries

Work stores private career notes, applications and files. The browser calls a same-origin Worker; D1 stores owner-scoped content and auth state, and a private R2 bucket stores attachments. This document describes the implemented controls, including their limits. It does not imply that production OAuth, staging or Git integration has been configured.

## Authentication

Better Auth uses the Drizzle SQLite/D1 adapter for email/password sign-in, six-digit email verification and password recovery. Interactive adapter transactions are disabled. `BETTER_AUTH_SECRET` must be at least 32 characters and `APP_ORIGIN` must identify this environment. GitHub, social login, passwordless login, public user/email updates and unused auth routes are disabled at the Worker boundary. Signup accepts only email and password; the server supplies a neutral display name.

Passwords use Better Auth's scrypt implementation with an 8–128 character policy. Email OTPs use the built-in plugin with six digits, five-minute expiry, five wrong attempts and encrypted storage. A unique verification identifier makes code consumption single-use through the real adapter. Resending replaces the old code. Host-scoped HttpOnly registration proof binds signup verification to its initiating browser; an older or lost registration context recovers by proving email ownership and setting a fresh password. This prevents a preregistered attacker password from silently becoming the mailbox owner's credential.

Session creation and private API resolution independently require verified email. Private APIs additionally require a credential account and matching authentication versions. Secure, HttpOnly, host-scoped SameSite=Lax cookies last seven days, with renewal no more than daily and no cookie session cache. Password insert/update triggers revoke sessions and increment the user's authentication version atomically with the credential change. A session-insert trigger rejects an old password check racing a reset. Email changes revoke sessions and require verification again. A reset failure can spend its code; the user requests a fresh one. No failed database write is reported as a successful reset.

Application rate counters live in D1 rather than Worker memory: a 60-second per-email/purpose send cooldown, 10 send attempts per email/hour, 30 per IP/hour and 500 per environment/day; 10 code attempts per email/10 minutes across resends; and 15 password sign-in attempts per email/10 minutes. The broader API/IP guard still applies. HMAC-derived counter keys avoid retaining raw email/IP identifiers in these counters. Password recovery responses have the same status/body for known and unknown accounts, and network email submission happens in the background. Signup explicitly directs an existing address to sign-in/recovery.

The shared account form deliberately distinguishes unknown-email and wrong-password sign-in failures to direct users to Sign up or Forgot password. These sign-in responses disclose account existence, as does the existing duplicate-signup response; recovery requests retain their generic acknowledgement.

Email jobs are encrypted in a bounded, leased D1 outbox linked to current challenges. Background/cron submission retries temporary failures and removes sensitive payloads after sender acceptance; expired/replaced challenges remove their jobs. Local SMTP acceptance does not prove remote inbox delivery. The private Pi API requires a bearer token and, for public HTTPS access, a dedicated Cloudflare Access Service Auth policy. It accepts fixed code templates only, validates senders/recipients and deduplicates IDs. No arbitrary public relay is exposed. See [sender operations](../mailer/README.md).

Pending unverified non-GitHub registrations expire after 24 hours; expired challenge, outbox and rate state is cleaned by cron. Legacy owner IDs and workspace/file ownership are preserved. Provider retirement follows verified email recovery and owner acceptance; see [cutover setup](email-auth-setup.md).

Origin/CSRF protections remain enabled. Authentication POST callback destinations are restricted to `APP_ORIGIN`, and bodies are stream limited to 100 KB. Production and staging must use separate databases, buckets, auth secrets, sender credentials and Access tokens. A local emulator test does not establish deployed CPU limits or real inbox delivery.

## Local and browser-only modes

The local fixture requires all three conditions: `ENVIRONMENT=local`, `LOCAL_DEV_AUTH=true`, and a request hostname of `localhost`, `127.0.0.1` or `[::1]`. It creates only the local synthetic `local-manav` identity and no production-valid session cookie. Setting the fixture flag in production, staging, or on a public hostname does not authenticate a request. Local fixtures are for development with emulated resources; do not configure local credentials against remote databases or buckets.

The frontend may offer a clearly labelled browser-only demo with synthetic starter records. Demo storage and local drafts are device storage, not cloud sync. Private server APIs still require a valid server session. Treat a device with imported notes, drafts or demo data as containing personal data; use the account controls to clear local data on shared devices.

## Ownership and writes

Clients do not select an owner. The validated email/password session scopes records, search, goals, preferences, export/upload, and files. Composite foreign keys and typed relation checks enforce ownership.

PATCH uses a current version counter to reject conflicting writes with 409. The counter is concurrency control; old content is never stored. Retry receipts contain IDs and resolve the current saved record or goal, rather than keeping response snapshots.

Deletion is permanent. Application deletion removes appointments and their preparation; removing a recruitment step removes its appointments; removing a custom content tab removes its scoped notes. Other references detach atomically. File deletion queues physical R2 cleanup. Account deletion removes only that account, its content, files, and sessions.

A workspace upload validates a closed package, stages bounded files privately, and replaces the owner's workspace in one D1 transaction. It rejects a changed workspace, incomplete files, wrong ownership, and invalid references. Committed uploads are safe to retry. Failed or abandoned uploads expire after one hour. Workspace epochs reject stale device writes both at the request boundary and inside mutation transactions. Replaced IDs are never reused.

Mutation requests reject foreign Origin values and cross-site requests. Zod accepts current contracts only, SQL is parameterized, and search builds FTS expressions from tokens.

## Files and rendering

R2 must remain private. Object keys contain the owner, record and random attachment IDs; knowing a key or attachment ID never grants access. Downloads first authorise the attachment and parent record, then stream the object. Download responses are private/no-store, nosniff and same-origin. Filenames are sanitised before use in headers.

Accepted types: PDF; DOCX; PNG, JPEG, WebP and GIF; plain text, Markdown, CSV and JSON. PDFs/images must match their format signature. HTML and SVG uploads are not accepted. File signatures identify the format; they are not an antivirus scan or a guarantee that a document contains no malicious content. The application does not execute uploaded code or documents.

Authorised PDFs can be framed only by this origin so the native PDF preview works. Other attachment responses use a restrictive sandbox/content policy. The app has a content security policy, frame denial, referrer protection and disabled camera/microphone/geolocation permissions. Blob URLs are allowed for browser-only attachment previews. Markdown is rendered through the frontend's restricted renderer; imported raw source is kept as data, not executed HTML.

## Runtime limits

| Operation                 | Implemented limit                                              |
| ------------------------- | -------------------------------------------------------------- |
| JSON request              | 32 MB, streamed; do not trust only Content-Length              |
| Authentication request    | 100 KB, streamed                                               |
| One file                  | Nonempty; at most 10 MB                                        |
| Multipart request         | 10 MB plus 64 KB form overhead                                 |
| Title / note body         | 240 / 500,000 characters                                       |
| Tags / links              | 40 tags of 60 characters; 100 record links                     |
| Structured record details | 100,000 JSON characters; nesting depth at most 12              |
| Explicit starter batch    | 400 records                                                    |
| Import batch              | 100 records; 20 files per record; 40 files overall             |
| Bundled export            | At most 20 MB file bytes; `?files=false` exports metadata only |
| Workspace package         | 5,000 records and files; 1,000 goals; 32 MB manifest           |
| Search response           | At most 60 results                                             |
| IP rate limit             | 240 API or 30 auth requests per minute                         |

Rate counters are stored in D1 so different Worker isolates share them. Counters older than five minutes are opportunistically removed. The rate guard returns 429 with Retry-After. This is a personal-workspace control; a larger public service would need more granular abuse controls and quota monitoring.

JSON table-valued bulk queries keep writes below D1 parameter limits. Transaction guards roll back a conflicting replacement or deletion. Staged files and obsolete objects are removed through a durable cleanup queue.
