Work should connect your career plans, learning progress, applications, and existing documents with very little upkeep. Its value should come from seeing those things together and reaching the right tool quickly.

This plan follows the simplification request of 4 October 2026 and supersedes the original product plan's requirement to include every career workflow. It is a proposal for implementation; this document does not change the application or production data.

**1. Establish a smaller product contract.** Keep the art style and reliable private persistence. Reduce the main navigation to Home, Learn, Applications, and Documents. Put Settings and Sign out in the account menu. Make the timeline the main feature of Home, with an expanded view of the same component when needed.

Apply a simple test to every feature: does it connect existing information, show a meaningful date or outcome, or help you perform a specific career task? Remove features whose main purpose is to ask you to maintain another collection of information.

Work owns applications, interview dates, goals, and milestones. Overleaf owns résumé and cover-letter content. Notion owns notes, work evidence, and interview preparation writing. Your personal site's learning system owns the curriculum, slides, homework, roadmap, and existing learning progress foundations. LeetCode remains where problems are solved.

Keep goals explicit and user chosen. Chronological ordering is useful; recommendation ranking, generated next steps, energy-based task selection, and coaching copy are outside this product contract.

The proposed disposition of the current screens is:

| Current area | Proposed treatment |
| --- | --- |
| Today | Replace with a clean Home centred on the timeline. Remove the suggested next action, energy/time selection, motivational cards, activity counters, and setup prompts. |
| Focus | Remove the separate page. Move a compact Pomodoro into Learn's practice context. |
| Learn and Practice | Consolidate into Learn using the personal site's existing learning foundations. |
| Interviews | Move dated interviews and their meeting details into the relevant application and the shared timeline. Remove the separate story bank, mock-feedback forms, and preparation-writing system. |
| Companies | Put essential company information inside applications. Retire the separate research database and its worksheets. |
| Applications | Retain a much smaller application tracker, including interview dates and document links. |
| Your people | Retire the separate contact/outreach manager. Keep an optional relevant contact on an application. A dated follow-up can appear on the timeline. |
| Your direction | Replace path, rotation, and decision worksheets with user-defined goals and dated milestones on the timeline. |
| Work evidence | Remove from the active product. Link to relevant Notion material when needed. |
| Projects | Retire the separate project planner and case-study editor. Represent an actual project deadline as a goal, with its existing repository or Notion link. |
| Career assets | Replace with Documents: a few Overleaf links. |
| Notes and Catch a thought | Remove editors, quick capture, related shortcuts, and note-creation entry points throughout the product. |
| Resources | Place useful learning links beside the corresponding learning material. Retire the general resource library and guidance cards. |
| Weekly review | Remove the questionnaire and commitments. Show actual progress in the timeline and Learn. |
| Connectors | Retire the separate integration-management destination. Configure the LeetCode identity in Learn/Settings and Overleaf links in Documents. Use direct Notion/GitHub links where relevant. |
| Global search and small-collection filters | Remove. Use direct navigation and a short, readable application list. |

**2. Simplify the shell and the language.** Keep the Work wordmark, existing typography, off-white canvas, dark outlines, block shadows, and blue/pink/lime/orange/aqua palette. Simplification should change information density and visual hierarchy, while retaining the character of the design.

Replace the sidebar's workspace card with a compact account control showing the actual signed-in name/avatar. Clicking it opens Settings and Sign out. Show the email inside that menu if it helps identify the account. Use the same menu on mobile. Remove group headings such as GET READY and BUILD YOUR STORY, the workspace breadcrumb, the brand tagline, global search, capture controls, and action-count badges.

Use direct page titles: Home, Learn, Applications, Documents. Remove slogans, motivational banners, decorative status copy, filler descriptions, and playful success messages. This includes “Understand it. Build it. Explain it.”, “Your work, kept safe”, and their equivalents elsewhere. Secondary text remains only when it provides useful information: a date, meeting time, progress count, source, or an actual error.

