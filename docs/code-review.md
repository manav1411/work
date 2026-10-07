# Code review

Reviewed on 7 October 2026. Baseline commit: `134765f` (`lots of UI fixes`). This report describes the working tree, including the existing document-preview and demo edits. It proposes changes; it does not implement them.

The largest opportunities are to fix content-remapping and persistence edge cases, establish one authoritative source for local configuration per environment, remove unused styling, and give shared UI rules a single owner. The project already has substantial authentication, ownership, concurrency and runtime checks. Preserve those controls while simplifying the implementation.

## Scope and evidence

The review covered frontend, shared contracts, Worker routes and database code, SQL migrations, compiler controller and sandbox scripts, setup/deployment scripts, tests, styles, documentation, dependency/configuration files, and local private configuration. Credential values were inspected only to identify names, locations, permissions and duplication; none are included here. Generated build artifacts were checked for known current credentials and measured for size. Dependency internals and generated artifacts were not reviewed as authored application code.

Evidence is distinguished below:

- **Reproduced:** observed by running a check, browser reproduction or a direct invocation of project functions.
- **Source:** follows from the implementation; the specific failure has not been reproduced against a live deployment.
- **Design:** a maintainability or performance improvement, rather than an established defect.

No production/staging deployment, secret rotation, Cloudflare configuration change, Pi installation or remote data modification was performed. Local tests and builds produced ignored artifacts. Existing working-tree changes were preserved, including the deleted `docs/bugs_v2.md`. The concurrently present `docs/jev-applications.md` proposal was also considered when classifying planned content.

The system has three legitimate execution boundaries: the React/Vite browser application, the Hono Worker with Better Auth/D1/private R2, and the Node/Linux LaTeX compiler. Consolidation should respect those boundaries. In particular, browser configuration must never absorb service credentials.

Approximate tracked inventory at review time:

| Area | Size / observation |
| --- | --- |
| TypeScript | 96 `.ts` files, approximately 17,350 lines |
| React components | 42 `.tsx` files, approximately 12,501 lines |
| JavaScript modules | 12 `.mjs` files, approximately 1,583 lines |
| CSS | 19 files, 9,710 lines; 31 `!important` declarations |
| Markdown | Nine tracked documents before this report and the new proposal |
| SQL | Two migrations, approximately 115 lines |
| SVG | 81 assets, largely company/service marks |

An AST-based import traversal from `src/main.tsx` and `worker/index.ts`, supplemented by text searches for CSS, configuration and test consumers, informed the removal candidates. Being outside that graph alone is insufficient to delete operational scripts, public assets, test fixtures or planned content.

## Validation results

| Command / check | Result | Interpretation |
| --- | --- | --- |
| `npm run check` | Passed | TypeScript and current ESLint rules pass. |
| `npm test` | Passed: 10 files, 59 tests | Does not include the compiler's Node test suite. |
| `npm run build` | Passed, large-chunk warning | Main browser JS is 741.28 kB minified / 230.71 kB gzip. |
| `node scripts/check-build.mjs production` | Passed | Generated production bindings and fixture checks pass. |
| `npm run test:runtime` | Passed | Built Worker/D1/R2 checks include a binary package over 18 MB, replacement, stale epochs, permanent deletion, native source pruning and account removal. |
| `npm run test:e2e` | 32 passed, one failed | PDF test attempts to click a disabled zoom control; see finding 28. |
| `npm run test:e2e -- tests/pdf-documents.spec.ts --workers=1` | Same failure | Confirms the PDF failure in isolation. |
| `node --test compiler/server.test.mjs` | Two passed, one failed | Test assumes `xelatex` is supported; controller rejects it. |
| `npm run format:check` | Failed | Flags `src/features/assets/LatexPdfPreview.tsx` and `worker/validation.ts`. The preview file already had user edits. |
| Browser with blocked session storage | Failed to start | Two `Storage blocked` page errors; loading screen remains. |
| Direct contract/remapping invocations | Mismatches reproduced | Content rewrite, nesting, compiler input, serialized size and goal completion cases described below. |

These checks establish a useful baseline, not a comprehensive production security audit. Linux compiler execution and actual TeX compilation were not exercised on this Mac.

## Priority index

P1 means address early because the issue affects user content, reliable persistence, credential hygiene or keyboard access. P2 means address in the next consolidation pass. P3 means cleanup or architectural improvement that can follow the targeted fixes.

| ID | Priority | Finding |
| --- | --- | --- |
| 01 | P1 | Duplicated private credentials and permissive file modes |
| 02 | P2 | Setup scripts lack a unified, idempotent credential lifecycle |
| 03 | P1 | ID remapping modifies ordinary user text |
| 04 | P1 | Editor and Worker disagree about valid rich-content nesting |
| 05 | P2 | Shared LaTeX contract differs from the actual compiler |
| 06 | P2 | Valid source can exceed the source-save JSON limit |
| 07 | P1 | Preferences have a lost-update race |
| 08 | P1 | Offline document creation can leave upload retry stuck |
| 09 | P1 | Optional storage can block startup; clearing is too broad |
| 10 | P1 | Autosave can hide a device-durability failure |
| 11 | P1 | Some file cleanup bypasses the durable queue |
| 12 | P2 | Export consistency protection ends before streaming completes |
| 13 | P2 | Home goal completion omits observed learning progress |
| 14 | P1 | A global CSS rule suppresses focus outlines |
| 15 | P2 | Shared and feature styles have competing owners |
| 16 | P2 | Tokens, motion and reusable controls need a central policy |
| 17 | P3 | Unimported CSS and unused entry modules can be removed |
| 18 | P3 | Unused exports and content should be retired or marked planned |
| 19 | P2 | Operational documentation contains stale limits and duplication |
| 20 | P3 | Large modules mix several responsibilities |
| 21 | P2 | Shared contracts still duplicate policies and weak types |
| 22 | P2 | Save status, retry rules and storage formats lack one contract |
| 23 | P3 | Workspace state and server-resource caching are inconsistent |
| 24 | P2 | PDF rendering and file loading need bounded, shared loading |
| 25 | P2 | Entry bundle and font imports should be reduced |
| 26 | P2 | CI omits compiler tests and formatting checks |
| 27 | P3 | Runtime types and compiler installation are insufficiently aligned |
| 28 | P2 | PDF zoom regression test exceeds the supported range |
| 29 | P3 | UI interfaces and tab implementations contain drift |
| 30 | P3 | Timezone behavior needs an explicit product policy |

