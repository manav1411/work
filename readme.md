# Work

A personal engineering workspace for learning, applications, interview preparation, documents, and longer-term career direction.

Configured host: [work.manavdodia.com](https://work.manavdodia.com) · Repository: [manav1411/work](https://github.com/manav1411/work)

## Current product

The [Work improvements plan](docs/work-improvements-plan.md) is implemented in this working tree. See [verification](docs/verification.md) for checks and release limits. Production deployment and remote migrations remain separate.

| Page               | What it does                                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Home**           | One timeline of appointments, application deadlines/follow-ups, goals, milestones, and direction/radar reviews. Entries open their source records.                                                      |
| **Learn**          | DSA/Python roadmap, shared LeetCode solve calendar and Pomodoro; editable engineering topics, reading links, optional Markdown/checklist sections, ordering, and deletable defaults.                    |
| **Applications**   | Searchable, sortable tracker with Company, Role, Listing link, Status, application date, location, and notes. Company radar and custom recruitment timelines sit alongside appointments.                |
| **Interviews**     | Behavioural/technical introductory notes, custom tabs, reusable STAR cards, and appointment-specific preparation with resources and linked stories.                                                     |
| **Documents**      | Inline résumé/cover-letter families and independent variants, native LaTeX sources and PDF previews/downloads, private PDF/image/text uploads, application links, source differences and profile links. |
| **Your Direction** | Career paths, streams/experiences, decisions, goals, and a timeline grouped by quarter or year. Existing authored paths and decisions retain their IDs and content.                                     |

Settings and Sign out live in the account menu. Settings includes timezone, public LeetCode identity, light/dark appearance, reduced motion, Download backup, and Restore backup. Device recovery appears only when drafts are present. Mobile navigation has Home, Learn, Applications, and a More drawer.

Application outcomes, recruitment step states, and appointment states are distinct. Completing an appointment does not claim that a recruitment round was passed. Archived steps retain appointment references. Document variants are independent and can optionally link to stable application IDs; historical submitted-file evidence remains in storage/backups.

Native résumé/cover-letter editing uses CodeMirror sources and PDF.js preview, with real TeX Live/latexmk compilation through the authenticated Worker and a private native Raspberry Pi service. Work submits queued jobs through Cloudflare Tunnel and polls their outputs; the Pi handles compilation independently of request deadlines. Immutable source revisions, PDF artifacts, compile diagnostics and extracted text stay together. See [compiler setup](compiler/README.md). Résumé/letter families accept LaTeX sources; arbitrary PDF/image/text uploads belong under Other documents. The per-file upload limit is 10 MB, and native projects allow up to 100 source files totalling 5 MB. No external editor connection is used.

The prospective TypeSafe/Jev ideas are saved in [jev-ideas.md](docs/jev-ideas.md). No AI API, scraper, email integration, or paid automation is enabled by this change.

## Learning and private content

The roadmap is a versioned snapshot derived from the sibling personal website; [provenance](src/features/learn/foundations/PROVENANCE.md) records its origin. Problem definitions are centralised in `src/content/problems.ts`. Built-in outward NeetCode links are removed; dataset provenance is retained.

Only authenticated `GET /api/learning/stats` proxies the public `https://manavdodia.com/api/leetcode?username=…` source. Successful responses are cached by owner and handle; outages return their actual freshness/error state. Private Work notes, goals, applications, cookies, and sign-in tokens never go to that source. Weeks/content/progress mutation endpoints are retired. Existing curriculum-measured goals retain recorded progress until explicitly converted.

Pomodoro state stays on the device and uses timestamps across reloads/background tabs. Timer minutes do not imply learning completion. The demo uses synthetic learning statistics without provider requests.

## Local development

Use Node 22.18 or newer:

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run db:local
npm run dev
```

Open `http://127.0.0.1:5180`. Preserve an existing `.dev.vars`; the example enables isolated local authentication that staging/production reject. Real GitHub sign-in retains the existing account restrictions and environment-specific OAuth credentials.

Apply all migrations in order. `0005_workspace_improvements.sql` retains imports/history, snapshots company names, migrates a missing public LeetCode preference, retires connector credentials, and adds goal/direction integrity. `0006_backup_staging.sql` adds resumable restore sessions. `0007_native_latex.sql` separates compilation progress from authored revisions and protects submitted source/PDF references. No production data was migrated during implementation.

`.dev.vars`, `.private`, `.wrangler`, build output, and browser artifacts are ignored. Keep private exports outside version control. For a stale development dependency cache, restart with `npm run dev -- --force`.

## Backups and recovery

Download backup produces a version 3 TAR archive with a JSON manifest and separate binary files streamed from private storage. Browser preview reads headers/metadata without loading the entire archive. Restore uploads bounded files into a 24-hour owner-scoped session, resumes interrupted uploads, then commits record/file/goal metadata atomically. Repeating the same restore is idempotent. Records are copied; settings take the backup values. Step IDs, story references, custom content parents, attachments, and goal/direction links are remapped consistently.

Versions 1 and 2 JSON backups remain readable. Missing original file bytes are explicitly marked in metadata and reported during recovery. There is a 32 MB manifest limit and a 10 MB limit per file; the old 20 MB aggregate binary-export ceiling does not apply to TAR archives. The demo downloads JSON backups from its tab-local store.

Record changes use the existing retryable outbox. Debounced notes and failed editor saves retain owner-specific local drafts, surface conflicts, and require review before replacing newer saved text. Settings can download drafts separately from the server backup. Uploads and restore files have explicit retry states rather than being represented as protected text-outbox changes.

Old routes have useful destinations: `/today` → Home, `/focus` and identifiable `/practice` records → Learn, `/assets` → Documents, `/career` → Your Direction, and `/companies` → Applications radar. Other retired records remain included in backups.

Connections, provider callbacks/setup/sync routes, webhooks, and scheduled jobs are retired. GitHub sign-in, direct profile/source links, and public LeetCode statistics remain. Historical [connector planning](docs/connectors-plan.md) and [setup](docs/connectors-setup.md) are superseded by these workflows.

## Checks and release

```sh
npm run check
npm test
npm run test:e2e
npm run build
npm run test:runtime
```

Browser coverage exercises all six pages, desktop/mobile navigation, both themes, learning/content edits, timeline/process/appointment flows, interview preparation, document replacement, additive legacy backups, and offline recovery. Automatic screenshots are disabled; failure traces remain available. Runtime checks execute the built Worker in workerd with synthetic fixtures.

The Vite Cloudflare plugin builds the client/Worker. `scripts/check-build.mjs` verifies environment, domain, and isolated D1/R2 bindings. Production uses Worker `work`, database `work-prod`, and bucket `work-files-prod`; staging has separate bindings and no production custom domain.

```sh
npm run deploy:staging
npm run deploy
```

These commands apply remote migrations and publish; they were not run for this implementation. Review staging and preserve a current backup before production rollout. Infrastructure context remains in [launch setup](docs/launch-setup.md), [operations](docs/operations.md), and [security](docs/security.md); instructions for retired screens are historical.
