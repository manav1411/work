# Work

A private workspace for career direction, learning, applications, interview preparation, and documents. React/Vite serves the browser; a Cloudflare Worker provides authenticated APIs; D1 stores current content and a private R2 bucket stores files.

GitHub sign-in uses an environment-specific private allowlist. See [authentication setup](docs/github-allowlist.md). Production and staging use separate databases, buckets, and credentials.

## Development

Use Node 22.18 or newer. Preserve an existing `.dev.vars` when configuring development.

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run db:local
npm run dev
```

Open `http://127.0.0.1:5180`. Local fixture authentication requires a local environment, an explicit flag, and a loopback hostname. Browser demo data stays in its own session storage.

```sh
npm run check
npm test
npm run test:e2e
npm run build
npm run test:runtime
```

## Current content only

The app accepts the current schemas and routes. Recruitment processes use explicit statuses and ordered Planned/Completed steps. Appointments belong to a recruitment step. Notes use the current rich document format. Directions, STAR stories, learning tabs, goals, and documents have explicit contracts.

Deletion is permanent. Deleting an application deletes its appointments and preparation. Deleting a recruitment step deletes its appointments and preparation. Deleting a custom content tab deletes its notes. Independent relations detach atomically. Files are removed from D1 and R2; failed physical cleanup is retried.

Autosave, current device drafts, retry queues, and version counters remain. Version counters detect concurrent edits; they do not store earlier content. There are no revision snapshots, trash recovery, import undo, saved conflict archives, submission snapshots, legacy routes, old import readers, or retired connector services.

## Workspace export and upload

Settings exports one `work-workspace` version 1 TAR containing `workspace.json` and separate file entries. It includes current records, rich notes, relationships, goals, preferences, documents, current LaTeX sources, and required build files. It excludes authentication, credentials, device drafts, and temporary upload state. Finish syncing edits before exporting.

Uploading an export replaces the current workspace. All file bytes are staged and validated before a single D1 transaction replaces content. Upload refuses incomplete packages and concurrent changes. Repeating a commit is safe. IDs are remapped and relationships remain connected. Abandoned uploads expire after one hour. Old devices are blocked by a workspace epoch and discard obsolete local edits on their next load or refresh.

Only the current TAR format is accepted. The manifest is limited to 32 MB, individual files to 10 MB, records/files to 5,000 each, and goals to 1,000. Files upload separately; there is no small aggregate binary-export limit.

## Documents and learning

Native resume and letter documents contain an editable LaTeX project and compile through the private Pi compiler. Only the current source, active build inputs, and the last successful preview needed during a build are retained. Older sources and unused artifacts are deleted. Independent document copies remain independent. See [compiler operations](compiler/README.md).

Learn uses the static 150-problem roadmap and authenticated public LeetCode statistics. The statistics cache is scoped by owner and handle; private workspace content and authentication never go to the statistics source. Goals use completion or current LeetCode totals, without recorded progress history.

## Deployment

```sh
npm run deploy:staging
npm run deploy
```

See [operations](docs/operations.md), [security](docs/security.md), and [verification](docs/verification.md). Migration `0009_current_workspace.sql` intentionally resets the previous testing workspace while retaining authentication. Old migration implementations were removed; fresh databases use `0001_workspace.sql` plus `0009_current_workspace.sql`.
