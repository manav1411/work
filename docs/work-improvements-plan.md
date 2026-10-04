# Work improvements implementation plan

Status: implemented in the working tree, 5 October 2026; local verification is recorded in [verification.md](verification.md). Production deployment/migrations and staging review remain separate. This document records the agreed implementation scope and release checks. It supersedes conflicting product decisions in [the simplification plan](simplification-plan.md), while retaining its simpler navigation, private persistence, and useful timelines.

The intended result is a personal engineering workspace with expressive colour, editable content, a proper application tracker, interview preparation, documents, and longer-term direction. Information should be maintained in its natural place and reused elsewhere.

## 1. Proposed navigation and ownership

Keep six primary destinations, with Settings and Sign out in the account menu:

| Destination    | Purpose                                                                           | Main actions                                                                                            |
| -------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Home           | Near-term timeline derived from applications, appointments, goals, and milestones | Browse dates and open the corresponding source record                                                   |
| Learn          | DSA & Python roadmap and editable engineering topics                              | Manage topics, readings, resources, and optional notes; practise with the existing Pomodoro             |
| Applications   | Application tracker and companies on your radar                                   | Add/edit/delete applications and radar companies; outline recruitment steps; schedule interviews        |
| Interviews     | Behavioural and technical preparation                                             | Edit introductory notes, maintain STAR stories, create custom tabs, prepare for particular appointments |
| Documents      | Named uploaded documents, Overleaf destinations, and personal profile links       | Open, upload, rename, replace, download, edit, and delete                                               |
| Your Direction | Career options, streams, goals, and longer-term milestones                        | Compare routes, record decisions, and maintain a higher-level timeline                                  |

Desktop uses one cohesive sidebar. Mobile uses the navigation drawer for all six destinations and a compact bottom bar with Home, Learn, Applications, and More, avoiding six squeezed buttons.

Appointments are created and scheduled in Applications. Preparation is written in Interviews. Goals and milestones are created in Your Direction. Documents remain independent of applications. Home displays the resulting information without another set of creation forms.

## 2. Restore the visual identity and add usable themes

The original palette is still present in `src/styles.css`, including blue `#315bff`, pink, lime, orange, and aqua. The previous Learn tabs used solid blue with white text, outlined buttons, and offset shadows; the current replacement uses mostly transparent tabs and a lime active state. Restore the earlier interaction treatment using the pre-simplification revision `b9b6156` as a visual reference.

- Restore the deep bright blue active topic tab, including Backend engineering. Use strong topic/resource cards, purposeful coloured accents, dark outlines, bold heading typography, and small offset shadows throughout the six pages.
- Keep ordinary reading and editing surfaces calm. Use colour for selected tabs, useful actions, section headers, story cards, and timeline states, with text/icons conveying meaning alongside colour.
- In light mode, bring the sidebar onto the same warm light canvas as the main page, with a clear border and coloured active item. Update the wordmark, account control, menus, hover states, and mobile navigation together.
- In dark mode, use related dark canvas and panel colours for both sidebar and content. Preserve the saturated accents with appropriate foreground colours and readable borders/shadows.
- Add a Light / Dark control to Settings. The preference model, validation, and application of `data-theme` already exist; expose them and finish styling the newer feature components.
- Replace hardcoded light backgrounds and sidebar foregrounds with shared surface/text tokens. Apply the theme before the initial app render using a cached preference, then reconcile with the saved account preference to avoid a light flash.
- Retain reduced-motion support, visible keyboard focus, touch targets, and the horizontally scrolling Learn tabs with their hidden scrollbar.

Review representative screens in both modes at desktop and narrow mobile widths. The same component treatments should carry through Learn, applications, STAR cards, document cards, and direction paths.

Implementation areas: `src/styles.css`, `src/app/shell.css`, `src/components/ui.tsx`, feature styles, `src/lib/workspace.tsx`, `src/main.tsx`, and Settings.

## 3. Documents: an in-site viewer, uploads, and profile links

