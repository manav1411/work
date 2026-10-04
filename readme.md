# Work

A small career tool connecting your goals, learning, applications, and existing documents. Work keeps its expressive typography, colour, outlines, and shadows while reducing the information you need to maintain.

Configured host: [work.manavdodia.com](https://work.manavdodia.com) · Repository: [manav1411/work](https://github.com/manav1411/work)

## Current product

The simplification is implemented in this working tree. Publishing and production migrations are separate release steps. See [verification](docs/verification.md) for the actual checks and outstanding release work, and [the simplification plan](docs/simplification-plan.md) for the product decisions.

| Page                               | What it does                                                                                                                                                                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Home** (`/home`)                 | A timeline of interviews, application deadlines, explicit follow-ups, goals, and dated milestones. Goals can use completion, a manually updated number, milestones, curriculum tasks, roadmap problems, or total LeetCode solves as their measure. |
| **Learn** (`/learn`)               | The personal website's week cards, authored slides, homework, task completion, and problem roadmap adapted to Work. A compact Pomodoro sits beside practice. Other engineering topics retain their relevant resources.                             |
| **Applications** (`/applications`) | A single list with company, role, stage, and scheduled dates. Application details hold interviews, document destinations, and optional meeting, contact, vacancy, or Notion preparation links.                                                     |
| **Documents** (`/documents`)       | Résumé and cover-letter links that open directly in Overleaf.                                                                                                                                                                                      |

Settings and Sign out are in the account menu. Settings contains account information, timezone, LeetCode username, reduced motion, backups, retained files, and device-draft recovery.

Interviews and application dates are edited in their source records and derived into Home's timeline. There is no second calendar to maintain. Progress uses the goal's chosen measure; timer minutes and elapsed time do not imply completion.

Notes, work evidence, weekly reviews, capture, global search, suggestions, company questionnaires, outreach drafts, résumé authoring/uploads, and separate focus/practice destinations are retired. Existing records and files remain recoverable rather than being deleted with their interfaces.

## Existing tools and shared learning

Write your documents in Overleaf and keep work notes in Notion. Work stores destinations rather than recreating those editors. An Overleaf URL points to the document's current contents; it is not an immutable copy of a submitted résumé. Existing submitted files and snapshots remain in backups.

The learning interface is adapted from the sibling `Personal-website` repository. This checkout includes a self-contained versioned snapshot of its foundations, so builds do not depend on that sibling directory. See [learning provenance](src/features/learn/foundations/PROVENANCE.md) for source paths, revision, and update instructions.

Live content and progress use an explicit authenticated Work proxy to the fixed source `https://manavdodia.com`:

| Work endpoint                 | Personal-site source           | Purpose                                                                |
| ----------------------------- | ------------------------------ | ---------------------------------------------------------------------- |
| `GET /api/learning/content`   | `GET /api/admin/content`       | Authored weeks, slides, homework, and stable task IDs                  |
| `GET /api/learning/stats`     | `GET /api/leetcode?username=…` | Public totals, recent activity, and accumulated observed solve history |
| `GET /api/learning/progress`  | `GET /api/progress?username=…` | Shared curriculum checkboxes                                           |
| `POST /api/learning/progress` | `POST /api/progress`           | Update the same task completion used by the personal site              |

Set the LeetCode handle once in Settings. Existing legacy profile configuration is recognised during transition; clearing the handle removes that fallback connection. Checklist ownership on the personal site uses the public handle. Private goals, applications, interviews, Work cookies, and sign-in tokens are not sent to that source.

The Worker validates source responses, caches successful data by owner/source, and returns that data with its actual age and an error state during source outages. Accumulated observations are not a complete retrospective history of every solved problem. The public demo uses synthetic content and progress without provider requests.

Pomodoro state is stored on the device and calculates remaining time from timestamps across reloads and background tabs. Starting it creates no journal, reflection, or learning-completion record. Learn's topic tabs remain horizontally scrollable without a visible scrollbar.

## Local development

Use Node 22.18 or newer, as required by `package.json`. For a new checkout:

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run db:local
npm run dev
```

Open `http://127.0.0.1:5180`. Preserve an already configured `.dev.vars` instead of copying over it. The example enables isolated local fixture authentication; that access is rejected in staging and production. Real GitHub sign-in uses environment-specific OAuth credentials and the existing owner restrictions.

Apply all migrations in order. `0004_simplification.sql` adds owner-scoped goals and learning-source caches while keeping existing records, revisions, submitted files, and connector tables readable. `.dev.vars`, `.private`, `.wrangler`, build output, and browser artifacts are ignored by Git. Store private exports in `.private` or outside the checkout.

For a stale Vite dependency cache during development, restart with `npm run dev -- --force`.

## Backups and retirement

Settings downloads a version 2 archive containing goals alongside records, revisions, preferences, and files. Restore accepts versions 1 and 2, copies saved records/files/goals into separate IDs, and preserves relationships. Repeating the same archive restore is idempotent. Restoring also restores its settings; current records remain.

Full exports embed up to 20 MB of files. Metadata exports and individual original-file downloads are available for larger collections. Unsynced edits are kept in a device outbox with retry, download, separate-copy recovery, and explicit discard controls. Sign-out waits for those changes to be resolved.

Old routes have intentional destinations: `/today` → Home, `/focus` → Learn, `/practice` → the identifiable problem context, `/assets` → Documents where the current document is identifiable, and `/interviews` → its application/interview context. Other retired pages and unconvertible document links lead to Settings recovery.

The old connector design is retained as [historical planning](docs/connectors-plan.md) and [historical setup](docs/connectors-setup.md). Scheduled connector sync, suggestion generation, and webhook ingestion are inactive. Existing connection credentials and retained content can still be removed or recovered through Settings; new learning requests use the explicit source proxy above.

## Checks

```sh
npm run check
npm test
npm run test:e2e
npm run build
npm run test:runtime
```

Browser tests use installed Chrome locally and Playwright Chromium in CI. They exercise the reduced workflows, mobile navigation, account menus/sign-out, shared learning, timer persistence, application/interview dates, Overleaf links, legacy recovery, additive backups, and offline device drafts. Unit and backend coverage retain ownership, authentication, persistence, conflicts, date/timezone handling, goal metrics, and backup boundaries.

Run the runtime check after building: it executes the built Worker in workerd with synthetic fixtures. Commands listed here describe the verification workflow; their results belong in [verification](docs/verification.md), not an assumed release status.

## Hosting and release

The Vite Cloudflare plugin builds the React client and Worker. `scripts/check-build.mjs` checks the intended environment, domain, and isolated D1/R2 bindings before release.

| Environment | Worker         | Database       | Private files        |
| ----------- | -------------- | -------------- | -------------------- |
| Production  | `work`         | `work-prod`    | `work-files-prod`    |
| Staging     | `work-staging` | `work-staging` | `work-files-staging` |

Production is configured for `work.manavdodia.com`; staging uses `https://work-staging.manavdodia.workers.dev` and does not attach the production domain. Sign-in credentials and bindings are separate between environments.

The release commands build, check the runtime, apply the target's remote migrations, and upload the Worker:

```sh
npm run deploy:staging
npm run deploy
```

Review staging and preserve a current backup before a separate production rollout. No deployment or production migration is implied by implementing this simplification. The existing [launch setup](docs/launch-setup.md), [operations](docs/operations.md), and [security boundaries](docs/security.md) retain infrastructure and historical launch context; any instructions for retired product screens are superseded by the current workflows above.
