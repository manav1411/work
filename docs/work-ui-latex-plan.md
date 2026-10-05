# Work: UI consistency, learning calendar and native LaTeX documents

Status: implementation underway, 5 October 2026. This extends [work-improvements-plan.md](work-improvements-plan.md) and supersedes its external-editor workflow, three-second hold, blue navigation selection, and application-independent document assumptions where described below. The native editor, private source/build APIs, isolated TeX service, calendar and UI refinements are implemented. Production PDF compilation requires a separately hosted compiler configured through `LATEX_COMPILER_URL` and `LATEX_COMPILER_TOKEN`. Live account data is not seeded. Overleaf links and connections have been removed at the user's request.

## 1. Make the interface quieter and consistent

Remove secondary promotional/explanatory lines beneath page titles and section titles, including Documents, Applications, Interviews, Your Direction, Your links, and learning subject headings. Resource cards show their name and glyph, without a description. Retain necessary form labels, validation errors, save/compile status, dates and actionable empty states. Preserve authored resource descriptions in storage/backups so simplifying their display does not discard existing content.

Create one shared `SectionTabs` component and common header/action spacing tokens. Use it for Learn, Interviews, Applications and Direction where their controls perform the same navigation function:

- Consistent height, font size, padding, border, corner radius, focus treatment and active state. Target 40 px desktop controls and at least 44 px touch targets.
- Page title → tabs → content uses the same vertical gaps everywhere. Interviews tabs should start at the same position as Learn tabs rather than gaining extra space from a subtitle.
- Primary actions occupy the same header position in edit mode. Small card management controls share a separate compact size; ordinary reading/selection controls stay uncluttered.
- Preserve keyboard tab navigation, overflow scrolling and the hidden scrollbar on narrow screens.

Use vivid blue, pink, lime and aqua for content, with consistent navigation roles rather than blue everywhere. Proposed treatment: pink for the selected sidebar section and lime for selected in-page tabs, both with the existing ink borders/shadows. Keep blue among the roadmap/content colours. Apply these roles consistently across sections rather than changing selection styles independently on every page.

Dark mode should use an almost-black canvas (`#101114` as a starting point), slightly lighter panels (`#191b20`) and raised surfaces (`#23262d`), with readable borders and near-white text. Sidebar and main canvas stay related. Check contrast in context, including inputs, popovers, editor gutters, error text and disabled controls.

## 2. Refine holds, glyphs and whole-card actions

Change edit-mode activation/deactivation from 3,000 ms to **1,000 ms**. Keep a brief 200–250 ms feedback delay so an ordinary click never starts the fill; the remaining fill duration ends exactly at the one-second threshold. Derive duration and animation from one setting so JavaScript, CSS, hints and tests cannot drift. Preserve cancellation on movement/release/blur, keyboard Space holds, completed-hold click suppression, query parameters and per-section session state. Update all instructions mentioning three seconds.

Replace the personal-site generic profile icon with a clean outlined **square with an outward arrow**, identifying it as a personal website rather than a person/avatar. All company, language and resource glyphs should be monochrome: black/ink in light mode and near-white in dark mode, with no per-brand colour styling.

Extend the existing local registry into a reusable brand/technology glyph registry. Cover Python, JavaScript, TypeScript, React, Node.js, Go, Rust, Java, C++, PostgreSQL, MySQL, SQLite, Redis, Linux, Git, Docker, Kubernetes, AWS and common reference sites as well as existing companies. Resource metadata can explicitly specify its technology glyph: a Python tutorial gets Python even when hosted on a different site's domain. Fall back to known name/domain matching, then leave unknown glyphs blank. Keep assets local and retain their attribution.

Make each actionable card or row a complete hit target: application/company rows, document family cards, document variant rows, More documents, profile links, resource links and appropriate timeline/story cards. Clicking padding or an unused part of the card performs the same primary action as its title. Include hover/focus feedback and keyboard activation.