## Credentials and configuration

### 01. Establish one authoritative local secret source per environment

**Evidence: reproduced inventory and value equality checks.** Relevant files are `.dev.vars`, `.private/oauth.env`, `.private/pi-compiler.json`, `.private/work-compiler-secrets.json`, `.private/cloudflare-api-token` and `.private/pi_pw`. Secret values are omitted deliberately.

| Location | Role | Observed mode | Recommended disposition |
| --- | --- | --- | --- |
| `.dev.vars` | Local Worker configuration, including OAuth/compiler settings | `0600` | Keep as the development loader's generated input or choose it as the authoritative local file. |
| `.private/oauth.env` | OAuth upload-script input | `0644` | Fold into the chosen environment source, then retire after verifying consumers. |
| `.private/pi-compiler.json` | Compiler URL/bearer and Access client settings | `0600` | Fold into canonical configuration; keep JSON only if a documented consumer needs it. |
| `.private/work-compiler-secrets.json` | Compiler secret upload intermediate | `0600` | Generate in memory and send through stdin instead of retaining a second copy. |
| `.private/cloudflare-api-token` | Cloudflare administrative token | `0644` | Restrict permissions; place in an administrative configuration scope or secret manager. |
| `.private/pi_pw` | Opaque credential file | `0644` | No first-party script consumer found. Identify its owner/use before retiring it. |
| `.private/github-allowlist.json` | Private login/ID list, not a bearer credential | `0600` | Keep structured data or load JSON from a documented canonical variable. |
| `dist/work/.dev.vars` | Generated build copy of local settings | `0644` | Treat as a secret-bearing build artifact; avoid retaining or distributing it. |

The same compiler bearer and Access client secret occur in `.dev.vars`, `.private/pi-compiler.json` and `.private/work-compiler-secrets.json`. This creates multiple possible authorities during rotation. OAuth settings also appear in separate configuration files; explicitly identify their environments before merging them. `.private/` is `0755`; combined with `0644` credential files, ordinary Unix permissions permit other local accounts to read those files where directory/ACL access allows it. Restrict the directory to `0700` and secret files to `0600`, including existing files, not just newly created ones.

The Vite/Cloudflare build explicitly reports using `.dev.vars` and creates the copy under `dist/work/`. Known current private values were found there; they were not found in the inspected browser bundle or authored public/source files. This is evidence of local artifact duplication, not evidence that secrets are served by the application or committed.

A practical target is one authoritative `.private/environments/<environment>.env` file per environment, or a secret manager, with a loader that generates the required local `.dev.vars` and uploads only the relevant variables. Keeping `.dev.vars` itself authoritative for local development is also reasonable. Merely renaming it to `.env` would require adapting the loader. Production/staging must retain distinct credentials in the platform's runtime secret store; the Pi's `/etc/work-compiler.env` remains its own host-side runtime projection. Administrative Cloudflare credentials should have their own scope. Never put these values in a `VITE_*` variable.

Commit only a names-and-placeholder example. Validate required keys and types, redact command failures, use atomic writes, and enforce modes explicitly with `chmod`. Remove obsolete duplicates and backups only after all consumers are migrated. Decide rotation from actual exposure history; current duplication alone does not prove compromise.

The current ignore rules cover `.private/`, `.dev.vars*`, `.env*` and `dist/`. A limited Git history path check found no commits for these private paths; it was not an exhaustive historical secret scan. Account IDs, database IDs and hostnames in config/scripts are infrastructure identifiers, not secret credentials. Synthetic credentials in tests are intentional fixtures.

**Verification after migration:** every setup command consumes the same environment source; generated outputs are ignored and restricted; builds and error messages contain no credentials; local/staging/production cannot silently select another environment's settings.

### 02. Consolidate setup helpers and make credential provisioning idempotent

**Evidence: source.** See [compiler configuration](../scripts/compiler-configure-work.mjs), [compiler Access setup](../scripts/compiler-cloudflare.mjs), [Cloudflare setup](../scripts/cloudflare.mjs), [allowlist setup](../scripts/github-allowlist.mjs), and [tunnel setup](../compiler/configure-tunnel.mjs).

`compiler-configure-work.mjs` reads its own JSON authority, copies `.dev.vars` to `.private/dev-vars-before-pi`, and persists an upload JSON file. `cloudflare.mjs` independently parses `.private/oauth.env` and has a production-only secrets action. Repository-relative paths and environment selection differ between scripts. Passing `mode: 0o600` to `writeFileSync` does not tighten an already existing file's mode.

`compiler-cloudflare.mjs`'s `configure` action creates a fresh Access service token and a new policy on each run before saving credentials locally. Repeated runs can accumulate active credentials; failure between provisioning and persistence leaves remote state without a saved local counterpart. Reuse an identified token when appropriate, or implement explicit rotation with rollback/recovery and old-token revocation after health verification. Keep administration separate from ordinary secret upload.

Use one small Node helper module for repository-root resolution, explicit environment parsing, configuration validation, secure writes and redacted subprocess errors. The allowlist script already demonstrates root resolution, ignore checks, explicit `chmod`, validation and secret upload through stdin. Extend that pattern rather than building another general CLI framework.

Add precise ignore entries for generated `compiler/runtime/`, `compiler/state/`, and the `compiler-client.json` written by tunnel setup inside the Pi checkout. They are not present locally now and are not covered by current explicit ignores. The client JSON contains a bearer credential; runtime/state are generated operational data. Do not ignore the compiler's authored source or installed service configuration wholesale.

## Correctness and persistence

### 03. Restrict ID remapping to references; preserve prose verbatim

**Evidence: reproduced.** [shared/transfer.ts](../shared/transfer.ts), `remapWorkspace` at line 209, recursively rewrites strings in `record.body` and all `record.data`. Any string equal to a remapped ID is replaced. Substrings matching `record=`, `interview=`, `tab=` or `track=` are also rewritten regardless of whether they are internal links. [src/lib/outbox.ts](../src/lib/outbox.ts), line 2, applies a similar recursive rewrite for offline acknowledgements.