Successful saving can remain quiet. Display pending changes, failed saves, or stale source data where they affect the current task. Preserve the existing recovery behaviour behind these states. Empty pages should have one relevant action, such as Add goal or Add application, without a multi-step workspace setup or seeded career advice.

**3. Make Home a useful timeline.** Home should open with a compact title/date and one main timeline. Include a small Add control with Goal, Milestone, or Interview choices; interview creation links the event to its application. Keep the two document shortcuts easy to reach without a large additional panel.

Avoid a second dashboard of counters, an activity feed, or another task list. Learning progress appears inside the goals it measures. Detailed study information stays in Learn, and application details stay in Applications. Replace the current hardcoded career timeline and February 2027 banner with your actual dated records; do not seed goals or deadlines on your behalf.

The timeline combines three meanings:

| Timeline element | What it represents | Where it comes from |
| --- | --- | --- |
| Dated point | Interview, application deadline, explicit follow-up, or milestone | The related application/event or goal |
| Goal span | A goal with a target date and, optionally, a start date | A goal you create |
| Progress checkpoint | A measurable change or completed milestone towards that goal | Existing learning data or a brief explicit update |

Use a clear Today marker, readable dates, and a small number of visual lanes on desktop. Give interview points, goal spans, and completed milestones distinct shapes as well as colours. Use the existing outlined cards and shadows for event details. Keep animation subtle: opening a detail, updating a progress mark, or completing a milestone. Respect reduced motion.

Show the near-term period first, approximately six weeks, and let earlier/later navigation reveal more. Longer-term active goals should retain a compact target/progress label even when their deadline is beyond that window. Expanding the timeline exposes more history and future dates through the same interface. On mobile, use a vertical chronology so events remain readable and tapping a point opens its details.

Keep overlapping events readable through stacking/grouping, with exact times in their details. Rescheduling updates the original interview; cancelling removes it from upcoming events without destroying its history. Completed goals and historical checkpoints remain available when navigating backwards. Goals without dates appear in a compact undated group rather than being assigned invented dates.

Clicking a timeline point opens its source details. Editing an interview there updates the same application interview record; editing its application updates the timeline. Application deadlines and follow-ups are derived from their records rather than copied into independently editable events. Use stable source IDs to avoid duplicate entries after refresh or synchronisation.

Create a dated goal with a title and target date, with nothing else required; allow an undated goal when intentional. Optional details are a source link, start date, and progress measure. A numeric goal can contain a unit, baseline, target, and linked source. A milestone goal can contain a few named milestones with dates. A simple goal can just be marked complete. Keep milestone editors inside the goal details.

Progress must measure the goal itself. For example, a goal to complete a particular problem collection counts confirmed distinct problems in that collection. A course goal counts its existing completed tasks. A project goal counts milestones you selected. Time spent in Pomodoro does not automatically imply learning progress. GitHub commits do not automatically imply a project is complete.

Distinguish the target date from actual progress. The passage of time must not fill a completion bar. Preserve numeric checkpoints when available so the timeline can show change over time, rather than only today's percentage. Show a source's last update and partial-history limitations in its details. These are factual displays, with no automatic priorities, suggested goals, or generated tasks.

**4. Reuse the existing Learn system.** The relevant source is in `../Personal-website`, particularly `src/components/learn`, `src/data`, `src/hooks`, and `src/lib/leetcodeMetrics.ts`. The current personal-site experience already includes week cards, fullscreen slides, homework, a roadmap with problem popovers, and accumulated solve history. Work currently has a separate learning-evidence interface and a large manual practice-attempt interface; those should be replaced.

Reuse the interaction foundations of `WeekBoard`, `WeekCard`, `SlideDeck`, `HomeworkList`, `Roadmap`, and `DifficultyBadge`, adapting their presentation to Work's existing CSS and components. Preserve the same curriculum structure, stable task IDs, and LeetCode problem slugs. Keep learning and solving in one flow: select a week/topic, open slides or homework, open the problem on LeetCode, and see known completion reflected on return.

