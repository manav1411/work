# Operations

Production: `https://work.manavdodia.com` (`work`, D1 `work-prod-current`, R2 `work-files-prod`). Staging: `https://work-staging.manavbdodia.workers.dev` (`work-staging`, D1 `work-staging-current`, R2 `work-files-staging`). Cloudflare account: `235b7f098227aa97860dfd1d4ea9ee71`.

## Authentication and secrets

Preserve the existing GitHub OAuth applications and Better Auth secrets. Access is controlled by the private runtime `ALLOWED_GITHUB_USERS` secret; see [allowlist setup](github-allowlist.md). Local fixture authentication must never be enabled on either deployed environment. The compiler uses its own bearer token and optional Cloudflare Access service token.

`/api/health` reports environment and authentication configuration without credentials. `/api/session` returns the validated identity or null. Production and staging remain isolated. A health response alone does not prove a successful GitHub callback.

## Release

Run `npm run check`, `npm test`, `npm run test:e2e`, `npm run build`, and `npm run test:runtime`. Deploy staging with `npm run deploy:staging`, then production with `npm run deploy`. The deployment scripts validate environment bindings, run the built Worker checks, apply migrations, and deploy Worker/frontend assets together.

Fresh databases use `0001_workspace.sql` and `0009_current_workspace.sql`. Existing databases that applied the former migrations apply only the new migration. Migration 0009 deliberately deletes testing content and removes its old tables, preserving users, provider accounts, and sessions. Do not reapply it to a workspace with wanted content.

GitHub/Cloudflare build configuration is managed by `scripts/cloudflare.mjs`; do not reconnect a working build trigger or expose API tokens. CLI release does not establish that a Git-triggered build completed.

## Current persistence

Records, goals, preferences, relationships, and file metadata contain current state only. Deletion is permanent and cascading where child content belongs to a removed parent. A durable cleanup queue retries physical file removal. A one-minute scheduled handler resumes active compilation, expires abandoned uploads, and drains file cleanup.

Settings exports the current full workspace and uploads it by replacement. Upload sessions expire after one hour. Completed upload receipts are temporary; retrying the same commit returns the same result. No scheduled user backups, import undo, trash, or earlier-content storage exists. Version counters and workspace epochs prevent conflicting or obsolete edits; they do not provide content history.

[Cloudflare D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) is always enabled by the provider. Fresh databases detach the app from the deleted databases’ recovery history; new provider recovery history still accumulates.

## Private files and local reset

Keep R2 private. Workspace exports contain personal content and should stay outside Git. Native compiler job results are bounded temporary transport state, retained for at most one hour to finish interrupted requests; they are not user backups. Work removes unused source/build files after saves and compilation.

The current device-storage schema clears older Work caches/drafts on first load. Replacement clears the current device's cached workspace; other devices clear obsolete caches on their next load or refresh. Browser storage on an offline device cannot be remotely deleted.