A direct invocation changed an ordinary body such as `Debug external query record=<old UUID>` to contain the newly generated ID. A rich-content text node whose text equalled the old ID changed too. `remapReference({ body: oldId }, oldId, newId)` likewise rewrites ordinary text. Imports and offline synchronization can therefore alter authored content unexpectedly.

Build a typed reference visitor from [shared/references.ts](../shared/references.ts): remap record/file IDs, relationship arrays, goal directions and explicitly recognized internal-link attributes. Parse link destinations and restrict rewriting to the application's internal route convention. If Markdown bodies intentionally support internal links, remap link destinations through a Markdown parser, keeping visible text and code spans intact. Avoid a global text replacement.

**Regression cases:** prose equal to an ID, external URLs with `record=` query parameters, code examples, rich text, genuine internal links, attachment pointers and connected offline records. Preserve all intended references while proving prose remains byte-for-byte unchanged.

### 04. Use one nesting policy for rich content across editor, API and import

**Evidence: reproduced.** [shared/rich-content.ts](../shared/rich-content.ts), lines 37–44, validates rich nodes with a depth limit of 24. [worker/validation.ts](../worker/validation.ts), lines 48–70, separately traverses generic record data with a limit of 12. Arrays and the `data.richContent` wrapper consume additional levels in the generic traversal.

A document with five nested blockquotes passed `validRichDocument`, but a record containing it failed `recordSchema` with `Record details are nested too deeply.` The editor can accept content that its save endpoint rejects. The package schema uses the rich-content contract without this same generic depth check, adding another acceptance path.

Define a shared policy that accounts for rich-node depth separately from generic metadata depth, then apply it to record creation, patching and package import. Retain URL and structural safety checks. Do not simply disable nesting validation.

**Regression cases:** supported nested lists/quotes/tables, exact boundary depth, one level over the limit, and equivalent record-save versus package-import acceptance.

### 05. Align the advertised LaTeX contract with the controller

**Evidence: reproduced plus source.** [shared/latex.ts](../shared/latex.ts), line 6, accepts `pdflatex`, `xelatex` and `lualatex`. [compiler/protocol.mjs](../compiler/protocol.mjs), line 13, supports only `pdflatex`; [compiler/README.md](../compiler/README.md) correctly documents that constraint. [worker/latex.ts](../worker/latex.ts), around lines 780 and 830, normalizes source engines to `pdflatex` rather than making the unsupported choice explicit.

The shared source schema also accepts a project containing `main.tex`, `x.tex` and `x.tex/y.tex`. The controller rejects that file/directory collision. Shared base64 validation uses `atob`, while the controller has a stricter encoded-format check. The contracts disagree at several boundaries.

Make current capabilities explicit: constrain active source submissions to pdfLaTeX, or implement and expose supported alternative engines end to end. If imported historical metadata can name older engines, give that metadata a separate compatibility schema. Share pure path, collision and encoding policy with the compiler through a portable module or generated contract; keep filesystem and process checks in the Node service.

**Verification:** the same source fixture corpus produces compatible acceptance in browser, Worker and controller. Update the failing compiler engine test only after deciding the supported behavior; do not enable another engine solely to satisfy a stale assertion.

### 06. Account for JSON expansion in source limits

**Evidence: reproduced.** [shared/latex.ts](../shared/latex.ts) allows 5 MiB of decoded source. [worker/latex.ts](../worker/latex.ts), line 29, limits the source JSON body to 8 MiB. Decoded source size and serialized request size are different limits.

A valid single-file source containing 4 MiB of quote characters serializes to 8,388,732 bytes with the save envelope, exceeding the endpoint's 8,388,608-byte cap. Escaped control characters can expand further. A project accepted by the shared source schema can fail before saving.

Choose consistent decoded and transport budgets. Either size the bounded request limit for the worst supported encoding/envelope or require a predictable encoding and enforce the serialized cap in shared validation and UI feedback. Keep streaming body limits and test quote-heavy, backslash-heavy, Unicode and multi-file inputs at the boundaries.

### 07. Add server-side concurrency control to preferences

**Evidence: source.** [src/lib/workspace.tsx](../src/lib/workspace.tsx), line 497, fetches preferences, merges the local patch with that snapshot, then sends a full `PUT`. [worker/index.ts](../worker/index.ts), line 620, upserts the full preferences JSON with no version predicate.

Two sessions can read the same remote state, each merge a different change, and each submit an apparently valid full replacement. The last request discards the other change. Client-side three-way merging cannot prevent a change between GET and PUT. Workspace epochs protect replacement boundaries, not concurrent preference edits.

Add a preference version/ETag and compare it atomically in D1, returning 409 on stale writes. Retry against the new version using the existing merge approach, or define an atomic validated partial-patch API. Move the preference schema to `shared/` so browser, demo and Worker use the same contract.

**Regression cases:** simultaneous distinct-field updates retain both changes; conflicting updates to the same field surface a conflict; account switches and workspace replacement still reject stale writes.

### 08. Resolve acknowledged offline IDs before retrying a document upload

**Evidence: source.** [src/features/assets/DocumentEditor.tsx](../src/features/assets/DocumentEditor.tsx), lines 26 and 42–49, stores the created record in component state. If creation returns an `offline-*` record, the component retains it, then displays the reconnect message. On retry, `saved ?? create(...)` reuses that original object.

Outbox synchronization replaces the workspace record with its acknowledged server ID, but does not replace the component's saved object. The same dialog can keep rejecting its stale offline ID after reconnection. The name remains editable after record creation, but retry also retains the previously created title.

Resolve the live record through a stable client identity/alias map before attachment operations, or provide an explicit acknowledgement result from creation. Reconcile the title on retry or lock it once the record is created. Keep binary uploads outside the JSON outbox; the existing separate upload/selection recovery logic is useful.

**Regression:** create while disconnected, keep the dialog open, reconnect and acknowledge the record, retry upload successfully without a duplicate record, and verify the intended title/file selection.

### 09. Make all optional storage access safe and clear by owner

**Evidence: startup failure reproduced; other paths source-derived.** [src/lib/workspace.tsx](../src/lib/workspace.tsx), line 246, reads `sessionStorage` before the startup `try/finally`. Blocking the storage getter produces uncaught page errors and leaves the application at `w Loading…`. Demo activation and sign-out also have unguarded session-storage access. Catching access in theme initialization does not cover these paths.

