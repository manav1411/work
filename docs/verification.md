# Verification

Required checks: TypeScript/ESLint, unit/API tests, browser tests, the private mailer tests, production build, and built Worker runtime checks.

API coverage verifies current contracts, ownership, current-content retry receipts, conflict counters, permanent deletion and parent cascades, account removal, full file export/upload, replacement semantics, missing files, changed workspaces, repeated commits and stale-device writes. Runtime checks execute the built Worker with D1/R2, including a file package larger than 18 MB and native source pruning.

Email authentication tests use the real Better Auth/D1 adapter with synthetic accounts. They cover public registration, protected identity fields, browser-bound verification, preregistration recovery, expired/replaced/reused/wrong codes, attempt limits, concurrent consumption, cookie sessions, cross-account isolation, password reset, session revocation, a password-check/reset race, database failure recovery, legacy owner preservation and encrypted outbox retries. Unexpected auth failures must not log raw adapter errors or credential hashes.

`npm run test:runtime` additionally exercises the bundled Worker with fixture auth disabled: concurrent native password hashing, email submission intercepted locally, verification, sign-in and recovery. It sends no real email. These are local workerd checks; deployed CPU-tier limits and inbox delivery still require staging validation.

`npm run test:mailer` uses a fake SMTP transport to verify templates, strict inputs, expiry, duplicate IDs, temporary refusals, ambiguous submission and crash recovery. It sends no real email. GitHub CI runs this alongside the application tests.

Browser checks cover sign-up, verification after a page refresh, password visibility, code paste/leading zeros, password recovery errors and success, password-storage exclusion and mobile auth layouts, alongside existing editor/application/interview/learning/document flows. A local Chromium executable can be selected with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when system Chrome is absent.

The shared account form also checks action-specific password validation and retry/recovery guidance without losing the entered email. Physics checks cover ten simultaneous logos, animated arrow colours, dragging against the form, clear form pixels, and no page overflow down to a 320 × 568 viewport. Silhouette colliders preserve gaps in the letters and arrow; sleeping bodies skip simulation work, and background tabs pause it.

Deployment acceptance checks `/api/health` in both environments, private APIs rejecting unverified/unauthenticated requests, the additive auth schema, real Gmail/Outlook delivery, offline sender recovery, and preservation of the existing owner's workspace and attachments. Run the read-only owner check before migration, then verify email recovery and login on the same user ID. No synthetic identity or automated mock result proves production mailbox ownership. Do not reapply the historical testing-content reset migration to wanted data. See [cutover instructions](email-auth-setup.md).