Use real anchors for destinations and real buttons for expansion. Avoid nested interactive elements: separate the primary hit area from edit/delete/compare/download controls, and ensure auxiliary actions and text selection cannot trigger the primary action. Application tables can use a clearly labelled primary anchor plus guarded row handling; test modifier clicks, selection and nested controls. Do not make non-actionable text panels appear clickable.

## 3. Reuse the personal-site LeetCode calendar

The source is `../Personal-website/src/components/LeetCodeStats.tsx`, specifically `SubmissionHeatmap`, plus its metrics in `src/lib/leetcodeMetrics.ts` and data hook in `src/hooks/useLeetCodeStats.ts`. It displays a compact 30-day, three-row/ten-column heatmap, per-day solved problems, streak, recent solved count, totals and difficulty breakdown.

Work already has compatible metrics in `src/features/learn/foundations/leetcodeMetrics.ts`, the `solvedDays` schema in `shared/learning.ts`, and the shared `useLearningData()` store. Its authenticated `/api/learning/stats` route already reads the personal-site learning source. Port the presentation into a new `LeetCodeCalendar` component rather than embedding the personal site or introducing another competing fetch/cache layer. Do not modify the sibling repository.

Place the compact progress card above the DSA/Python roadmap, aligned with the roadmap and timer. Use Work typography, saturated lime solved cells, a pink today outline, quiet empty cells and monochrome icons. Display the existing useful metrics without an explanatory subtitle. Hover, keyboard focus and tap should reveal the day's problems; provide real LeetCode links and an Escape/outside-click dismissal for the expanded day details.

Keep calendar, streak and recent count derived from the same solve history. Preserve the existing fixed AEST day-boundary convention used by the source; do not silently reinterpret already bucketed history using Melbourne daylight-saving time. If recent data is capped or stale, show its actual scope/freshness compactly rather than inventing an exact count. Refresh date cells at midnight/visibility return, and handle no username, loading, cached data, errors and empty history. A timezone change would need a separate migration of source history.

## 4. Native LaTeX: real compilation inside the Work workflow

### Architecture and fidelity

Build the document editor into Work. Use **CodeMirror 6** for editable LaTeX/project files, **PDF.js** for preview with a text layer, and a private **Linux compilation service running TeX Live and latexmk**. Work's existing Worker remains the authenticated gateway; D1 stores metadata/revisions and R2 stores project blobs and generated artifacts. Browser preview and PDF download consume the same generated PDF, with no manual replacement upload.