[src/lib/device-storage.ts](../src/lib/device-storage.ts), lines 2–6, removes nearly every key beginning with `work` from both storage areas. `acceptWorkspaceEpoch(owner, epoch)` invokes that global purge for an owner-specific replacement. This can discard another account's drafts/outbox and unrelated theme, demo or timer state on the same browser. A global schema migration may intentionally clear everything; an owner epoch change needs a narrower operation.

Introduce a safe storage adapter with typed read/write/remove results, centrally defined keys, schema versions and owner/mode namespaces. Distinguish deliberate global migration, account-specific replacement and sign-out. Preserve unsynced drafts where the intended policy permits, and explain deliberate deletion in the existing flow.

The outbox loader at workspace line 263 casts `JSON.parse` directly to `OutboxItem[]`. Syntactically valid but wrong-shaped JSON can bypass the catch and fail on iteration. Validate persisted envelopes with a schema; handle malformed/old entries explicitly rather than assuming parsed JSON is an array.

**Regression cases:** unavailable storage getters, quota errors, malformed envelopes, account A/B drafts on one device, demo/cloud transitions, replacement epochs and interrupted sign-out.

### 10. Preserve device-durability errors during autosave transitions

**Evidence: source.** [src/lib/autosave.ts](../src/lib/autosave.ts), around lines 360–400, sets `localDurable` false and a storage warning when writing the draft fails. `setValue` calls `writeLocal(next)`, then unconditionally clears the error when there is no conflict and can set `Saving…`.

An immediate storage failure can therefore be hidden while the network save is still pending. If connectivity also fails, the visible state initially omits the fact that the newest edit has no durable device copy. The local-durability distinction already exists internally; preserve it in the status calculation.

Use a typed save state that separately represents dirty content, network state, conflict and local durability. Derive the displayed message from those fields rather than independently setting competing strings.

**Regression:** force device storage and network writes to fail together, then restore each independently; assert the warning remains until a durable copy exists and never displays a successful save prematurely.

### 11. Route all compensating file deletion through durable cleanup

**Evidence: source.** [worker/latex.ts](../worker/latex.ts), `discardAttachment` at line 201, removes D1 attachment metadata and directly deletes the R2 object. If the R2 delete fails, the row is already gone and no cleanup receipt remains. [worker/files.ts](../worker/files.ts), `saveAttachment` at line 203, handles an insert failure with a direct R2 delete; failure there can orphan the newly created object and mask the original insert error.

Other deletion paths already enqueue `file_cleanup` in a D1 batch before dropping metadata. Reuse that durable pattern for native-build compensation, upload rollback and staged-file cleanup wherever the backing store is still reachable. Preserve the original failure when cleanup also fails. Since D1/R2 are separate systems, explicitly define the recoverable state for each write ordering and retain enough object-key information to reconcile it.

[worker/transfer.ts](../worker/transfer.ts), `drainFileCleanup` at line 398, takes 100 rows without ordering and aborts on the first failed delete. A persistently failing key can repeatedly prevent later work from progressing. Add retry metadata, deterministic selection/backoff and per-object error handling so one failure does not stop the batch. Keep attempts bounded and observable.

**Regression:** inject R2 deletion failures after a successful D1 deletion and after an insert failure; assert eventual cleanup, preserved original errors, and progress for other queued objects.

### 12. Define a consistent export snapshot and operational budget

**Evidence: source; concurrent stream failure not reproduced.** [worker/transfer.ts](../worker/transfer.ts), `exportWorkspace` at line 93, checks generation and file metadata before returning a streamed TAR. It fetches file bodies later during stream consumption. Concurrent document pruning or deletion can remove a referenced object after preflight and before its body is fetched, failing the archive after download has begun.

[src/lib/workspace-transfer.ts](../src/lib/workspace-transfer.ts), line 118, does a HEAD preflight followed by a separate browser GET. The HEAD repeats manifest queries and R2 metadata checks, but does not guarantee that GET sees the same state. UI completion also means the browser download was started, not that the complete archive arrived.

Choose a snapshot strategy: pin the exact export manifest/object keys with bounded temporary protection from cleanup, or use another explicit consistency mechanism. Give interrupted downloads clear recovery behavior. Retain streaming; loading every file into Worker/browser memory would undermine the existing design.

The current package allows up to 5,000 files of 10 MiB each and a 32 MiB manifest. There is no 20 MB aggregate file cap. Sequential metadata checks and one upload per file need measured operational budgets. Benchmark a representative large workspace, then document/constrain supported size and request volume. This is a workload concern, not a demonstrated violation of a particular platform quota.

### 13. Pass observed learning totals to Home timeline completion

**Evidence: reproduced.** [src/features/home/timeline.ts](../src/features/home/timeline.ts), goal target generation, calls `goalProgress(goal)` without observed progress. Other goal views supply observed totals for LeetCode measures.

For a LeetCode goal with target five and observed total ten, `goalProgress(goal, 10).complete` is true, but the timeline target item is incomplete. Home can disagree with the progress display for the same goal.

Create one goal-progress selector accepting the goal plus observed resource state, and use it for the timeline, direction cards and progress spans. Keep manually tracked measures distinct from observed measures. Add a test with an observed metric exceeding the target and a control case for a manual goal.

## Style ownership and accessibility

### 14. Replace blanket focus suppression with an intentional focus treatment

**Evidence: source.** [src/app/identity.css](../src/app/identity.css), lines 409–417, sets `outline: none !important` for global `:focus`, `:focus-visible`, `:focus-within` and related pseudo-elements. This overrides focus outlines, including an earlier focus-visible rule in the same file.

Keyboard users need a visible current focus position on links, buttons, inputs, tabs and popovers. A visual preference against rectangular outlines can be implemented with a rounded ring or equivalent visible treatment. Remove the blanket override and define shared focus tokens/rules for interactive controls, with feature exceptions justified individually.

Verify keyboard navigation on every main route, dialogs, dropdowns, editor controls and PDF toolbar, in both themes. This finding was established from CSS; no complete keyboard-accessibility audit was performed.

### 15. Give shared selectors one owner and make cascade order explicit

