# Runtime, authentication and recovery

The same Cloudflare Worker serves the React assets and private `/api` routes. The runtime uses `DB` for D1, `FILES` for private R2 and `ASSETS` for the frontend. No external hiring, immigration, LinkedIn, Overleaf, LeetCode or calendar integration is implied by having a link or data field in the workspace. Scheduled emails, background notifications and automatic content backups are not currently installed.

## Local development

Use the Node version required by `package.json` and the committed package lock. Install with `npm ci`. Create an ignored `.dev.vars` from the provided example; set the local fixture flag only for emulated local resources. Apply the migration before starting Vite:

```sh
npm ci
npm run db:local
npm run dev
```

The configured local address is `http://127.0.0.1:5180`. `GET /api/session` should report `local: true` only when the local fixture's environment/flag/hostname checks all pass. Local content is separate from production. Never use `--remote` for the local development database or bind fixture mode to a remote service.

For a real local OAuth test, turn off `LOCAL_DEV_AUTH`, use a separate development GitHub OAuth application, set `APP_ORIGIN` to the exact local HTTP origin, and register that origin plus `/api/auth/callback/github`. Matching `localhost` and `127.0.0.1` is not interchangeable for callbacks or cookies. Give each environment a unique random auth secret of at least 32 characters.

## Cloud authentication

The actual required runtime variables are:

| Name | Purpose |
| --- | --- |
| `ENVIRONMENT` | `production`, `staging` or `local`; public deployments must never be `local` |
| `APP_ORIGIN` | Exact stable scheme/host/port used for callbacks and trusted origins |
| `OWNER_GITHUB_LOGIN` | Initial owner login, `manav1411` |
| `OWNER_GITHUB_ID` | Recommended stable provider ID, `41612145` |
| `GITHUB_CLIENT_ID` | GitHub OAuth application's client ID |
| `GITHUB_CLIENT_SECRET` | Runtime secret; never shipped to the frontend |
| `BETTER_AUTH_SECRET` | Unique runtime secret of at least 32 characters |