The personal site is Next.js with Tailwind and KV-backed routes; Work is Vite/React with a Worker and D1. Reuse the components and pure models/logic with small adapters for styling and data access. Avoid importing the entire Next application, putting the public page in an iframe, or rewriting the learning experience from its descriptions.

Keep one content-authoring source. The sibling source currently exposes public curriculum reads through `GET /api/admin/content`; its writes require an admin session. Read the authored content through Work's Worker, validate it, and cache a last successful copy. Confirm the deployed route during implementation. Do not treat static curriculum defaults as the complete authored slide content.

Reuse the existing public LeetCode statistics endpoint and accumulated history rather than maintaining a second polling/solve-history system. Configure the handle once and pass the resulting statistics to all Learn views and timeline metrics. Homework and roadmap completion must use the same solved-slug calculation.

Keep existing public learning-task completion shared through the personal site's progress API so checking a task does not require repeating it on two sites. Work maps the signed-in account to its configured LeetCode handle. The existing task API identifies users by handle, so keep its data limited to the same public curriculum checkboxes; private goals, interviews, and career details stay in Work's authenticated storage. Any later change to the personal site's identity model should be a separate decision.

Record source provenance for adapted code. Share the pure models/calculations and reusable components through a small versioned module when wiring both consumers; use framework-specific adapters around it. Avoid a broad monorepo conversion. Work's build must be self-contained in CI and deployment, without depending on the presence of an arbitrary sibling directory.

Preserve useful existing non-DSA learning content as lightweight read-only material where appropriate. Remove the general topic-creation CMS, required explanations/reflections, evidence-of-understanding forms, spaced-recall queues, manual attempt journals, and automatic practice-action creation. Existing curated material can be browsed freely without becoming a recommendation system. Keep the default page focused on the chosen curriculum, with the roadmap as a secondary view within Learn.

Do not promise complete historic solved-problem detection from a recent-submission feed. Reuse the accumulated history already available, preserve known solves, and avoid labelling unobserved problems as definitely unsolved. Aggregate account totals and confirmed curriculum completion are different measures.

**5. Put Pomodoro where it belongs.** Offer a compact timer in Learn's homework/problem context. It can remain a small dock while you browse Learn and work in a separate LeetCode tab. Show time remaining and Start, Pause, Reset controls; expose work/break duration editing only when requested.

Keep one running timer. Restore its state after reload and use timestamps so a background tab does not cause drift. Pause/resume and reset should behave predictably. A completion cue can be subtle, with sound optional. Remove the thinking-as-you-go textbox, action-selection card, session-reflection form, and standalone focus-session history. Timer use should never require a note, journal entry, or application record.

**6. Make Documents a small set of Overleaf destinations.** Start with Résumé and Cover letter cards. Each needs only an Overleaf project/document URL, an Open in Overleaf action, and an unobtrusive Edit link action. Allow a short label for a deliberately added variant, with no searchable asset library, tags, folders, or filters.

Remove résumé authoring, structured content editors, PDF uploads/previews, compilation assumptions, template generation, achievement-to-bullet tooling, profile checklists, and document-revision management from the active product. Do not require an Overleaf connector or access credentials for a saved link. Your Overleaf account handles opening its private projects.

Applications can use these default links or an explicit application-specific variant. Saving a URL records a destination; it does not preserve the exact contents of a mutable Overleaf document at submission time. Preserve previously stored submitted PDFs and immutable snapshots in legacy exports, while removing new upload requirements. Do not silently present a link as an exact submitted version.

**7. Consolidate applications and interviews.** Use a compact chronological/list presentation with company, role, stage, next scheduled date, and vacancy link. Use one default view; remove the board/list toggle, large summary cards, search bar, multiple filters, and role-fit/urgency scoring. Stage remains useful record information without becoming a separate filter system.

Creating an application initially asks for company, role, vacancy URL if available, and stage. Keep optional dates and links in its details. Use a small fixed stage set rather than a pipeline-customisation workflow. Preserve existing custom stages on older records rather than silently changing their meaning.