**Evidence: source and stylesheet inventory.** `src/styles.css` has 2,835 lines and mixes tokens, primitives, page layouts and later overrides. `src/app/identity.css` adds 417 lines of global and feature overrides. Active feature CSS adds another layer. There are no CSS cascade layers.

Examples of selectors defined in multiple active files:

| Selector / area | Competing owners |
| --- | --- |
| `.card` | `styles.css`, `app/identity.css` |
| `.simple-shell .sidebar`, `.simple-shell .nav-link` | `app/shell.css`, `app/identity.css` |
| `.input` | `styles.css`, `app/identity.css` |
| `.page-header`, `.page-header h1` | Multiple sections of `styles.css`, plus `app/identity.css` |
| `.document-link-card` | `features/assets/documents.css`, `app/identity.css` |
| `.timeline-heading h2`, `.timeline-goals h3`, `.goal-card:hover` | `features/home/timeline.css`, `app/identity.css` |
| `.latex-pdf-sheet .textLayer` | `features/assets/documents.css`, `features/assets/pdf-text-layer.css` |

Within `identity.css`, the timeline heading is assigned one color around line 294 and another around line 313. Patterns such as doubled `.section-tabs.section-tabs`, `:root .button-primary` and `!important` indicate accumulated specificity patches. Feature stylesheet imports also cross boundaries: Interviews imports Learn styles, and Direction imports Home timeline styles.

Create a single global style entry with explicit ownership and order, for example:

```text
src/styles/index.css
src/styles/tokens.css       # theme colors, typography, spacing, radii, shadows
src/styles/base.css         # element defaults, body, focus, motion policy
src/styles/components.css   # shared controls, card, page header, tabs
src/styles/utilities.css    # a small documented set of layout helpers
src/app/shell.css           # app navigation and shell only
src/features/*/*.css        # feature-specific layout and rendering
```

Use a documented `@layer` order or CSS Modules for feature ownership; migrating layers requires accounting for any remaining unlayered rules, which otherwise outrank normal layered rules. Move actual shared timeline/tab primitives out of feature files. Fold identity overrides into their owning definitions and retire `identity.css` when its remaining rules have clear homes.

Consolidation means central tokens and shared rules, with a clear boundary for feature rules. Combining all 9,710 lines into one file would preserve the ownership problem. Migrate one component at a time, comparing both themes and desktop/mobile layouts before removing its old rules.

### 16. Extend tokens and a shared motion/control policy

**Evidence: source and CSS parsing.** The stylesheet inventory contains 344 declarations with hexadecimal literals. Some are deliberate document/code-rendering colors; others repeat UI colors such as `#202128` where an on-accent token would clarify intent. There is no `prefers-reduced-motion` rule despite infinite brand motion, hover/hold transitions and smooth scrolling.

Define semantic tokens for text, muted text, surfaces, borders, accent/on-accent, danger/success, focus, spacing, font sizes, radii, shadows and z-index tiers. Keep each theme's assignments together. Use a small documented breakpoint vocabulary; plain CSS custom properties cannot be substituted directly into media-query conditions without a build transformation.

Honor the operating system's reduced-motion preference centrally, including animation, transition and smooth-scroll behavior. This does not require a new user-facing setting. Existing tests for the absence of a motion setting need not conflict with an OS preference rule.

Consolidate reusable buttons, input states, cards, dialog spacing and tab styling through existing UI primitives. Keep PDF paper white/black and editor-generated themes deliberate: CodeMirror themes, canvas sizing and dynamic element geometry should remain in code where they depend on runtime state. Avoid replacing those with static tokens indiscriminately.

## Removal and documentation consolidation

### 17. Remove confirmed unimported styling and redundant entry files

**Evidence: source/import graph.** No imports were found for the following CSS files, including CSS-to-CSS references:

| Candidate | Size | Action |
| --- | --- | --- |
| `src/features/prepare/prepare.css` | 771 lines | Remove after a final reference search; active Learn styling lives elsewhere. |
| `src/features/search/search.css` | 258 lines | Remove after a final reference search; Applications uses its active stylesheet. |
| `src/features/assets/assets.css` | 195 lines | Remove after a final reference search; Documents uses `documents.css` and related active styles. |

These total **1,224 lines** with no current runtime effect. Do not import them merely to justify keeping them: they contain old selectors that could reintroduce competing styles.

`src/features/assets/index.ts`, `src/features/prepare/index.ts` and `src/features/search/index.ts` are one-line re-export entry points not used by the production graph. Either adopt a consistent feature entry-point convention and use them, or remove them. The current direct imports make removal simpler.

`@tanstack/react-query` has no source/test imports and no provider. Remove it and regenerate the lockfile unless the architecture explicitly adopts it. Removing an unused dependency reduces installation/maintenance surface; it does not imply a current browser-byte saving if the bundler already excludes it. Keep the lockfile.

Run check/build and the relevant browser suite after these removals. Use the current rendered UI as the baseline, not the appearance described by unused CSS.

### 18. Prune unused public APIs and separate planned content

**Evidence: consumer searches.** The following symbols have no current consumers outside their declarations:

| Candidate | Location | Disposition |
| --- | --- | --- |
| `RecordLinks` | `src/components/ui.tsx:310` | Remove unused component and any styling proven exclusive to it. |
| `SaveState` | `src/components/ui.tsx:369` | Remove or replace with the actual typed save-status primitive; current string-based autosave does not use it. |
| `formatDuration` | `src/features/prepare/helpers.ts:26` | Remove if no planned feature requires it. |
| `nextScheduledDate` | `src/features/search/applicationRecords.ts:33` | Remove unused selector. |
| `interviewPreparation` | `shared/content.ts:154` | Remove unused helper; keep the active schema. |
| `APPLICATION_STAGES` | `src/features/search/ApplicationsPage.tsx:52` | Remove unused exported alias. |
| `removeAttachment` | `src/lib/api.ts:100` | Remove unused frontend wrapper if desired; this alone is no reason to remove the backend delete route. |
| `LearningTopic`, `LEARNING_TOPICS`, `CURATED_RESOURCES` | `src/content/learning.ts` | Unused authored catalog/types; remove or relocate as planned content. Retain the active `TRACKS` export. |