Create a GitHub OAuth application with production callback `https://work.manavdodia.com/api/auth/callback/github`. Staging needs its own application and its own exact stable callback origin. The provider requests `read:user` and `user:email`; a GitHub App instead of an OAuth App must also have email-address read permission. [GitHub configuration in Better Auth](https://better-auth.com/docs/authentication/github).

Store runtime secrets through the selected Cloudflare environment:

```sh
npx wrangler secret put BETTER_AUTH_SECRET --config wrangler.jsonc
npx wrangler secret put GITHUB_CLIENT_SECRET --config wrangler.jsonc
npx wrangler secret put BETTER_AUTH_SECRET --env staging --config wrangler.jsonc
npx wrangler secret put GITHUB_CLIENT_SECRET --env staging --config wrangler.jsonc
```

Set client IDs and owner/origin variables in the matching Wrangler environment. Secret inputs are interactive; do not put secrets into command arguments, readme files, client `VITE_` variables or screenshots. A configured production Worker still requires an actual successful GitHub sign-in before private data can be saved. Do not work around missing credentials with fixture flags.

## Bindings and release sequence

Provision production and staging D1 databases and private R2 buckets separately. Replace any placeholder database IDs with the actual returned binding IDs. A Wrangler dry run/build does not create these resources, register GitHub OAuth or connect Workers Builds. Before provisioning or replacing a route, verify the selected Cloudflare account and existing DNS/Worker state.

Staging uses its own Worker, D1, R2, auth secret and OAuth credentials. Preview environments must likewise use nonproduction resources and synthetic data. If using a named Cloudflare environment, select it at Vite build time so the generated deployment configuration targets the intended resources.

```sh
npm run check
npm test
npm run test:e2e
npm run build
npm run deploy:staging
```

The staging script sets `CLOUDFLARE_ENV=staging` while building, applies staging migrations and deploys that build. Review the generated configuration/Worker name and binding IDs before deployment. Perform a staged real GitHub login, note edit/reload, file upload/download, search, conflict/recovery and export/restore check. Then inspect pending production migrations and deploy the reviewed production build:

```sh
npx wrangler d1 migrations list DB --remote --config wrangler.jsonc
npm run ci:build
npm run deploy:ci
```

`deploy:ci` applies migrations to production, then deploys. Migrations must remain additive/backward compatible, because Worker rollback does not undo D1 changes. The initial migration defines auth tables, records, owner-scoped links, revision/FTS triggers, preferences, private-file metadata, idempotency, imports and rate counters.

Workers Builds requires the actual GitHub repository connection/authorisation in Cloudflare, with the production branch and build/deploy commands configured. A CLI deploy alone does not prove Git-triggered deployment. Release completion requires observing a reviewed Git push produce a successful deployment and then checking the custom domain, TLS, deep routes and authenticated private persistence.

## Runtime checks

`/api/health` reports service/environment and whether auth is configured; it returns no secret values. `/api/session` reports the real validated user or null. Production with missing auth configuration should remain signed out; do not interpret a polished frontend or browser demo as working cloud sync.

Unknown `/api/...` endpoints return structured JSON errors, never the SPA. Unauthenticated private endpoints return 401. A conflict is 409, an unsupported upload is 415, a size limit is 413, an origin rejection is 403, and rate limiting is 429. Retry network/server errors using the same idempotency key. A validation failure needs corrected inputs. Preserve local drafts after conflicts until the user chooses how to recover them.

After release, verify these with a real authenticated account:

1. Create and update a note; retrieve it after reload and a separate device login.
2. Save a linked action/application and confirm the relationship and stage history.
3. Upload a small PDF/image; preview/download it; sign out and verify private access fails.
4. Open a note in two sessions, make competing edits and verify one gets a recoverable conflict.
5. Search a unique phrase; trash/restore the note; confirm search and attachment access follow its state.
6. Export a bundled archive; restore to a separate copied archive and verify counts, links, history and file bytes.

The backend integration suite uses actual emulated D1/R2. A Vite-binding smoke test can run the same create/read/search/trash/restore/delete API journey against `127.0.0.1:5180`; it should create a uniquely labelled synthetic note and permanently delete that exact note afterwards. Use only local fixtures or a dedicated staging test account, never an unscoped production cleanup script. The browser tests complement this by checking the frontend workflows.

## Migration and backups

Import previews run in the browser against files the user selects. Keep source exports on disk unchanged and store derived private archives outside Git. The server requires a stable source name plus per-item `sourceId`, `hash` and validated record input. It computes its own content hash rather than trusting the supplied hash. Encoded `work-source://...` and `work-attachment://...` references are rewritten after owner-scoped IDs/private file metadata exist.

Repeated unchanged sources are skipped. Changed sources default to keeping the existing version; the user may explicitly choose replace or merge. Merge appends the changed source and preserves tags/links; it is not a semantic document merge. Each batch reports creations, updates, skips and warnings. Undo refuses later-edited records, preserving those edits. Imported PDF assets receive their private PDF as the primary attachment so exact résumé versions can be captured in applications.

Permanent deletion detaches current structured relationships and cascaded-file references from other owner records, preserving their authored content and historical revisions. It runs with candidate-set and version guards: a new relationship or competing edit refuses the deletion instead of leaving a broken backup or overwriting work. Application-captured files are never detached to bypass their protective constraint. Undo of a replacement import refuses to remove a file used by another record; reconcile that use first.

Use `GET /api/export` or Settings to obtain a versioned `work-export` JSON archive containing current records, trash, preferences, revisions, metadata and file bytes. Bundled files are limited to 20 MB; `GET /api/export?files=false` keeps metadata without bytes. Download larger files separately and record their association. See [security.md](security.md) for all request/import/restore bounds.

Store dated archives encrypted or in a private backup location. Retention is the user's choice: the application does not run a scheduled backup service or silently expire exported files. Before bulk replace, permanent deletion, schema recovery or account removal, make a new bundled export and verify its JSON structure/file entries.

Archive restore copies records into new server-generated IDs and rewrites relationships, structured reference values and attachment URLs. It leaves existing live records intact. Review the copied archive before discarding anything. Identical restore is idempotent; metadata-only archives warn that file contents were absent. An oversized archive must be split into groups containing their linked records/files/revisions; missing linked records are rejected rather than creating a broken graph.

## Recovery

For an unwanted note edit, use its revision history to save an earlier version as a new current revision. For ordinary deletion, restore from trash; files were retained. For a bad unmodified import, undo the batch. If later work exists, export it and reconcile those records individually; do not bypass the version guard.

For a Worker-code regression, inspect the known good deployment/version and roll back only the selected Worker:

```sh
npx wrangler versions list --config wrangler.jsonc
npx wrangler rollback <known-good-version-id> --config wrangler.jsonc --message "Restore the verified release"
```

Staging operations need `--env staging`. Record the selected environment, version and incident reason. Rollback restores Worker code/configuration; it does not undo database migrations or R2 deletion. Keep the previous release compatible with the current schema.

For database-level recovery, inspect Time Travel before making a restore:

```sh
npx wrangler d1 time-travel info DB --config wrangler.jsonc --timestamp <RFC3339-time>
```

Time Travel acts on the entire selected remote D1 database, including all content and sessions, rather than one note. Arrange a maintenance window, preserve a current export, resolve the intended database and timestamp/bookmark, and account for R2 changes before issuing any restore. The recovery command is `npx wrangler d1 time-travel restore DB --config wrangler.jsonc --bookmark <verified-bookmark>`; run it only as an explicit recovery action. Time Travel availability is currently seven days on Free and thirty days on Workers Paid. Verify the account's actual retention rather than assuming the paid window. [D1 limits and recovery retention](https://developers.cloudflare.com/d1/platform/limits/).

A database restore can reintroduce old sessions; use a fresh auth secret and require sign-in again when incident scope warrants revocation. It cannot recover file objects that were already permanently removed from R2. Use file bytes from a bundled archive for those cases. Test the recovery procedure on staging before relying on it for personal data.

## Maintenance and observability

Watch errors, failed saves, storage usage, D1 row reads/writes, R2 operations and Cloudflare billing/limits. The app's generic failure logs avoid note/application text and credentials; platform observability metadata still needs review. There is no promise that all operation stays within a free allowance. Document the account's billing settings, budget and available backup retention when provisioning.

Trash and revision history are retained until explicit removal. Periodically export, review unused large files and inspect private orphan objects after an interrupted permanent deletion/import. R2 cleanup must use validated owner/record IDs and metadata, never a broad bucket deletion. Do not remove unrelated databases, bindings, domains or buckets during release cleanup.

When rotating secrets or OAuth credentials, update the intended runtime environment, verify callback registration and perform a fresh sign-in. Auth-secret rotation invalidates existing cookie signatures and requires users to sign in again. Keep local/staging credentials separate throughout.