An application's details contain its interview appointments, meeting links, selected résumé/cover-letter links, and an optional relevant contact or Notion preparation link. Keep scheduling an interview brief: application, date/time, timezone, and optional meeting URL. Keep deadlines as date-only values and interviews as timed events with their timezone. Display both the local time and interviewer timezone when needed.

Remove separate company questionnaires, outreach drafts, story editors, mock-feedback rubrics, generic preparation checklists, and required job-description/requirements/compensation research forms. Existing longer application details remain available with legacy data, but do not become new required fields. An application and its interviews should be maintainable with a handful of edits, without duplicating Notion writing.

All explicit application dates appear automatically on Home's timeline. Creating an interview from the timeline opens the same small editor and attaches it to the selected application. Remove the separate in-app calendar surface; external meeting/calendar links can stay in event details. Interviews that are not attached to a job application, such as a mock appointment, can still appear on the timeline with an optional source link and no mandatory application.

**8. Reduce backend work as well as interface work.** Keep authentication, ownership checks, persistence, edit-conflict handling, pending-edit recovery, and exports. These foundations support the smaller product. Remove consumers and producers of suggestions, including `rankedActions`, `ConnectedDaily` suggestions, suggestion API routes, provider suggestion generation, and demo suggestions. Do not leave suggestion generation running behind a hidden interface.

Stop background Notion mirroring and other connector jobs that only feed retired collections. Keep direct links and the learning source adapter actually used by the new screens. Retain existing provider credentials and stored records during the transition without deleting them incidentally; disable unused jobs and expose existing connection removal through Settings where needed. Reconcile the in-progress connector changes deliberately rather than reverting unrelated local work.

Introduce a small typed goal/milestone/checkpoint model. The current `records` table has a database CHECK limiting its record kinds, so a TypeScript-only addition is insufficient. Prefer additive owner-scoped goal tables over rebuilding the existing record table and its links/revision triggers. Wire the new model into validation, backups/restores, demo fixtures, and the client data layer. Store relationships to applications or learning-source identifiers explicitly.

Add simple document-link fields for the new application flow while leaving existing `assetVersions` untouched. Validate all new URL fields explicitly, including résumé and cover-letter destinations. Derive timeline entries from source records in one place; avoid a second copy of every interview or deadline. Keep learning-content caching, goal checkpoints, and private record persistence as separate concerns.

**9. Preserve existing information during removal.** Export existing records, revisions, and files before migration. Inventory obsolete records and current pending device edits. Retirement removes features from everyday use; it does not require permanently deleting their information.

Move retired notes, evidence, reviews, practice journals, research worksheets, and asset content out of active queries, counters, navigation, and relationship selectors. Keep them available through Settings export/recovery rather than introducing another Archive destination. Preserve attachment ownership and submitted-application snapshots. Existing profile/document URLs can populate the new link cards when their meaning is clear.

Map learning history only through exact stable task IDs or problem slugs. Explanation/evidence checkboxes cannot automatically become equivalent homework completion. Map dated project milestones or career decisions into goals only where the intent and date are unambiguous; retain ambiguous material in the export. Produce a dry-run mapping report and make the migration repeatable without duplicate goals or events.

Handle old URLs intentionally. `/today` goes to Home, `/practice` goes to the corresponding Learn context where identifiable, `/focus` goes to Learn, `/assets` goes to Documents, and `/interviews` opens the related application/interview context. Retired record deep links should offer legacy export/recovery when no meaningful new destination exists. Remove misleading shortcuts and record-link routes across the whole application.

Keep old schema/data readable through the initial release so rollback remains possible. Update backup versions and restore logic for goals, document references, and archived records. Reconcile unsynced device edits before turning off obsolete write paths. Remove unused code and dependencies after migration behaviour is verified; production storage deletion is outside this simplification release.