`reviewInterval`, `nextReview` and `splitTags` in `prepare/helpers.ts` have test-only consumers. They are not live product behavior. Decide whether to retain a deliberately planned library or retire those functions/tests together. Other calendar/time helpers in that file are active; do not delete the entire file.

`src/content/templates.ts` is outside the production import graph. However, the new `docs/jev-applications.md` proposal references its story prompts/rubrics. Mark it as planned material, move it under a planning/content location, or explicitly choose to remove it and update the proposal. Runtime-unreachable does not establish that the content is unwanted.

Some exports without external importers are still used inside their own modules, such as metrics helpers. Make these private where appropriate; do not delete them based only on external-reference counts.

Company glyphs are referenced through mappings and covered by `tests/company-glyphs.test.ts`. Preserve those assets and attribution. Keep demo/starter data that supports active browser-only and test modes.

### 19. Create a documentation index and update the security limits

**Evidence: source/document comparison.** [docs/security.md](security.md), lines 55–56, still describes an import batch of 100 records/20 files per record/40 files overall and a 20 MB bundled export with `?files=false`. The current API uses the TAR workspace package with up to 5,000 records/files, 1,000 goals and a 32 MiB manifest; the old aggregate export rule is not implemented. Rich notes also have a 70,000-character serialized contract distinct from the 500,000-character plain body limit. The nesting inconsistency in finding 04 must be fixed before documenting a single depth value.

Update the limits against code and make units explicit: byte limits expressed as `1024 * 1024` are MiB, while character limits are characters. Remove obsolete endpoint instructions. Security documentation is operationally important and should not retain promises about cleanup that some compensation paths bypass.

Documentation placement is not itself a defect. `compiler/README.md` is a focused service guide; `public/company-glyphs/README.md` contains asset attribution; `src/features/learn/foundations/PROVENANCE.md` records metric provenance. Keep those near the relevant code/assets or move the authoritative text and leave discoverable links. Attribution/provenance should survive cleanup.

Recommended ownership:

| Document | Purpose |
| --- | --- |
| Root `readme.md` | Short architecture, local startup and links to authoritative guides |
| `docs/README.md` | Documentation index, including proposal versus implemented status |
| `docs/configuration.md` | Variable names, environment selection, authoritative private locations, rotation and generated projections |
| `docs/operations.md` | Deploy, rollback/recovery, database and compiler operations; links to focused guides |
| `docs/security.md` | Implemented trust boundaries and current limits |
| `docs/verification.md` | One maintained command/result contract, including compiler checks |
| `compiler/README.md` | Pi-specific installation, sandbox and service behavior |
| `docs/proposals/` | Optional home for unimplemented designs such as JEV applications |

The ignored `.private/README.md` repeats OAuth registration steps; move the authoritative instructions to versioned configuration/setup documentation and leave a short local pointer. Review overlap among `launch-setup.md`, `operations.md`, the root README and compiler guide, replacing repeated procedures with links. Do not combine unrelated guides into a giant notes file.

Preserve `migrations/0001_workspace.sql` and `migrations/0009_current_workspace.sql`: applied migrations are a database history, not duplicate code. The latter deliberately resets old test-workspace tables while retaining auth, as the root README describes. Do not delete, renumber or squash it casually. The gap in migration numbering is not sufficient evidence of a missing required migration.

## Code organization and shared contracts

### 20. Split large modules at tested responsibility boundaries

**Evidence: design grounded in source.** Large modules include `src/lib/workspace.tsx` (~956 lines), `src/lib/autosave.ts` (~836), `worker/index.ts` (~893), `worker/latex.ts` (~1,003), `ApplicationsPage.tsx` (~996), `RichDocumentEditor.tsx` (~697), `DirectionPage.tsx` (~683), `LatexDocumentPanel.tsx` (~647), `AssetsPage.tsx` (~629), `App.tsx` (~602) and `LatexPdfPreview.tsx` (~591). Length alone is not the defect; several mix state coordination, transport, validation and rendering.

Useful extractions:

- Workspace: session/mode lifecycle, validated outbox repository/synchronizer, record mutations, preferences, and stable context actions.
- Autosave: pure merge/reconciliation, draft persistence and migration, then the hook/state machine with lifecycle flushing.
- Worker entry: middleware/auth/session setup and grouped record/preferences/attachment/workspace routes; retain one composition root.
- LaTeX Worker: source storage, job orchestration/polling and artifact persistence/cleanup. Keep transitions and transaction boundaries explicit.
- Large pages: focused application-process editor, appointment editor, direction-goal editing and document-card components; share validation/selectors rather than creating a generic universal form.

Do this incrementally after correctness fixes. Preserve idempotency keys, owner checks, epoch guards, conflict behavior, dirty-draft flushing and request cancellation. These details can be lost in a superficially cleaner rewrite.

Folder names also lag the UI: `prepare` owns `LearnPage`, `search` owns Applications, and `assets` owns Documents. Renaming to product concepts is reasonable after imports/styles settle, but has lower value than fixing ownership. Generic `errorMessage` and `useSavingWorkspace` are imported from the Applications feature by other features; move them to a shared library without waiting for a full folder rename.

### 21. Consolidate domain policies without mixing execution environments

**Evidence: source.** Shared Zod schemas are already a strong foundation, but some boundaries still duplicate or weaken them:

- `WorkRecord.data` is `Record<string, unknown>`, so pages repeatedly cast and probe fields. Derive category/kind-specific types and validated accessors from existing schemas. Preserve a generic storage representation at the database boundary if useful.
- Record metadata depth, URL field inspection and size policies differ between `worker/validation.ts`, package validation and shared content contracts. The nesting failure demonstrates actual drift.
- File types and 10 MiB limits are repeated across `shared/documents.ts`, Worker validation and package schemas. Define shared accepted types/limits, with Worker-specific signature checks layered on top.
- Rich-content boolean validation and diagnostic validation in `shared/rich-content.ts` repeat substantial traversal logic. Use one safe visitor returning a structured issue, with a boolean wrapper; retain every node/attribute/URL allowlist rule.
- URL/date rules occur in several modules. Consolidate base parsers and parameterize intentional differences, such as HTTPS-only goal links versus HTTP/HTTPS generic links. Do not erase stronger destination restrictions for the sake of reuse.
- Demo `makeRecord` in `src/lib/demo.ts` and server `newRecord` in `worker/db/records.ts` duplicate pure record construction. Share the pure factory with injected ID/time generation, while keeping server validation and ownership outside it.
- Preference shape is defined by types/defaults and a Worker-only schema; expose one shared schema/default policy.

