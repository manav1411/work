# Security and data boundaries

Work stores private career notes, applications, contacts and files. The browser calls a same-origin Worker; D1 stores owner-scoped content and auth state, and a private R2 bucket stores attachments. This document describes the implemented controls, including their limits. It does not imply that production OAuth, staging or Git integration has been configured.

## Authentication

GitHub OAuth is handled by Better Auth with the Drizzle SQLite/D1 adapter. Interactive adapter transactions are disabled; workspace writes use D1 batches. Sign-in requires `BETTER_AUTH_SECRET` of at least 32 characters, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `APP_ORIGIN` and owner configuration. Without them, `/api/session` returns `user: null, configured: false`; private endpoints return 401. An OAuth endpoint returns 503 rather than creating a fixture account.

The initial registration boundary uses the provider-verified GitHub profile. GitHub's numeric user ID and login are mapped into fields that cannot be supplied through public user-update inputs. Set `OWNER_GITHUB_ID=41612145` for Manav's account; the immutable provider ID then takes precedence over the login, including if the owner later changes their username. `OWNER_GITHUB_LOGIN=manav1411` is the fallback when no numeric ID is configured. A username alone is a weaker long-term identity boundary, so production and staging should pin the numeric ID. Synthetic nonnumeric IDs never satisfy production identity checks.

Registration, session creation and private session resolution independently check the owner identity. Email/password registration and automatic account linking are disabled. Supporting more users requires an explicit invitation/allowlist design; removing these checks is not a supported onboarding mechanism.

Production and staging session cookies are secure, HttpOnly, host scoped and SameSite=Lax. The app does not share cookies across `manavdodia.com` subdomains. Session state is read from D1, with cookie session caching disabled. Session lifetime is seven days, with renewal no more often than daily. Use separate secrets and GitHub OAuth applications for production and staging.

Better Auth supplies OAuth state/callback protections. The Worker also checks POST authentication callback, error and new-user destinations against `APP_ORIGIN`, including first sign-in without an existing cookie. Auth bodies are stream limited to 100 KB. Never set origin/CSRF protections to disabled during troubleshooting.

## Local and browser-only modes

The local fixture requires all three conditions: `ENVIRONMENT=local`, `LOCAL_DEV_AUTH=true`, and a request hostname of `localhost`, `127.0.0.1` or `[::1]`. It creates only the local synthetic `local-manav` identity and no production-valid session cookie. Setting the fixture flag in production, staging, or on a public hostname does not authenticate a request. Local fixtures are for development with emulated resources; do not configure local credentials against remote databases or buckets.

The frontend may offer a clearly labelled browser-only demo with synthetic starter records. Demo storage and local drafts are device storage, not cloud sync. Private server APIs still require a valid server session. Treat a device with imported notes, drafts or demo data as containing personal data; use the account controls to clear local data on shared devices.

## Ownership and writes

Clients do not select an owner. The Worker derives identity from the validated session for each private request, then scopes every record, revision, search result, related record, preference, export, import and file operation to that owner. Composite relationship/file foreign keys enforce matching owner and record IDs. Nested structured relation fields such as `companyId`, `assetId` and `primaryAttachmentId` are also checked against the user's workspace. Catalogue topic/problem slugs are deliberately allowed because they identify reusable static learning content.

Record IDs and normal timestamps are server generated. PATCH requires the acknowledged revision number; stale writes return 409 with the current owner-scoped record and do not overwrite the draft. Content and revision writes are atomic in D1, including application stage history. Idempotency keys protect create, batch create, PATCH, import and identical archive restore retries. Reusing a key for different content returns 409. A completed key cannot recreate a record that has been permanently deleted.

Soft deletion removes a record from ordinary views and FTS search while retaining revisions and files. Restore preserves related links, including links to other trashed records. Permanent deletion requires the record to already be in trash and uses a revision guard; it also removes linked IDs from current records and cascades revision/file metadata. Account deletion requires the exact JSON confirmation `DELETE MY WORKSPACE`, removes only that account and revokes its D1 sessions.

