# Radar: implementation and activation

Implemented on 16 October 2026 and released to staging and production during 16–17 October 2026. The [research and design plan](radar-plan.md) remains the detailed rationale. This document describes what the code currently does. No real Radar email has been sent by the release checks.

## Credentials

No further API accounts are required. The existing ignored `.dev.vars` entries are sufficient:

| Variable | Purpose |
| --- | --- |
| `TYPESAFE_API_KEY` | Server-side JEV evaluation using the existing balance |
| `JSEARCH_API_KEY` | Direct OpenWeb Ninja JSearch discovery; not RapidAPI |
| `APIFY_TOKEN` | Optional, explicitly enabled board collectors on an Apify Free plan |

Public Greenhouse, Lever, and Ashby feeds do not need keys. Adzuna is excluded because the user's activation terms require payment after 25 test calls. Existing private email transport settings are reused; a new email provider is unnecessary. Never add these tokens to `VITE_*` variables or browser code.

`.dev.vars` configures local development only. A release operator must install the same three names as Cloudflare Worker secrets for the intended environment. Secret values belong in a hidden prompt or the Cloudflare dashboard, not shell arguments, documentation, logs, or source control.

## What is available

Applications now has Interested and Radar tabs. Interested retains the existing company watchlist and adds saved opportunities. Existing saved company records and relationships are preserved. The release uses Interested draft keys and removes the old company-tab fallback and notes migration branch. Older unsaved company drafts are not migrated.

Radar offers separate search profiles, editable About you and resume snapshots, automatic discovery on a daily/weekly/monthly cadence, pause, and **Run once**. A manual run is allowed while automation is paused. Discovery and email have separate frequencies. All schedules use the selected timezone and handle daylight saving and short months. Automation starts paused and email disabled.

The initial profiles cover software engineering in Melbourne/Sydney, Australian cybersecurity, and software engineering around Silicon Valley/New York. These are editable search defaults, not claims about the user's experience or eligibility. Add personal qualifications and work rights to About you before relying on qualification assessments.

Resume import uses an existing successful document compilation's extracted text. The imported text is shown for editing and becomes a saved snapshot. A later resume edit does not silently change the evaluation context; import again to refresh it. If extraction is unavailable, paste the text.

Cards reuse company logos, with initials for unmatched employers, and show a separate publisher mark, green Listing link, disclosed salary and dates, descriptions, and all known source links. JEV supplies separate interest, qualification, seniority, feasibility, information sufficiency, and confidence. Interest is a rubric score, not a calibrated probability of taking the job. Missing qualification evidence remains unknown. Qualification and confidence do not silently suppress opportunities.

Sorting covers interest, qualification, confidence, discovery/posting/closing dates, company, role, and comparable salary. Filters include text, profile, source, location, country, workplace, salary disclosure/currency/period/bounds, dates, seniority, employment type, assessment status, score, confidence, flagged, unread, dismissed, tracked, and closed. Salary comparisons use disclosed, comparable bounds without currency conversion; unknown or estimated pay remains eligible. Missing job dates remain included. Results are paginated in batches of 100; use Load more to continue.

Flags, saved state, dismissal, notification history, and application tracking belong to the user's opportunity, independently of source advertisements. Saved or tracked jobs disappear from the normal Radar view. Saving an application through Radar creates the application and tracking link atomically. Cancelling the prefilled form does neither. Ordinary manually created applications also reconcile by known listing identities. Deleting an application preserves the tracked opportunity's suppression until the user explicitly restores it.

The app's existing edit-mode convention applies: hold the Applications navigation item to enable editing, then use Preferences, Run once, save/flag, and application actions.

## Sources and observed pilot results

The provider pilot was bounded and used no real user resume or email. Its script is `scripts/radar-pilot.mjs`; private receipts and responses live under ignored `.private/radar-pilot/`. Receipts prevent accidental repeat consumption.