Keep filesystem handling and process execution in `compiler/`, D1/R2 adapters in `worker/`, and DOM/browser storage in `src/`. A shared module should not import an environment-specific API merely to avoid a few lines of duplication.

### 22. Standardize persistence states, retry classification and stored envelopes

**Evidence: source/design.** Autosave exposes human-readable strings, an unused `SaveState` component expects a different contract, workspace synchronization maintains issue/pending state separately, and API/compiler paths make their own retry decisions. Treating display strings as state makes transitions and error precedence hard to reason about.

Define a small shared frontend status type, with derived labels and a common display component. Centralize retry classification by error category/status: authentication, validation, conflict, transient transport, and rate limiting. Preserve subsystem-specific retry timing/cancellation. Treat the compiler's lifecycle as a separate machine with an explicit projection into UI status.

Device drafts, outbox, demo, metrics and timers each implement storage concerns. Centralize key construction, safe access and envelope validation, while retaining each feature's data format and durability needs. Persisted data should carry a schema version and owner/mode identity. Never silently replay old-account data after switching sessions.

The API adapter, file resolver and workspace epoch in `src/lib/api.ts` are module-global mutable state. Scope them to the active workspace/session client or inject them through a provider, making demo/cloud transitions and tests less dependent on global ordering. Keep one transport/error parser for JSON requests, and separately support binary streaming with equivalent owner/session rules.

### 23. Reduce broad context updates and choose one resource-cache approach

**Evidence: source/design; no profiler trace collected.** The workspace context exposes records, preferences, user state, toast state and mutation methods together. Changing a toast or pending counter changes the context value and can rerender unrelated consumers. Splitting stable actions, core data and notifications would make updates more selective.

Goals are fetched through component hook state, whereas some learning resources use dedicated external stores. Multiple goal consumers can independently fetch and manage the same resource. Choose one cache/update strategy with session ownership, deduplication, invalidation and cancellation. Either extend the existing store pattern and remove unused React Query, or deliberately adopt it with a provider and complete migration plan. A half-adopted second cache is harder to maintain.

Profile render counts on Home, Documents and Applications before adding memoization. Prefer clearer state boundaries and selectors over blanket `useMemo`/`memo` usage. A shared cache must clear or partition data correctly across owner and demo-mode transitions.

## Performance and verification

### 24. Bound PDF rendering and share file-loading behavior

**Evidence: source.** [src/features/assets/LatexPdfPreview.tsx](../src/features/assets/LatexPdfPreview.tsx), lines 568–569, renders all pages for a full preview. A 10 MiB PDF limit does not limit page count or canvas pixel memory, especially at high zoom/device pixel ratio. Rendering every page immediately can consume substantial browser memory.

Render pages near the viewport, with a small prefetch margin, and release offscreen canvases when appropriate. Bound rendered pixel dimensions and concurrency. Preserve text-layer alignment, links, search/selection, fit-width behavior and preview layout; these are already covered by useful browser assertions.

`useDocumentFiles`, preview loading and card thumbnails manage related metadata/blob fetching independently. A first-page thumbnail still downloads the whole PDF; offscreen cards do not have a shared visibility gate/cache. Consolidate owner-scoped attachment metadata and blob loading with deduplication, abort support, bounded caching and explicit URL revocation. Invalidate when the selected/build attachment changes.

Keep generic uploads, native source editing and compiled artifacts as distinct domain flows. Reusing file transport does not require merging their forms or treating source JSON as an ordinary user upload.

**Verification:** a large multipage PDF, many document cards, rapid route changes, zoom at high DPR and account switching; compare network request counts and peak rendered canvas area, not just bundle size.

### 25. Reduce entry cost and unnecessary font payloads

**Evidence: reproduced build output.** The main browser chunk is 741.28 kB minified / 230.71 kB gzip. Heavy editor/PDF code is already separated into chunks: RichDocumentEditor approximately 464.43 kB / 146.42 kB gzip, LatexPdfPreview 438.50 kB / 131.92 kB gzip, and LatexSourceEditor 393.25 kB / 126.55 kB gzip. The PDF worker is approximately 1,264.34 kB.

Keep the existing lazy route/editor boundaries. Inspect the entry module graph to identify shared imports that retain large libraries; shared validation/rich-content parsing is a candidate to measure, not an established sole cause of the entry size. Prefer decoupling a lightweight UI contract from heavyweight parsing before arbitrary manual chunk splitting. Raising the warning threshold does not reduce load cost.

`src/main.tsx` imports the full variable DM Sans and Space Grotesk packages. The build includes multiple script subsets. Import the required language subset(s) deliberately after checking the intended language coverage. Keep fallback fonts and prevent layout shifts.

Add a measured entry gzip budget and track actual first-route transfer/execution cost. Lazy chunks still affect the routes that use them, so combine bundle work with the PDF rendering changes rather than relying only on code splitting.

### 26. Bring compiler and formatting checks into CI

**Evidence: reproduced failures and CI inspection.** [vitest.config.ts](../vitest.config.ts) includes only `tests/**/*.test.ts`. [compiler/server.test.mjs](../compiler/server.test.mjs) is therefore absent from `npm test` and the current [CI workflow](../.github/workflows/ci.yml). Running it directly fails the first test because it asks for a `xelatex` job at line 25. This is precisely the contract drift CI should detect.

Add an explicit compiler unit-test command and run it in CI. Node protocol/controller unit tests can run without installing the entire TeX toolchain; keep Linux sandbox/toolchain smoke checks as a clearly separate environment-dependent stage. The existing Worker runtime and browser suites are valuable and should remain.

`format:check` currently fails in two files, is not run by CI, and its globs omit `compiler/` and Markdown. Add it to CI after formatting the intended tracked scope in a separate cleanup change; do not overwrite unrelated user edits during a review. At minimum include compiler source in the format contract. Decide whether docs should be formatted and make that policy explicit.

