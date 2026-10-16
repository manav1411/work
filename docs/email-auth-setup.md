# Email authentication setup and cutover

The implementation replaces GitHub sign-in with Work's own email/password screens. Better Auth stays in the Worker; D1 stores users, password hashes, sessions and encrypted challenges. Production email delivery now uses the Pi with Gmail's authenticated SMTP service; see [mailer operations](../mailer/README.md). The unused direct-to-recipient Postfix transport still requires its own ISP/DNS prerequisites.

## Configuration

Keep separate production and staging secrets. Preserve the existing `BETTER_AUTH_SECRET`; rotating it signs users out and invalidates outstanding codes. Runtime settings:

| Setting                                                             | Purpose                                                                |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                                                | At least 32 random characters; never a browser/build variable.         |
| `APP_ORIGIN`                                                        | Existing environment-specific HTTPS application origin.                |
| `AUTH_MAILER_URL`                                                   | Dedicated private sender HTTPS origin, without a path/query/userinfo.  |
| `AUTH_MAILER_TOKEN`                                                 | At least 32 random characters, matching the Pi's `WORK_MAIL_TOKEN`.    |
| `AUTH_MAILER_ACCESS_CLIENT_ID` / `AUTH_MAILER_ACCESS_CLIENT_SECRET` | Dedicated Cloudflare Access Service Auth credentials for the sender.   |
| `AUTH_MAIL_FROM`                                                    | Sender mailbox matching the Pi configuration and authenticated domain. |

Create `.private/email-auth-staging.json` or `.private/email-auth-production.json` containing the five sender settings (including the Access pair). Omit `BETTER_AUTH_SECRET` when the Worker already has one. The configuration helper preserves existing secrets and generates a fresh auth secret only when absent. Never copy the production auth secret to staging.

```sh
npm run auth:configure -- staging
npm run auth:configure -- production
```

For local real authentication, use `.private/email-auth-local.json` and `npm run auth:configure -- local`, then explicitly set `LOCAL_DEV_AUTH=false` and restart the dev server. Loopback HTTP mailer URLs are accepted only in the local environment. The helper preserves existing local settings and keeps a private copy before editing. It does not silently disable fixtures.

`/api/health` reports `authenticationConfigured` and `emailDeliveryConfigured` separately. Sign-in/session checks need only the auth secret and origin; creating or resending codes additionally requires a valid sender configuration. A configured but offline Pi does not stop existing sessions or password sign-ins. It delays new verification/recovery emails; the encrypted outbox retries while codes remain valid. Health configuration flags do not prove delivery.

## Staging acceptance

Apply additive migration `0011_email_auth.sql`, then deploy the code to staging. Standard deploy scripts include migrations and built-Worker runtime tests. Migration 0011 adds registration proofs, authentication versions, shared limits, an encrypted mail outbox, a unique verification identifier and database triggers for session revocation. It preserves account IDs, workspace content and file ownership. It also normalises email casing and fails rather than merging ambiguous legacy emails.

Run the standard checks plus `npm run test:mailer`. `npm run test:runtime` exercises the built Worker with fixture auth disabled, real native password hashing, concurrent registration, verification, session cookies and recovery; all outbound mail is intercepted. Its timings are local workerd timings. Test the actual deployed staging Worker under its account CPU/memory limits and confirm real inbox delivery before production.

Walk through create account, six-digit verification, login, recovery, expiry, invalid/reused codes, resend cooldown, restored verification after a page refresh, Pi offline/retry and account isolation. Normal login must not ask for a code. Check mobile, keyboard navigation, paste, autofill and leading-zero codes. Auth fields never persist passwords in browser storage.

The pending registration is bound to a host-scoped HttpOnly cookie. Lost/older registration contexts recover by setting a fresh password with an emailed recovery code. This replaces an unverified account's earlier password before granting access. A successful reset revokes all old sessions. If a database operation fails after consuming a code, request a new code rather than reporting success.

## Owner migration

The operator's ignored `.private/email-owner.json` contains exactly the pinned `githubId`, `githubLogin` and destination `email`; it never contains a password.

Production recovery on 16 October 2026: email/password authentication was already live, but the existing verified owner had no password credential and `/api/health` reported `emailDeliveryConfigured: false`. With the owner's explicit instruction, an operator created the missing credential using Better Auth's password hashing on the account selected by its pinned GitHub identity and verified destination email. The guarded operation preserved the user ID and all 18 workspace records and revoked old sessions through the database trigger. Live production sign-in and session resolution passed; the test session was then signed out. No password or hash is recorded here. At that point the mail sender was unconfigured, leaving sign-up, verification and emailed recovery unavailable.

Production mail activation later that day: the owner selected Gmail SMTP on the Pi. A dedicated `work-mailer@production` service now connects to Gmail over verified TLS with an App Password stored privately on the Pi. Its localhost endpoint is exposed through `work-mailer.manavdodia.com` with a dedicated Cloudflare Access Service Auth identity and bearer token. Five sender settings were uploaded to the existing Worker while preserving its auth secret. Production health reports `emailDeliveryConfigured: true`; a real owner recovery email was accepted on the first attempt, and the owner confirmed inbox arrival. The recovery test did not change the password. The existing compiler and tunnel remained active.

```sh
npm run auth:owner -- production check
```

The check is read-only and reports whether the email matches, whether a credential exists, and the owner's record count. It requires both pinned GitHub ID and login to identify exactly one account and rejects target-email conflicts. Do not auto-merge accounts by email.

For future migrations where the email already matches and the password is missing, use **Forgot password** after delivery is ready to create the credential on that same user ID. Enter the code and choose the password privately. The app permits 8–128 characters, supports password managers and encourages a longer phrase. Do not reuse a password disclosed in chat.

If a different destination email is needed, `npm run auth:owner -- production prepare` requires a healthy protected mailer and performs a guarded email update on the same user. Database triggers mark the new address unverified and revoke sessions; verified recovery is still required before signing in. Rehearse against a synthetic staging account before any production mutation.

Prove that email login restores the existing workspace and attachments, then retire the GitHub provider account/tokens:

```sh
npm run auth:owner -- production retire-github
```

This refuses to proceed without a verified destination and a stored password credential. Retire `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and `ALLOWED_GITHUB_USERS` Worker secrets after acceptance. Repository/build GitHub integration is independent and stays in place.

## Production release gate

Prepare and verify the mail transport, staging runtime limits, real inbox delivery, and owner recovery before removing the live GitHub flow. Do not deploy this cutover while sender configuration is absent or the owner has no working recovery route. Coordinate any session interruption with the owner. The initial production deployment crossed this gate without sender configuration; owner sign-in and production Gmail delivery have since been restored and verified. Staging's sender requires its own configuration before staging inbox acceptance.