Mutation requests reject foreign `Origin` values and `Sec-Fetch-Site: cross-site`. The app enables no cross-origin API access. JSON is validated using Zod and stored through parameterised SQL. Global search tokenises user queries before building an FTS prefix expression, rather than accepting user-written FTS syntax.

## Files and rendering

R2 must remain private. Object keys contain the owner, record and random attachment IDs; knowing a key or attachment ID never grants access. Downloads first authorise the attachment and parent record, then stream the object. Files belonging to trashed records remain inaccessible until restoration. Download responses are private/no-store, nosniff and same-origin. Filenames are sanitised before use in headers.

Accepted types: PDF; PNG, JPEG, WebP and GIF; plain text, Markdown, CSV and JSON. PDFs/images must match their format signature. HTML and SVG uploads are not accepted. File signatures identify the format; they are not an antivirus scan or a guarantee that a document contains no malicious content. The application does not execute uploaded code or documents.

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
| Archive restore | 5,000 records; 40 attachment entries; 50,000 supplied revision entries; still subject to JSON/write limits |
| Atomic import/restore SQL | At most 35 write statements, with JSON chunks below 1.5 MB |
| Revision/search response | Latest 100 revisions / at most 60 search results |
| IP rate limit | 240 API or 30 auth requests per minute |

Rate counters are stored in D1 so different Worker isolates share them. Counters older than five minutes are opportunistically removed. The rate guard returns 429 with Retry-After. This is a personal-workspace control; a larger public service would need more granular abuse controls and quota monitoring.

JSON table-valued bulk queries keep ordinary imports and starter content under D1's 100 bound-parameter limit and reduce query count. Large text/revision archives may still need to be split into complete linked groups. An import/restore that fails a guard rolls back all D1 writes. The Worker cleans up R2 objects it uploaded for a failed batch.

## Backup, deletion and operational limits

Exports contain all owned records including trash, preferences, revisions, attachment metadata and, by default, file bytes. They contain private data and should be kept outside public repositories. Restore is additive: it creates a separate copied archive with new IDs and rewrites relationships/file URLs. It preserves historical revision numbers and trash state, rather than overwriting live records. Identical restore retries are idempotent. A metadata-only backup retains missing-file metadata and warns that the bytes were not included.

Import undo restores earlier snapshots or trashes creations; it refuses a batch whose records were modified later. There is no automatic destructive merge or force-undo mode. Export current work before recovery actions.

D1 and R2 cannot participate in one shared transaction. R2 upload failure does not commit a record/file batch; failed D1 writes clean up new R2 objects. A failure after a successful permanent D1 deletion may leave an inaccessible orphan R2 object. Account deletion removes registered files before deleting the account; failures require operator investigation. A D1 Time Travel restore cannot recover an R2 object already deleted. Keep bundled exports for file recovery.

The application retains revisions and trash until explicit deletion and does not run automatic trash purges or scheduled backup jobs. Cloudflare's database recovery retention depends on the account plan; it is separate from application retention. Permanent/account deletion also does not erase already downloaded exports or provider backups before their retention expires.

The Worker logs only a generic operation, redacted route and error code for unexpected failures; it does not log request bodies, note text, OAuth codes, tokens or SQL values. Check platform log settings separately, because observability tooling can record request metadata. Secrets belong in Worker secrets or ignored local `.dev.vars`; never use frontend build variables for credentials.

## Verification

`npm test -- --run tests/backend.test.ts` exercises actual emulated D1/R2 through Miniflare: signed Better Auth sessions, OAuth initiation/state, owner isolation, forbidden callbacks, production fixture rejection, concurrent saves, preserved revisions, retries, uploads, FTS, import/undo and archive recovery. The tests use synthetic records and secrets. They do not replace real staged OAuth login or second-device production checks. See [operations.md](operations.md) for release and recovery procedures.