### Overleaf feasibility and the viewer

Make **Open résumé** and **Open cover letter** navigate to a document viewer within Work, with the normal shell, a compact toolbar, and a viewport occupying most of the remaining page. Provide Back, expand/fullscreen, Download when a file exists, and Edit in Overleaf when a project link exists. Support the same viewer for named variants.

There is a verified constraint: on 4 October 2026, a live request to [Overleaf's login page](https://www.overleaf.com/login) returned `X-Frame-Options: SAMEORIGIN`. That blocks this login page inside Work's cross-origin iframe. [The header's browser behaviour is documented by MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Frame-Options). Private project embedding therefore cannot be promised, and an authenticated project or public read link has not been verified in this review.

Run a small feasibility check before implementing the viewer: test the actual project/read routes, authentication, and session reload in supported browsers. Embed the Overleaf editor only if a supported route permits framing and works reliably. Work's current `frame-src 'self' blob:` policy would also need a narrowly scoped Overleaf allowance in both `worker/index.ts` and `public/_headers`; changing Work's policy cannot override Overleaf's own restriction. Work can style the surrounding frame, while Overleaf controls the editor's interior.

The reliable default is an uploaded PDF displayed in Work's large authenticated viewer, with Edit in Overleaf opening the source project separately. Overleaf documents its [PDF download workflow](https://docs.overleaf.com/managing-projects-and-files/downloading-a-project). Label the PDF as the uploaded copy; replacing it is explicit, with no implied live synchronisation. When only an unembeddable project link exists, show a useful Open in Overleaf action and Upload PDF option instead of a blank or permanently loading frame. This is the fallback for both résumé and cover letter, not a substitute claim that the editor was embedded successfully.

### Document library

- Keep résumé and cover letter as convenient defaults, and add **Add document** for any user-chosen name, such as Resume for Google.
- A document can have an uploaded file, an Overleaf project link, or both. Allow editing its name/link, replacing its file, downloading it, setting a résumé/cover-letter default, and deleting it with recovery.
- Reuse existing `asset` records and authenticated attachment storage. Convert current default links into the collection without changing their record IDs or duplicating them.
- Preview PDFs and supported images. Offer downloads for other supported formats; add validated DOCX support for common résumé uploads if needed, without building a Word editor. Show allowed formats and the existing 10 MB per-file limit in the upload control.
- Keep uploaded documents independent of company/application records. Remove résumé URL, cover-letter URL, selected document fields, and document shortcuts from application forms and details.
- Preserve existing submitted snapshots and historical document references in storage/backups. Removing fields from the active interface must not destroy those files.
- Add a compact **Your links** area in Documents with LinkedIn, GitHub, portfolio/website, and user-added named links. Each supports add/edit/delete and tasteful coloured link cards. Populate known values from saved preferences; do not seed the owner's URLs into new users' accounts.

The attachment endpoint already supports inline PDF/image responses with ownership checks. Reuse it; include missing-file, expired-session, replacement-failure, and mobile download states. File upload success and document metadata updates should recover cleanly if either operation fails.

Implementation areas: `src/features/assets/AssetsPage.tsx`, `documentLinks.ts`, new viewer/editor components, `worker/files.ts`, attachment routes, and document styling.

## 4. Learn: roadmap first, editable topics and resources

- Remove Weeks, week cards, slide/homework entry points, and the Weeks / Roadmap toggle from Work's DSA & Python area. Open directly on the roadmap; retain the contextual Pomodoro.
- Keep the existing roadmap topics, problems, stable LeetCode slugs, and confirmed-solve behaviour. This roadmap's dataset is derived from NeetCode; retaining the requested roadmap does not require linking users to NeetCode.
- Remove built-in NeetCode resource cards and outward links. Preserve provenance comments. User-authored saved content is retained rather than deleted by a seed-resource change.
- Place useful, editable resource cards beside the relevant topic. Initial examples: [LeetCode problems](https://leetcode.com/problemset/), [Python tutorial](https://docs.python.org/3/tutorial/), Python standard-library references, and [PostgreSQL's tutorial](https://www.postgresql.org/docs/current/tutorial.html) under Databases. Reuse the existing topic-specific official resources where appropriate.
- Restore topic controls for add/edit/delete, including custom engineering topics. Each topic supports multiple named reading/resource links and optional notes sections instead of a single fixed resource URL.
- For example, Databases can contain SQL readings, transaction/concurrency resources, and an optionally added My notes section. Notes support basic formatting, links, lists, and checklists; they remain optional.
- Allow adding, renaming, reordering, and removing user-created sections. Removing a built-in topic/resource creates an owner-specific hidden override so it does not reappear after refresh or a content update. Provide a way to restore defaults.
- Store additions and overrides privately in Work. Do not send topic notes or career data to the public personal-site learning API.

Split roadmap statistics from the week/content/progress loader so ordinary Learn and Home visits stop fetching curriculum data that is no longer displayed. Keep the existing statistics source, cache freshness/error states, and LeetCode identity. Do not build another solve-history service.

New goals no longer offer a Weeks/curriculum completion measure. Existing curriculum-measured goals retain their last recorded progress and a clear source-retired state until explicitly converted or removed; do not silently turn them into roadmap goals. The sibling teaching site and its progress data remain independent of removing Weeks from Work.

Consolidate `src/content/problems.ts` and `src/features/learn/foundations/roadmapData.ts` into one versioned problem definition consumed by the roadmap and goal metrics, preserving problem IDs/slugs.

Implementation areas: `src/features/prepare/LearnPage.tsx`, `src/features/learn/useLearningData.ts`, foundations, `src/content/learning.ts`, shared topic/resource models, and source adapters.

## 5. Applications: replace the spreadsheet and model recruitment steps

### Tracker and company radar

Make the default Applications view a readable table with the exact fields from the spreadsheet:

| Field            | Behaviour                                                       |
| ---------------- | --------------------------------------------------------------- |
| Company          | Required company name, optionally selected from radar companies |
| Role             | Required role title                                             |
| Listing link     | Optional clickable vacancy URL                                  |
| Status           | Overall application state, with current step shown alongside it |
| Application date | Explicit date-only value, optional before submission            |
| Location         | Optional city/country and remote/hybrid details                 |
| Notes            | Optional editable notes with a short preview in the row         |

Allow add/edit/delete, useful sorting, a compact company/role search, and status filtering. On narrow screens, use equivalent cards instead of forcing a wide table. Keep application deadline, follow-up date, contact, and meeting details available in the detail view without requiring them during creation.

Add an **On your radar** tab within Applications. A radar company needs only its name; website/careers link, location, reason for interest, notes, and an optional review date can be added. It has no required role and does not count as a submitted application.

Offer **Add application** from a radar company with the company prefilled. One company can have several applications and remain on the radar. Reuse existing `company` records and `companyId` relationships. Do not merge companies automatically just because their names match. Deleting a radar entry must preserve its applications and their company display names.

### Recruitment timeline and status

Each application's details contain an editable ordered process, for example:

`Application → Online assessment → Behavioural interview 1 → Technical interview → Final interview → Offer`

The user can add, name, edit, reorder, skip, and remove steps. Steps can be planned before dates are known, and can be created without accepting a template. An optional common-process template speeds up entry and remains fully editable.

Display the process as a horizontal timeline on desktop and a vertical timeline on mobile. Show labels, states, known dates, and the current step. Undated stages remain visible here; only explicitly dated events appear on Home.

Separate three concepts:

| Concept                    | Proposed values                                                   | Meaning                                   |
| -------------------------- | ----------------------------------------------------------------- | ----------------------------------------- |
| Overall application status | Saved, Applied, In progress, Offer, Accepted, Rejected, Withdrawn | The application's broad state/outcome     |
| Recruitment step state     | Planned, Current, Completed, Skipped, Cancelled                   | Progress through this company's process   |
| Appointment state          | Scheduled, Completed, Cancelled, Rescheduling                     | What happened to a particular appointment |

Use one shared status calculation for rows, details, filters, and Home. An application with no submission or activity is Saved; explicit submission is Applied; advancing to an active assessment/interview stage gives In progress. Offer and terminal outcomes are deliberate updates. Selecting Applied records/confirms an editable application date and marks the submission step consistently. Selecting In progress or Offer prompts for a corresponding current step when a process exists. Terminal outcomes override the displayed status but do not complete all remaining steps.

Scheduling a future interview does not mean earlier rounds have been passed. Marking an appointment Completed does not mean the recruitment step was passed; completing/advancing that step is a separate explicit action. Cancelled appointments do not reject an application. Manual status changes and step changes should never leave two contradictory active states.

Give steps stable IDs. Reuse interview records for appointments, linking each to `applicationId` and an optional `stepId`; do not copy meeting dates into a second event collection. Support multiple appointments for a step. Moving/removing a step preserves appointments and preparation, offering reassignment where necessary.

Scheduled interviews have a clear **Prepare** action opening their context in Interviews. Link resources and notes there, while meeting details remain in Applications. Home derives the same appointments without creating duplicate events.

Keep old stage labels and stage history intact during migration. Map clear legacy statuses conservatively; preserve ambiguous/custom labels for review instead of inventing a precise recruitment process. Existing interviews can be attached to generated steps only where their meaning is clear.

Implementation areas: `src/features/search/ApplicationsPage.tsx`, `applicationRecords.ts`, `InterviewEditor.tsx`, domain/status helpers, shared application schemas, and Home's timeline selectors.

## 6. Interviews: preparation, STAR cards, and custom tabs

Restore `/interviews` as an active page with Behavioural and Technical tabs by default. For each, the user's editable main text appears first: things to remember, preparation principles, or frequently used notes.

Behavioural includes a visually distinct **Story bank** beneath that text. Each STAR card has a title, Situation, Task, Action, and Result, with optional lessons and competency tags such as conflict, leadership, or ownership. Support creating, editing, duplicating, deleting, and filtering stories. Reuse the same story in several interview preparations through references rather than copying it.

Technical starts with its own introductory text and supports note sections, checklists, resource cards, and reusable explanations. The user can create additional named tabs, such as Technical interview notes or System design, and rename/reorder/delete them. Use a small formatted-text/Markdown editor with preview and autosave, based on the existing Markdown rendering and persistence; a full Notion block/database editor is unnecessary for the requested workflow.

Provide appointment-specific preparation opened from Applications or an upcoming-interview list in Interviews. Show the application, round, date/time, and links back to its appointment. Allow personal preparation text, checklists, resource links, and selected STAR stories. Create a preparation record only when content is saved.

Appointment scheduling stays in Applications. Interviews reads existing appointments, so changes to their title, date, cancellation, or application relationship appear here automatically. Preparation can remain useful after an appointment is completed or cancelled.

Restore identifiable legacy `story` records to the Story bank and existing interview preparation text to its appointment context. Imported generic Notion notes do not automatically become interview preparation. Reuse the old STAR field definitions and helpers from `b9b6156`, adapting the interface to the new structure.

Implementation areas: a new `src/features/interviews/` feature, reusable notes/resources components, existing `story`/`note` records, preparation schemas, and application links.

## 7. Your Direction: paths, streams, decisions, and longer-term goals

Add `/direction` with the label **Your Direction**. It is the home for goal/milestone creation and a longer-term timeline with quarter/year scale and a readable chronological mobile view.

- **Career paths:** named route cards with optional description, target stream/location, priority, status, next step, research links, and notes.
- **Streams and experience:** retain useful software/backend/cybersecurity rotation information and allow new streams or experiences.
- **Decisions:** a small comparison of alternatives, reasons, uncertainties, and a chosen direction where one exists. For example, cybersecurity versus software engineering can be explored without a compulsory weighted worksheet.
- **Goals and milestones:** reuse the current measurable goal model. Goals can relate to a path/stream, chosen roadmap progress, or another explicit outcome. Dates are optional until the user sets them.

Recover existing authored paths where present, including Australia → possible US transfer, direct US applications, and a possible Flutter-group move. Preserve their original notes and dates. These are the owner's existing options, not defaults for every account or promises about mobility eligibility. Never reinstate a hardcoded career timeline over the user's saved dates.

Relate goals to paths by a stable `directionId` in the goal model, validation, persistence, and backups. Reuse a goal/milestone's ID when projecting it into Home; no duplicate goal entry is required. Undated routes stay on Your Direction, and meaningful dated goals/milestones also appear on Home.

Implementation areas: a new `src/features/direction/` feature, retained `src/features/career/domain.ts`, existing `path`/`rotation`/`decision` records, `shared/goals.ts`, the goals API/client, and the shared timeline.

## 8. Home and Settings cleanup; retire unused connections

Home retains the near-term timeline and its browse/expand controls. Remove Add interview, Add goal, goal-creation forms, and the Learn / Applications / Documents shortcuts beneath the timeline. Opening a timeline item leads to its relevant application, preparation, or direction context. It should remain useful even when empty without inventing goals or setup tasks.

Settings retains account information, timezone, LeetCode username, Light / Dark, reduced motion, and a simple Backup & recovery area with **Download backup** and **Restore backup**. Restore can still display its preview, validation, and result after a file is chosen. Remove Saved records and files, the generic retained-record browser/counts, and the Learn / Overleaf documents shortcuts. Show device-draft recovery only when unsynced changes actually exist.

The Notion/GitHub/Overleaf connections were built for imports/mirroring and document/provider workflows. The previous simplification already stopped background sync and webhook ingestion, but Settings still lists existing connections and the connector route module retains a broader API. Direct profile/project links need none of these connections.

Retire the remaining unused connector management, discovery, authorisation, sync, activity, and suggestion paths. Remove connection fetching from Settings after moving any still-used legacy LeetCode username into the normal preference. Keep the existing explicit LeetCode statistics adapter and **GitHub sign-in**, which serves authentication rather than repository import.

Disconnect unused local provider credentials through a deliberate owner-scoped migration without deleting imported records. Revocation at a provider is a separate supported operation where available; do not claim external access has been revoked merely because Work's local token was removed. Retained Notion content stays in backups and does not appear as account information or active notes without an explicit mapping.

Audit legacy redirects: `/career` goes to Your Direction, `/interviews` opens the new preparation page/context, `/companies` goes to On your radar, and identifiable assets go to their document viewer. Preserve useful query IDs. Other retired deep links explain that their data is included in Download backup, without restoring the removed inventory UI.

## 9. Shared content, data, and migration design

Reuse the current React/Worker/D1/R2 stack, record CRUD, revisions, owner checks, conflict handling, and device outbox. Existing record kinds already cover most additions; avoid rebuilding the `records` table just to add screens.

| Feature                          | Proposed persistence                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Topic edits and hidden built-ins | `topic` record with stable seed/track IDs and explicit override/hidden metadata                                    |
| Reading/resource link            | `resource` record with URL, label, scope, and optional section relationship                                        |
| Optional section/custom tab      | `note` record marked as a section, with workspace area, parent context, and ordering                               |
| Section text/checklists          | `note` record scoped to its section/topic/preparation context                                                      |
| STAR story                       | Existing `story` record with validated STAR fields                                                                 |
| Appointment preparation          | Scoped `note` linked to an interview/application and reusable story IDs                                            |
| Radar company                    | Existing `company` record with explicit radar membership                                                           |
| Application process              | Ordered validated `steps` array inside the application record, plus explicit overall outcome/submission fields     |
| Appointment                      | Existing `interview` record with optional application-local `stepId`                                               |
| Document/profile link            | `asset` plus attachments; existing preferences for the three known profile links, scoped resources for extra links |
| Career path/stream/decision      | Existing `path`, `rotation`, and `decision` records                                                                |
| Goal                             | Existing goals storage, extended with optional `directionId`                                                       |

Use stable IDs and bounded, discriminated schemas for newly structured data. Server validation must check ownership, relationship target kind, URL schemes, date/timezone values, step membership, and unique ordering/IDs. Updates touching a process and its appointment references should validate record versions and commit atomically. Scope-specific selectors prevent retired or imported generic notes from appearing as newly created content.

Extend `shared/references.ts` for section, interview, direction, and story relationships. Application-local step IDs need their own mapping: restore must regenerate/remap them consistently with the appointments that refer to them. Deleting a section/path/company should detach relationships while retaining independently useful child records and text. User deletions use existing soft-delete/recovery behaviour and a contextual Undo where practical.

Retain existing pending-change visibility and outbox behaviour for text/record edits. Handle uploads as uploads with explicit pending/retry states; do not pretend large binary files are already protected by the text outbox. Autosave must debounce, retain drafts on failure, and surface conflicts rather than overwriting another saved version.

Run an owner-scoped, repeatable migration with a dry-run report. Inventory authored versus imported records, application stage histories, documents/files, old stories/paths, goal relationships, and pending edits. Reuse existing IDs where possible, create only unambiguous relationships, and keep ambiguous material in the backup. Do not automatically seed sample career paths or owner-specific profile values for additional users.

### Backup compatibility is part of the document work

The current JSON export embeds at most 20 MB of files and directs larger collections to metadata plus individual downloads. Removing Saved records and files would remove that fallback just as uploads return, so this must be resolved before release.

Keep one Download backup action that creates a file-inclusive archive with a versioned JSON manifest and separate binary files, using bounded streaming/chunked storage and upload rather than one large base64 request. Restore validates the manifest/files and restores records and relationships as separate copies, idempotently. Retain restore support for existing version 1 and 2 JSON backups; use a new manifest version for the extended format and relationships. Imported legacy data remains included even when its original UI is gone.

A backup must never silently omit files. Handle archive limits, interrupted generation/restoration, and missing files with explicit results. Pending device edits remain recoverable separately when they are not yet part of the server backup. This preserves the requested two-option Settings interface without weakening backup coverage.

## 10. Delivery order

| Phase                                        | Work                                                                                                                                           | Exit condition                                                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| A. Resolve contracts                         | Overleaf feasibility check; page sketches; application status/step rules; scoped content/reference schemas; migration report and backup format | Every request has a concrete destination; iframe feasibility and legacy-data treatment are recorded                    |
| B. Restore the shell and design              | Shared colour/component treatments, cohesive sidebar, six destinations, theme control, mobile navigation, Home/Settings shortcut removal       | Expressive design works in both modes; navigation remains readable; new routes have useful loading/empty states        |
| C. Add content primitives and backup support | Notes/sections/resources, typed ownership/reference validation, recoverable edits, file-inclusive export/restore                               | Editable content persists privately; new relations and files survive backup/restore, including collections above 20 MB |
| D. Deliver Learn and Documents               | Roadmap-only Learn, resource/topic/notes CRUD, uploaded/named documents, profile links, large viewer and Overleaf fallback                     | Databases supports multiple readings and optional notes; résumé/cover-letter/variants open in a useful viewer          |
| E. Deliver Applications                      | Spreadsheet fields, radar companies, custom process timeline, consistent status and scheduling                                                 | A company can remain on radar without a role; one application can track multiple rounds and appointments               |
| F. Deliver Interviews and Direction          | Introductory text, STAR bank, custom tabs, appointment prep, paths/streams/decisions, goal editing and longer timeline                         | Application → preparation and direction → Home flows reuse their source data without duplicate records                 |
| G. Finish migration and retirement           | Rehydrate useful legacy records, fix deep links, remove unused connector routes/credentials/dependencies, refresh demo/tests/docs              | No dead connector controls, lost historical content, contradictory status views, or redundant navigation shortcuts     |
| H. Verify and release                        | Relevant checks, desktop/mobile review, migration/restore rehearsal, staging review, separate production rollout                               | The complete workflows and both themes pass with realistic synthetic data before production changes                    |

Dependency notes: shared content and references precede Learn/Interviews; file-inclusive backup support precedes releasing uploads and removing the old recovery fallback; application/appointment IDs precede contextual preparation; direction models precede moving goal editing out of Home. Publish complete usable flows rather than exposed placeholder pages.

## 11. Acceptance and verification

Use these as the implementation checklist:

- [ ] All six destinations work on desktop/mobile; Settings and Sign out remain easy to reach.
- [ ] Learn's selected topic uses the restored blue/white treatment; cards, links, timelines, and STAR stories carry the same deliberate visual language.
- [ ] Sidebar and page feel cohesive in light and dark mode; the saved theme survives reload and account use; reduced motion and keyboard focus remain usable.
- [ ] DSA & Python opens on the existing roadmap; Weeks is absent; LeetCode/Python resource cards are present and built-in NeetCode links are absent.
- [ ] A user can add/edit/delete multiple Databases readings, create optional notes, add/reorder/remove sections, and hide a built-in topic/resource without its reappearing.
- [ ] Learn's private notes/resources are never sent to the public learning source; stale solve data is represented accurately.
- [ ] Résumé and cover letter open in the large Work viewer when a previewable file is present; Overleaf embedding is enabled only after the actual supported route passes verification, with a useful fallback otherwise.
- [ ] Resume for Google can be uploaded, renamed, replaced, opened, downloaded, and deleted independently of any application; LinkedIn/GitHub/custom links are editable in Documents.
- [ ] Applications exposes Company, Role, Listing link, Status, application date, location, and notes, with CRUD and usable mobile presentation.
- [ ] A radar company can exist without a role, generate several applications, and be removed without deleting those applications.
- [ ] Application processes support custom, undated, repeated, reordered, skipped, and removed stages; overall outcomes and appointment states remain distinct and consistent.
- [ ] Scheduling/rescheduling/cancelling an interview updates Applications, Interviews, and Home from one appointment; dates/timezones and daylight-saving transitions are correct.
- [ ] Behavioural and Technical each display editable main text first; STAR cards and user-created tabs persist; a particular appointment can reference reusable stories and private preparation resources.
- [ ] Your Direction restores relevant authored paths and supports software/cyber options, streams, goals, decisions, and a user-maintained longer-term timeline.
- [ ] Home has neither Add interview nor Add goal, and no Learn/Applications/Documents shortcut panel; dated direction/application entries link to their source.
- [ ] Settings has Light/Dark and the two backup actions, with neither Saved records and files nor Learn/Overleaf shortcuts; unsynced recovery appears when relevant.
- [ ] Retired import connections have no active controls/jobs/routes; direct links, GitHub authentication, and LeetCode statistics still work.
- [ ] Old URLs, custom statuses, stories, paths, documents, submitted snapshots, and ambiguous imported records have deliberate destinations or file-inclusive backup coverage.
- [ ] New/legacy backups restore correctly, including more than 20 MB of files, custom sections, goal/path relations, story references, and appointment/step mappings; repeat restores do not duplicate content.
- [ ] Record edit conflicts, failed autosaves/uploads, interrupted restore, and sign-out with pending edits have recoverable outcomes; cross-owner records/files cannot be accessed or linked.

Run `npm run check`, `npm test`, `npm run build`, `npm run test:e2e`, and update/run `npm run test:runtime` for the retained Worker boundaries. Replace tests that require retired UI with meaningful workflow tests; retain authentication, ownership, persistence, conflict, and recovery coverage. Add domain tests for process/status transitions, step-reference migration, relationship restoration, and timeline deduplication, and browser tests for the end-to-end flows and both themes.

Review staging with synthetic accounts, empty and populated states, keyboard interaction, and desktop/mobile layouts. Rehearse migration and restore on copied data, preserve a current backup, and keep production deployment/migration separate from this planning task.