| Source | Pilot / current connector |
| --- | --- |
| JSearch | Five one-page searches returned 50 entries with descriptions across the initial Australian and US interests. Publisher links included LinkedIn and Indeed. One cursor continuation rotates across runs. Search results are discovery coverage, not an exhaustive crawl of those boards. |
| Apify LinkedIn | Reviewed `parsebird/linkedin-jobs-scraper`; pilot returned 10 entries. |
| Apify SEEK | Reviewed `saswave/seek-scraper`; one-page pilot returned 32 entries. Hidden salary fields are not treated as disclosed pay. |
| Apify Indeed | Reviewed `automation-lab/indeed-scraper`; pilot returned 10 entries with descriptions. |
| Greenhouse / Lever / Ashby | Fixed public API endpoints for a supported board URL attached to an Interested company or configured directly. Ashby excludes explicitly unlisted postings. |
| JEV | A single synthetic-context request returned all dimensions. Reported input usage was 1,271 tokens, approximately $0.000053382 at the reviewed model rate. This is one observed request, not a future total-cost guarantee. |

Apify starts were capped at $0.05 each, at most $0.15 reserved against recurring free credits for the three pilots. Provider billing dashboards remain authoritative. Apify is optional and disabled in the default source configuration. The connector checks that the account is still on the Free plan and that reviewed event pricing remains within bounds before starting a run. A changed plan/pricing pauses that collector. Actors remain dependent on third-party collector behavior.

Arbitrary careers-page crawling, Workday, general search-engine discovery, and other custom ATS adapters are future extensions. An unsupported company careers URL is not silently fetched. Collection uses bounded responses and fixed allowed provider hosts. Lever pagination is bounded to ten pages per run; broad boards can require more targeted discovery.

## Identity and duplicate handling

Automatic identity edges are canonical job-specific listing/application URLs, provider posting IDs, board IDs across known URL variants, and employer-scoped requisition IDs. Different Google Network Engineer and Software Engineer postings remain separate. Distinct verified requisitions cannot be merged by the manual merge endpoint.

Multiple advertisements with a shared identity become one opportunity with multiple source links. New advertisements reconcile against existing Applications. A general careers homepage is never a job identity. Employer name or similar titles alone never trigger a destructive merge.

For a historical application without a job-specific listing URL, add one of the opportunity's source URLs to the application. Saving that application reconciles tracking and suppresses its Radar card. Company and role text alone cannot establish that it is the same vacancy.

When two boards omit a common URL or requisition identifier, automatic deduplication cannot establish that they represent the same vacancy. The expanded card provides **Combine duplicate listing** for human confirmation against another loaded opportunity. Use All opportunities to include saved/tracked candidates and Load more when necessary. The merge preserves aliases and suppression state; later reruns attach to the surviving opportunity. There is currently no fuzzy duplicate suggestion engine or automatic company-and-title merge.

## Spending controls and durable work

Limits are shared by credential fingerprint across users rather than independently allocated to every workspace:

- JSearch: 180 reserved requests per UTC calendar month, leaving headroom against the reviewed free allowance. Five default first-page queries plus one continuation consume up to six requests per run. Manual pings share this allowance. Other clients using the same key are not visible to Work's local counter.
- Apify: at most $4 in reserved charges per UTC month, and $0.05 per Actor run. Requires the Free plan, which supplies the final provider-side protection against paid overages. Reservations are conservative and are not refunded based on an optimistic result count. Enabling all three collectors daily will exhaust this allocation; use them selectively for coverage gaps.
- JEV: $0.50 per UTC month and $4 lifetime per token fingerprint, leaving headroom in the stated $5 balance. The local counter is not a live balance reader. Calls elsewhere and the earlier pilot are outside it. Model/pricing changes require review in code.

Hard filters and exact deduplication precede JEV. All assessment dimensions for one job/profile are requested together. Cache keys use semantic job facts, profile criteria, About you, resume snapshot, model and rubric. Flagging, saving, repeated observations and source-only changes do not invalidate an unchanged evaluation. Preference changes clear displayed assessments; cached equivalent evaluations can be reused on a later run.

Runs persist collection, ingestion and scoring tasks with leases. The minute cron resumes them; an open run also requests bounded advancement so local development does not require a simulated cron. At most 30 initial collection tasks and 40 opportunity scoring tasks are scheduled per run. Additional ingested opportunities stay visible without scores and are considered on later runs. Partial source failures remain visible in recent activity. No collector is silently replaced with a paid provider.

An uncertain Apify start is not blindly repeated. Uncertain JEV calls keep their conservative usage reservation. Job data remains available when assessment or source allowances are exhausted.

## Email delivery

The new private `/radar-digests` sender route constructs a fixed escaped template for up to 15 opportunities and uses the existing Gmail SMTP setup. Authentication messages retain outbox priority. Digests go only to the account's verified email. They do not accept arbitrary recipients, headers or HTML from Radar.

