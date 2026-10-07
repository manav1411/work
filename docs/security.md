# Security and data boundaries

Work stores private career notes, applications and files. The browser calls a same-origin Worker; D1 stores owner-scoped content and auth state, and a private R2 bucket stores attachments. This document describes the implemented controls, including their limits. It does not imply that production OAuth, staging or Git integration has been configured.

## Authentication

GitHub OAuth is handled by Better Auth with the Drizzle SQLite/D1 adapter. Interactive adapter transactions are disabled; workspace writes use D1 batches. Sign-in requires `BETTER_AUTH_SECRET` of at least 32 characters, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `APP_ORIGIN` and a valid `ALLOWED_GITHUB_USERS` runtime secret. Without them, `/api/session` returns `user: null, configured: false`; private endpoints return 401. An OAuth endpoint returns 503 rather than creating a fixture account.

The initial registration boundary uses the provider-verified GitHub profile. GitHub's numeric user ID and login are mapped into fields that cannot be supplied through public user-update inputs. The private allowlist is an array of objects with a `login` and optional numeric `id` string. When an ID is present, it takes precedence over the login, including after a username rename; a different account with the same login is rejected. Login-only entries use case-insensitive exact matching. Pin numeric IDs for stable account identity. A missing or malformed list denies all access; an empty list also denies everyone. The actual list lives in ignored `.private/github-allowlist.json` and is uploaded as a Cloudflare secret, never bundled into source or frontend assets. See [allowlist setup](github-allowlist.md). Synthetic nonnumeric IDs never satisfy production identity checks.

Registration, provider account creation, session creation and private session resolution independently check the allowlist. Removing an entry and applying the list blocks new sign-ins and existing sessions on their next private request. Email/password registration and automatic account linking are disabled. Add or remove users by editing and applying the private allowlist; each account retains its own workspace.

Production and staging session cookies are secure, HttpOnly, host scoped and SameSite=Lax. The app does not share cookies across `manavdodia.com` subdomains. Session state is read from D1, with cookie session caching disabled. Session lifetime is seven days, with renewal no more often than daily. Use separate secrets and GitHub OAuth applications for production and staging.

Better Auth supplies OAuth state/callback protections. The Worker also checks POST authentication callback, error and new-user destinations against `APP_ORIGIN`, including first sign-in without an existing cookie. Auth bodies are stream limited to 100 KB. Never set origin/CSRF protections to disabled during troubleshooting.

## Local and browser-only modes

The local fixture requires all three conditions: `ENVIRONMENT=local`, `LOCAL_DEV_AUTH=true`, and a request hostname of `localhost`, `127.0.0.1` or `[::1]`. It creates only the local synthetic `local-manav` identity and no production-valid session cookie. Setting the fixture flag in production, staging, or on a public hostname does not authenticate a request. Local fixtures are for development with emulated resources; do not configure local credentials against remote databases or buckets.

The frontend may offer a clearly labelled browser-only demo with synthetic starter records. Demo storage and local drafts are device storage, not cloud sync. Private server APIs still require a valid server session. Treat a device with imported notes, drafts or demo data as containing personal data; use the account controls to clear local data on shared devices.

## Ownership and writes

Clients do not select an owner. The validated GitHub session scopes records, search, goals, preferences, export/upload, and files. Composite foreign keys and typed relation checks enforce ownership.

PATCH uses a current version counter to reject conflicting writes with 409. The counter is concurrency control; old content is never stored. Retry receipts contain IDs and resolve the current saved record or goal, rather than keeping response snapshots.

Deletion is permanent. Application deletion removes appointments and their preparation; removing a recruitment step removes its appointments; removing a custom content tab removes its scoped notes. Other references detach atomically. File deletion queues physical R2 cleanup. Account deletion removes only that account, its content, files, and sessions.

A workspace upload validates a closed package, stages bounded files privately, and replaces the owner's workspace in one D1 transaction. It rejects a changed workspace, incomplete files, wrong ownership, and invalid references. Committed uploads are safe to retry. Failed or abandoned uploads expire after one hour. Workspace epochs reject stale device writes both at the request boundary and inside mutation transactions. Replaced IDs are never reused.

Mutation requests reject foreign Origin values and cross-site requests. Zod accepts current contracts only, SQL is parameterized, and search builds FTS expressions from tokens.

## Files and rendering

R2 must remain private. Object keys contain the owner, record and random attachment IDs; knowing a key or attachment ID never grants access. Downloads first authorise the attachment and parent record, then stream the object. Download responses are private/no-store, nosniff and same-origin. Filenames are sanitised before use in headers.

Accepted types: PDF; DOCX; PNG, JPEG, WebP and GIF; plain text, Markdown, CSV and JSON. PDFs/images must match their format signature. HTML and SVG uploads are not accepted. File signatures identify the format; they are not an antivirus scan or a guarantee that a document contains no malicious content. The application does not execute uploaded code or documents.

Authorised PDFs can be framed only by this origin so the native PDF preview works. Other attachment responses use a restrictive sandbox/content policy. The app has a content security policy, frame denial, referrer protection and disabled camera/microphone/geolocation permissions. Blob URLs are allowed for browser-only attachment previews. Markdown is rendered through the frontend's restricted renderer; imported raw source is kept as data, not executed HTML.

## Runtime limits

| Operation | Implemented limit |
| --- | --- |
| JSON request | 32 MB, streamed; do not trust only Content-Length |
| Authentication request | 100 KB, streamed |
| One file | Nonempty; at most 10 MB |
| Multipart request | 10 MB plus 64 KB form overhead |
| Title / note body | 240 / 500,000 characters |
| Tags / links | 40 tags of 60 characters; 100 record links |
| Structured record details | 100,000 JSON characters; nesting depth at most 12 |
| Explicit starter batch | 400 records |
| Import batch | 100 records; 20 files per record; 40 files overall |
| Bundled export | At most 20 MB file bytes; `?files=false` exports metadata only |
| Workspace package | 5,000 records and files; 1,000 goals; 32 MB manifest |
| Search response | At most 60 results |
| IP rate limit | 240 API or 30 auth requests per minute |

Rate counters are stored in D1 so different Worker isolates share them. Counters older than five minutes are opportunistically removed. The rate guard returns 429 with Retry-After. This is a personal-workspace control; a larger public service would need more granular abuse controls and quota monitoring.

JSON table-valued bulk queries keep writes below D1 parameter limits. Transaction guards roll back a conflicting replacement or deletion. Staged files and obsolete objects are removed through a durable cleanup queue.