**10. Deliver in reviewable stages.** Implement the changes on a branch, preserving the current uncommitted work. Do not deploy or migrate production as part of this planning task.

| Stage | Deliverables | Exit condition |
| --- | --- | --- |
| A. Product and migration design | Four-page map, desktop/mobile Home and Learn sketches, record inventory, source contract, migration mapping | Every current feature has a destination or retirement treatment; the homepage layout is sparse and understandable. |
| B. Shell and Documents | Four-item navigation, account menu, direct copy, Overleaf cards, removal of capture/search/promotional chrome | Opening a résumé and signing out require obvious controls, with no workspace setup. |
| C. Consolidated Learn | Existing week/slides/homework/roadmap foundations, shared content and progress adapter, contextual timer | The current personal learning flow works in Work's art style, with no duplicate journaling or completion entry. |
| D. Applications and timeline | Smaller application details, embedded interviews, goals/checkpoints, new Home and mobile chronology | An interview entered once appears in both places; a chosen goal shows real progress towards its target date. |
| E. Retirement and release verification | Repeatable migration, old-link handling, unused-job/code cleanup, fixtures/tests/docs, staging review | Existing information remains recoverable and the reduced product passes functional and visual acceptance. |

Update the README and connector documentation around the final product contract. Replace tests that require retired forms with tests of the new workflows; retain the ownership, authentication, persistence, and recovery coverage that still matters. The final release should be a coherent smaller product, rather than the old product with most cards collapsed.

**11. Use concrete acceptance criteria.** Review these on desktop and a narrow mobile screen with realistic but synthetic data:

- Exactly four primary navigation destinations, with Settings and Sign out in a working account menu.
- Home has a timeline as its main content and contains no recommendation card, motivational hero, energy selector, generic activity dashboard, capture form, or integration-setup nag.
- Interviews, application deadlines, goals, and their actual progress can be understood together. Edits update their source once, without duplicate events. Overlapping, cancelled, undated, completed, and longer-term items remain understandable.
- Goal progress comes from its defined measure. Elapsed time, recent-feed absence, and timer use do not produce invented completion or inferred mastery.
- Learn preserves the existing week cards, authored slides, homework, and roadmap behaviours. Public checklist progress is shared, and all learning views use the same known solve history. Source outages retain the last successful content/progress with an accurate state.
- Pomodoro starts without creating anything else, survives reload/backgrounding, and has no note or reflection fields.
- Résumé and cover letter open in Overleaf directly. New document use requires no upload, internal résumé editing, search, tags, or connector wizard.
- Applications can be created with minimal fields. Their interviews, dates, and document destinations are available without maintaining separate research or preparation databases.
- Topic tabs still scroll horizontally by touch, trackpad, and keyboard, with no visible scrollbar or reserved scrollbar gutter. Hide it only on that component using `scrollbar-width: none` and the WebKit scrollbar rule; remove excess bottom spacing while keeping shadows/focus rings visible. Active/focused tabs scroll into view.
- Account menus, timeline details, tabs, and slide controls work with keyboard focus and touch. Text and shapes convey status alongside colour, and reduced-motion preferences work.
- Export/restore retains legacy records and files alongside new goals; migrations are repeatable; unsynced edits and old links receive a useful recovery path.
- Suggestion producers, retired collection syncs, and generic capture shortcuts are absent from the running product, rather than merely visually hidden.

Use the existing check, unit-test, build, browser-test, and Worker-runtime commands as applicable. Focus domain tests on timeline ordering, deduplication, dates/timezones and daylight-saving transitions, metric correctness, and migration safety. Browser checks should cover the complete Learn-to-LeetCode flow, timer persistence, application-to-timeline editing, Overleaf links, account sign-out, responsive layouts, and hidden-scrollbar usability. Verify the deployed personal-site read endpoints during source integration, and verify the reduced product in staging before a separate production rollout.

The result should be a career tool you can keep current through normal use: learn through your established system, maintain a few applications and dates, define the goals you actually want, and open the documents you already write elsewhere.