Overleaf itself uses `latexmk` and selectable TeX Live/compiler versions. Reproducing output requires matching the selected engine, TeX Live/package versions, fonts, project files, main document, build configuration and relevant environment settings—not merely installing a package called LaTeX. Overleaf also publishes a way to retrieve its version-dependent system `LatexMk` configuration. Use these as the compatibility reference. [Overleaf's compiler/version documentation](https://docs.overleaf.com/getting-started/recompiling-your-project/selecting-a-tex-live-version-and-latex-compiler), [latexmk configuration documentation](https://docs.overleaf.com/managing-projects-and-files/the-latexmkrc-file).

Start with a pinned full TeX Live image and `latexmk`, supporting pdfLaTeX, XeLaTeX and LuaLaTeX. Record the image digest, TeX Live release, engine, compiler configuration and input hash for every build. New templates can use a tested default; imported projects retain their actual selected settings. Pin package/font snapshots and upgrade deliberately. Never substitute an HTML-to-PDF or browser approximation and claim equivalent output. [TeX Live installation](https://tug.org/texlive/quickinstall.html), [latexmk package](https://ctan.org/pkg/latexmk?lang=en).

A container service adds a deployment component. Prototype it locally with Docker first; select a small Linux container host for production after measuring full-image size, cold starts, compile time and cost. Cloudflare Containers is an option alongside the existing account, subject to that feasibility/cost check; a dedicated Linux container service behind Work's authenticated gateway is the fallback. Keep the hosting adapter replaceable. Provisioning and production deployment follow a reviewed working prototype. [Cloudflare Containers](https://developers.cloudflare.com/containers/).

Use isolated, temporary job directories, a non-root process, bounded CPU/memory/time/output, safe archive paths, no runtime network access and no access to service secrets. Disable shell escape by default. Arbitrary `latexmkrc` is executable Perl, so support imported custom build rules only within the isolated job and an explicit supported-policy boundary; surface unsupported requirements. Compilation isolation is material for real TeX execution, including a single-user site. [Overleaf's compile-isolation guidance](https://docs.overleaf.com/on-premises/configuration/overleaf-toolkit/server-pro-only-configuration/sandboxed-compiles).

### Source, builds and synchronization

Represent each résumé/cover-letter variant as a project containing `main.tex`, included `.tex` files, `.cls`/`.sty` files, images, fonts and optional bibliography/configuration files. Keep the file tree collapsed for simple one-file templates. Import complete Overleaf source ZIPs; a PDF alone cannot reconstruct its original LaTeX project. Preserve existing uploaded files as legacy documents while allowing their source to be imported later.

Add typed project, immutable revision and compile-job contracts. Each revision identifies a complete immutable file manifest; each build is keyed by owner/project/revision plus compiler settings. Authenticated API responsibilities include saving with expected-version checks, creating/listing revisions, importing/exporting sources, enqueueing/cancelling a compile, reading job status/logs and downloading artifacts. A trusted compiler channel receives only that owner's bounded job inputs and returns outputs for the same job.

Autosave changes with existing private-draft/conflict recovery. Compile after a short idle debounce or explicit Recompile; coalesce repeated requests and cache identical inputs. An older job finishing after a newer edit must not replace the newer preview. Clearly distinguish saved source, compiling, compile error, last successful PDF and PDF matching the current revision. Keep the previous successful preview visible on compile failure, labelled as previous output. Download defaults to the current successfully compiled revision; stale output is an explicit choice, never silently presented as current.

Show errors/warnings in a compact expandable log with file/line navigation. Support source ↔ PDF navigation via SyncTeX after the compiler/preview integration works. Download the original compiler-produced PDF bytes; viewer styles must not alter the artifact. Also support source ZIP export.

### ATS checks

Compiler fidelity does **not** guarantee every ATS will parse every document correctly. The release target is a conventional text PDF with verified extraction and reading order, not an unconditional ATS guarantee. Supply conservative single-column résumé/letter templates with real text, embedded fonts and standard headings. Test extracted names/contact details, ligatures, bullets, dates, headings and reading order; use `pdftotext`/font inspection in the compilation environment and PDF.js text extraction in the UI. A subtle optional text-view/check panel lets the user inspect what a parser sees. Keep screenshots/outlined text and unusual layouts out of default templates. [PDF.js](https://mozilla.github.io/pdf.js/).

## 5. Documents expand inline, with useful variants and application links

Keep the current résumé and cover-letter art as their collapsed entry cards. Clicking anywhere in a family card expands that family **inside Documents**, smoothly occupying available width/height. Its compact header provides Collapse, the selected variant, PDF download and compile state. A small variant strip/list supports Main, Master, Security and company-specific variants. Open to the PDF preview by default; a Source toggle reveals the source/PDF split view, and source becomes writable in edit mode. On mobile switch between Source and Preview. Logs, file tree, engine/version settings and differences are disclosed only when requested. Structural editing, linking, forking and deletion controls live in edit mode. Load editor/preview libraries only when the document panel needs them.

More documents also expand inline to show PDF, image or text content. Avoid a separate document viewer subpage or a modal that replaces the whole section. Keep grid density useful for ten or more files. Store expansion/selection in URL query parameters for deep links, while keeping the Documents page mounted; older viewer URLs open the matching inline panel. Preserve focus, scroll position and reduced-motion behaviour when collapsing.

Add explicit variant lineage: family, primary variant, parent variant, fork-point revision, optional application IDs and optional intended stream/company. Fork by copying the source manifest into an independent variant, reusing immutable blobs safely until a file changes. Never propagate primary edits into variants without the user choosing to review them.

Provide two comparisons: **changes since fork** against the recorded primary revision, and **changes from current primary**. Highlight source additions/deletions with CodeMirror merge support and compare generated previews. Offer review/copy of selected changes without silently overwriting tailored wording. A compiled marked-up difference PDF using `latexdiff` is a later enhancement once basic source comparisons are reliable; label it as a comparison artifact and exclude it from normal application downloads. [CodeMirror merge API](https://codemirror.net/docs/ref/#merge), [latexdiff](https://ctan.org/pkg/latexdiff).

Link a variant to an application using a compact picker in the expanded family. Match by stable application ID, not company name; permit several applications for one company, reusable variants, and unlinked Master/Security versions. Applications can expose one understated Open documents action that expands the relevant family/variant in Documents. Avoid reintroducing résumé URL/cover-letter URL fields or duplicate editors in application forms.

When recording which version was submitted, retain the exact immutable source revision and compiled artifact. Deleting an application detaches live links while keeping useful documents and submitted snapshots. Deleting a variant preserves historical submission artifacts. Extend ownership validation, relationship detachment and backup restore mapping accordingly.

## 6. Migration, backup and delivery sequence

Keep legacy attachments, document IDs, profile links, forks and submitted snapshots intact. Add project/source metadata without pretending that an existing PDF is editable LaTeX. Map older named résumé/letter records into their families; imported source is an explicit conversion. Preserve the user's existing unstaged code edits while implementing this plan.

Extend the archive manifest for source manifests, revisions, compiler settings, generated PDFs, variant lineage and application-submission references. Remap record/revision/file references on additive restore and retain v1/v2/v3 backup compatibility. Deduplicate immutable blobs without weakening ownership checks. Back up the current working source and any submitted revision/artifact even when no successful latest PDF exists.

| Phase | Work                                                                                                                                  | Acceptance                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Remove subtitles/descriptions; shared tabs/spacing; darker theme; monochrome/technology glyphs; one-second hold; whole-card hit areas | Consistent populated/empty desktop/mobile screens, reliable keyboard/touch interactions                                                     |
| 2     | Personal-site learning calendar and matched roadmap popover colours                                                                   | Linked List opens a pink header; calendar/history/metrics agree and handle stale/capped data                                                |
| 3     | Native compilation prototype and hosting measurement                                                                                  | Representative multi-file projects compile with pinned engines/settings; source/PDF/text output compared with the same projects in Overleaf |
| 4     | Project/revision/job APIs, autosave, logs, PDF.js, inline family/document expansion                                                   | Edit → save → compile → preview → download stays in Work; stale/racing/failed builds cannot mislabel output                                 |
| 5     | Main/Master/stream/company variants, source differences, application links and immutable submitted revisions                          | Tailoring remains independent; primary changes are reviewable; submitted artifacts stay exact                                               |
| 6     | Compatible migration and backup restore                                                                                               | Sources, files and relationships survive restore; existing account data remains intact                                                      |
| 7     | Final accessibility, performance, security and release verification                                                                   | Functional checks pass, narrow-screen layouts stay usable, compiler deployment/cost is documented                                           |

For the roadmap popover, derive the node and its header from the same topic tone/foreground token rather than assigning a fixed lime header. This applies equally to blue, pink, lime and aqua nodes, including readable close controls in both themes.

Test holds just below/at one second, cancellation and ordinary clicks; whole-card/nested action behaviour; shared tab sizing/placement; popover tone matching; calendar date rollover/capped history; safe source ZIP handling and cross-owner isolation; compiler errors/timeouts/cancellation; out-of-order builds and offline/conflicting source edits; variant forks/merges/deletions; exact submitted downloads; and archive/restore idempotency. Compare representative source/PDF/text outputs across supported engines and matching Overleaf settings; exclude timestamps/PDF identifiers from any byte-reproducibility claim. Use synthetic data only in local/staging test fixtures, without filling the real account with mock data. Limit visual checks to a few representative populated screens rather than taking screenshots throughout development.