Add React Hooks lint rules with a reviewed baseline. Current ESLint has no exhaustive-dependency check, despite complex async hooks/ref coordination. Do not auto-add dependencies without understanding lifecycle semantics. Introduce a dependency/export audit with explicit allowlists for dynamic assets, scripts and planned content; the current TypeScript unused checks do not detect unused exported declarations or unimported files.

New tests should target the concrete failures above: content preservation, version conflicts, storage durability, owner-scoped clearing, file-cleanup recovery and validation equivalence. Avoid tests that merely mirror refactored implementation structure.

### 27. Separate runtime types and pin reproducible compiler installation

**Evidence: source/design.** [tsconfig.json](../tsconfig.json) exposes DOM, Cloudflare and Node types to all included frontend/Worker/test files. [eslint.config.js](../eslint.config.js) similarly combines browser and Node globals. This can accept environment-inappropriate APIs without proving they exist at runtime.

Use a shared strict base plus client, Worker and test/tooling configurations with appropriate globals. Add lightweight syntax/type checks for operational `.mjs` where useful. Keep shared modules portable; document intentional Node compatibility in the Worker rather than giving browser code every server global.

`package.json` accepts Node >=22.18, CI pins 22.18.0, and Node types are version 26. [compiler/install-runtime.mjs](../compiler/install-runtime.mjs) downloads `latest-v22.x`, choosing only ARM64, while the TeX installer handles more than one architecture. The checksum check is useful, but repeated installations can select different Node releases.

Pin and record the compiler Node release and expected architecture/checksum alongside its already pinned TeX environment. Make architecture detection consistent, or explicitly document ARM64-only support. Align Node typings with the supported runtime or isolate newer APIs to deliberate compatibility checks. Parameterize hardcoded user/checkout paths where necessary for reinstallability, while retaining explicit systemd/sandbox permissions.

### 28. Correct the PDF zoom test without weakening the supported limit

**Evidence: reproduced twice.** [tests/pdf-documents.spec.ts](../tests/pdf-documents.spec.ts), line 239, clicks “Zoom in” five more times after an earlier zoom step. [LatexPdfPreview.tsx](../src/features/assets/LatexPdfPreview.tsx), line 298, clamps zoom to 2; the toolbar disables Zoom in at that limit. The test reaches 200% and waits on a disabled button until its 60-second timeout.

Change the test to click only while enabled or to take the correct number of supported steps, then assert the 200% limit and disabled state. Retain the layout/canvas assertions. This is an erroneous test expectation under the current implementation, not evidence that users should be allowed to exceed the cap. Resolve it before using the browser suite as the consolidation gate.

### 29. Repair small UI contracts and consolidate editable tabs

**Evidence: source/design.** [src/components/ui.tsx](../src/components/ui.tsx), line 65, declares a `description` prop for `PageHeader` but never destructures/renders it. Applications passes this prop, so its description is silently ignored. Render it consistently or remove the unsupported prop and update callers.

Learn and Interviews repeat editable-tab selection, rename/reorder and persistence behavior; `SectionTabs` provides only part of the shared surface. Extract a focused editable-tabs primitive with keyboard navigation, focus management and ARIA behavior. Keep feature-specific deletion/cascade policy and record categories in the feature layer. Centralize its styles alongside other shared controls.

The general error helper and saving wrapper living under `features/search/` are also small interface ownership issues, as noted in finding 20. Move them into shared frontend utilities and update imports in one coherent change.

### 30. Document which clock defines learning days

**Evidence: source; policy ambiguity rather than a confirmed bug.** [leetcodeMetrics.ts](../src/features/learn/foundations/leetcodeMetrics.ts), line 14, intentionally uses fixed AEST (UTC+10), ignoring daylight saving. `LeetCodeCalendar` labels the display AEST. General workspace preferences default to `Australia/Melbourne`, and goals/timeline use the selected timezone.

These clocks diverge during Melbourne daylight saving or for another selected timezone. Decide whether learning streaks/calendar deliberately follow a provider/fixed-day definition or should follow the user's workspace timezone. Preserve existing provenance and avoid changing established metric semantics without a product decision. Document the difference in the shared date/metric policy and test DST boundaries and a non-Australian preference.

## Recommended sequence

1. **Stabilize the baseline.** Fix the PDF test's zoom count and the compiler test/engine contract, decide the formatting scope, and add missing CI checks. Preserve current browser/runtime coverage.
2. **Protect content and persistence.** Address remapping, rich-content acceptance, preference concurrency, offline upload retry, safe storage and durability status. Add failure-focused regressions alongside each fix.
3. **Unify private configuration.** Choose the authoritative environment source, migrate every consumer, tighten existing modes and ignores, remove redundant intermediates/backups after verification, and make token provisioning/recovery explicit.
4. **Consolidate styling.** Restore visible focus, remove the 1,224 unimported CSS lines, establish tokens and shared component ownership, migrate identity overrides, then retire obsolete style files. Compare both themes and mobile/desktop at each step.
5. **Remove unused code and improve documentation.** Prune confirmed unused wrappers/aliases/barrels/dependency, explicitly retain or relocate proposal content, create the docs index, and update stale runtime claims. Preserve attribution, provenance and applied migrations.
6. **Refactor measured boundaries.** Split workspace/autosave/routes/LaTeX orchestration, introduce shared contracts and typed resource state, bound PDF rendering and profile bundle/render costs. Avoid a single large rewrite combining all these changes.

Each change should have a reviewable purpose and its appropriate verification. Pure removals need import/build/browser checks, not new tests that restate deleted code. Persistence and concurrency changes need meaningful injected-failure or multi-session tests. Style work needs keyboard, theme and responsive review in addition to compilation.

## Controls to preserve

The existing implementation has useful protections: provider-verified numeric GitHub identity and allowlist checks; session resolution on private requests; explicitly gated localhost fixtures; owner-scoped SQL and composite relations; parameterized queries; version/conflict handling for records/goals; idempotent retries that resolve current content; epoch/generation guards around replacement; bounded streaming inputs; private file authorization; restricted rendering/CSP; and a compiler sandbox that excludes service secrets, network and shell escape.

Keep service isolation, private R2, the pinned TeX toolchain, runtime verification, company-mark attribution and metric provenance. Simplification should make these boundaries easier to inspect and test, while correcting the specific gaps described here.
