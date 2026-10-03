# Verification log

Checked 3 October 2026. This log distinguishes local verification from the account-dependent production release gates.

## Completed checks

- TypeScript and ESLint: `npm run check` passes.
- Unit/server/parser tests: 68 tests pass against actual Miniflare D1/R2, including authenticated Better Auth session resolution, immutable owner IDs, cross-owner data/file/search/export/link rejection, secure OAuth state/redirect initiation, concurrency/revisions, D1 batching, submitted-PDF protection, account deletion, import/undo and versioned recovery. Seven release-audit regressions cover structured-reference cleanup, backup round trips after record/file deletion, competing edits/new relationships, late application-file capture, single/batch create preflight races, and fail-safe replacement-import undo. Four complete callback tests use synthetic GitHub token/profile/email responses with real OAuth state/cookies: owner creation/session/account binding, foreign-owner rejection, client identity-field mutation rejection, and returning sign-in after a username change.
- Browser tests: 17 pass. Coverage includes Notes save/history/draft recovery/private file preview; learning evidence → Today; repeated practice attempts/review dates; résumé/PDF version → application snapshot → interview; evidence → story/bullet; project milestones → case study; offer unknowns; weekly review → action; capture/search/focus; preferences; import/trash/archive; responsive routes; and actual local API offline edits/reconnect.
- All 17 launch routes were checked at 390 px width with no document horizontal overflow or page exceptions. Desktop and mobile Today screenshots were inspected. Reduced motion and dark theme are user preferences.
- `npm audit`: zero advisories, including dev dependencies, at this verification time.
- Production and staging D1 migrations `0001`/`0002` applied successfully to different databases. Separate private R2 buckets exist. Both Workers deployed successfully.
- Production custom-domain mapping is enabled in Cloudflare. Public DNS resolves to Cloudflare; TLS/HTTPS, SPA `/notes` deep routing and CSP/security headers return 200. The local resolver initially retained an NXDOMAIN answer; a direct request using the verified public DNS answer also succeeds.
- Production `/api/health` reports environment `production`; staging reports `staging`. Production private records return 401 without sign-in; missing OAuth configuration never yields a fixture account. The dedicated production credentials were securely uploaded, health reports authentication configured, and the real sign-in button reaches GitHub's login page. This is not yet evidence of a completed provider callback.
- The implementation was pushed to GitHub. Its [first Workspace checks run](https://github.com/manav1411/work/actions/runs/37124445352) passed the clean Linux dependency install, type/lint, unit, browser, build and production binding checks. The owner subsequently confirmed the Cloudflare GitHub connection; a fresh Git-triggered deployment is being verified separately.
- The public production preview was checked in Chrome on desktop and at 390 px width: no page exceptions or horizontal overflow across all launch areas; custom-domain HTTPS/CSP and signed-out private API rejection also passed. The earlier local negative DNS cache has cleared.
- Actual source import, using the Settings interface against local fixture storage: 13 Notion notes, two screenshots and one résumé PDF, 14 records/three attachments total; historical flags preserved and zero dangling page links. Original files remain untouched. Private source data is absent from repository fixtures and the public demo. Temporary synthetic test records were removed independently of the original sources.

## Not yet verified

A completed real production provider callback; production cloud migration/private-device persistence; an observed Git-triggered deployment after the owner-reported connection. Optional staging authentication requires its own OAuth app and remains disabled. See [launch-setup.md](launch-setup.md).

An emulated storage test is not a replacement for a real production login. A manual CLI deployment is not a replacement for a verified Git integration. No test sent an application, outreach message or email, or modified the personal website.