Queued digests reserve opportunity IDs and use an immutable encrypted payload and delivery ID. Acknowledged submissions mark their opportunities notified. Jobs saved, dismissed, closed or tracked before submission cancel a stale queued digest. A preference/workspace change also cancels stale queued work. Empty digests are skipped. The initial email subscription boundary avoids mailing the entire historical backlog.

An ambiguous SMTP/HTTP outcome is shown as uncertain and retains its reservation. The UI can retry the same delivery ID within its original lifetime so the private sender can deduplicate it; it does not generate a fresh duplicate batch. Acceptance by SMTP is not proof of inbox arrival. Expired or unresolved delivery reservations remain excluded from later automatic digests pending operator review, favoring duplicate prevention over repeated mail.

## Deployment and activation checklist

The database/app deployment and existing Pi sender update are complete. Personal setup and real digest inbox verification remain the user's activation steps.

1. Review the code and run the normal release checks. Back up the workspace before production migration.
2. Install the three provider secrets in the intended Worker environment. Keep the existing email transport credentials.
3. Apply D1 migration `0012_radar.sql` and deploy the built Worker through the existing release workflow. Staging and production have separate databases and secrets.
4. Update the Pi mailer using the existing installer, preserving its SQLite state and credentials. The deployed sender must contain `/radar-digests`. For staging, configure `WORK_APP_ORIGIN` to that Work environment's exact origin; production defaults to `https://work.manavdodia.com`. Verify the new template with tests and protected health checks.
5. In Radar Preferences, add personal context, review profiles and sources, and save. Run once with JSearch and any supported employer feeds first. Enable Apify selectively if needed.
6. Preview a digest. Enable Radar and, when the user explicitly wants a real message, use Email new results now and confirm inbox arrival. Then enable the chosen email cadence. Discovery can remain on a disabled cadence while email uses its own cadence; pausing Radar disables both automatic processes.

Workspace export/import accepts only the current version 2 format, including Radar preferences, opportunities, aliases and personal state. Version 1 packages are rejected; no import conversion is retained. Imports remap record relationships and pause automation. Exports exclude credentials, ephemeral queues, cached model responses and shared spending counters. Replacing/importing a workspace does not reset credential spending limits. Migration 0012 removes the redundant company `data.radar` flag in place; the company record kind identifies Interested companies directly. Demo storage uses a fresh seed version instead of upgrading old preview state.

## Local verification

The implementation is covered by TypeScript/lint, the full unit/integration suite, mailer tests with fake SMTP, Chromium tests for mobile cards, resume preferences, flags/saving and application prefill/cancel/save, and the built Worker workspace/auth runtime checks. Browser fixtures use synthetic opportunities. No real email is sent by these tests.

The release checks passed 97 unit/integration tests, 12 mailer tests, and all 47 browser tests, plus build and runtime checks. Desktop and mobile screenshots were inspected. The built Worker checks intercepted all email submissions.

## Release verification, 16–17 October 2026

- Staging version: `fa359edc-59ad-4f59-a897-58f973ebb85e`. Applied its pending 0011 and 0012 migrations; checked live assets and denied unauthenticated Radar access.
- Production version: `287905cc-765c-4e4f-b107-c8595ca5ba1c`. Applied only pending migration 0012. The live frontend assets match the verified build, and authentication and email configuration remain healthy.
- Production preserved 18 records, 10 attachments, and the existing account. There are zero Radar settings rows, so no discovery or digest schedule has been activated by deployment.
- A private D1 recovery bookmark was recorded before migration. SQL export was unavailable because the database contains FTS5 virtual tables.
- Updated the existing Pi sender with the code-only update command. Its private configuration checksum is unchanged. Protected health verified Gmail authentication and Radar template support; both `/emails` and `/radar-digests` rejected invalid inputs without sending mail.
- The existing three production provider secrets were already present and were preserved. Automatic approval review rejected copying their values to staging because credential access for that additional environment was not specifically authorized. Staging was deployed without provider credentials; production was unaffected.
- The live production Radar preferences and Interested view were checked using the local demo workspace, with no real workspace mutations. Actual provider availability over time, deployed discovery runs, and digest inbox arrival remain to be checked after the user supplies preferences and explicitly activates them.
