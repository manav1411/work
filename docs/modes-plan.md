# Career modes and Australian public service plan

Planning document, 14 October 2026. This proposes implementation; it does not change the app.

## 1. Product decision

Introduce two career modes: **Software engineering** and **Australian public service**. Each mode combines a page configuration with an independent workspace belonging to the signed-in account. Switching modes restores that mode's applications, documents, interview preparation, stories, goals, notes and settings.

The public service mode focuses on APS jobs, with support for suitable ACT Government roles. APS and ACT recruitment requirements remain distinct within that mode. This avoids creating another mode just to consider a different public sector employer.

The public service mode should work for other applicants. Your dad's salary, preferences, experience and relocation date belong in his workspace profile, rather than in defaults shipped to every user.

### Confirmed requirements and assumptions

| Item | Decision |
| --- | --- |
| Access | Keep current authentication. You will help by logging into his account. |
| Data sharing | Career content is independent between modes. |
| Primary market | APS; suitable ACT Government roles are also supported. |
| Target location and availability | Canberra, January 2028. Sydney is an optional interim pathway. |
| Compensation | AUD 85,000 minimum base salary, with AUD 90,000 as a preferred target, excluding super. Editable preferences. |
| Level | APS5 as the main search; selected APS6 roles where his evidence and lifestyle preferences fit. |
| Working pattern | Full time, predictable weekday hours, desk duties. |
| Duties to avoid | Physical care, regular client phone queues, frequent unpredictable demands. |
| Security | Prefer ongoing APS employment or permanent ACT employment. This is an assumption based on the security goal; temporary work remains a separately marked option. |
| Preparation capacity | A few hours each week from him; additional research, organisation and editing from you. |

Full time describes hours. Ongoing/permanent describes employment tenure. Store and display these separately.

## 2. Switching modes

### User experience

Add a labelled **Career mode** selector to the desktop navigation and mobile menu. Keep the active mode visible beside it. First use of a second mode opens a short setup form, followed by its own Home page. Later switches return to that mode's last valid page.

Setup collects candidate name, target location, availability, classifications, salary preferences, hours, tenure preference and duties to avoid. It can be skipped and completed in Settings. Dad-specific information is entered explicitly into his account; the application ships general templates.

An empty public service workspace provides a small set of preparation goals and blank story prompts. It contains no fictional applications, completed achievements or invented work experience. Initialisation runs once per workspace, including under concurrent tabs.

### Switching rules

1. Capture current editor changes into storage belonging to the source workspace.
2. Flush normal autosaves where possible. If a save is pending, retain its source workspace and show its save state.
3. Resolve operations that cannot safely continue in the background, such as a workspace replacement, before allowing a switch.
4. Load the destination workspace and render it atomically. Never show source content underneath destination labels while loading.
5. Restore the destination's navigation state and defaults.

A network interruption must not discard edits. Pending edits can remain stored in their original workspace when the editor supports this. If an editor cannot durably retain its changes, switching stays blocked with a concrete save/retry message until that is resolved.

Switching is a view and workspace selection operation. It never deletes, transfers or rewrites the other mode's content. Ordinary section hiding within a mode remains separate from mode switching.

### URLs and multiple tabs

Use mode-qualified browser routes, for example `/m/software-engineering/applications` and `/m/australian-public-service/applications`. The URL determines the current tab's mode. This lets two tabs use different modes without changing each other's context.

Remember a preferred mode for a fresh visit. Updating that preference must not force existing tabs to switch. Back/forward navigation restores the mode represented by the URL.

Existing links containing record IDs resolve to the migrated software workspace. A generic Home entry can resolve to the preferred mode. Opening an unavailable page, such as Learn in the public service mode, redirects to that mode's Home with a brief explanation. A link to a record from another workspace cannot silently open or edit it under the current mode.

## 3. Page configuration

Keep familiar navigation and reuse the existing editing, document and timeline components. Configure page availability and provide different components where the work differs.

| Page | Software engineering | Australian public service |
| --- | --- | --- |
| Home | Existing timeline and career actions | Next preparation actions, application deadlines, interviews, pool follow-ups and relocation milestone |
| Learn | Current coding roadmap and learning content | Hidden initially; practical preparation appears in Goals and application/interview preparation |
| Applications | Company radar and applications | Agency radar, role suitability, application preparation and merit pools |
| Interviews | Existing software interview preparation and STAR stories | Evidence stories, panel preparation, written exercises and role-specific rehearsal |
| Documents | Existing résumé and cover-letter families | Résumé, pitch, criteria responses, job packs and supporting documents |
| Goals | Existing direction and learning measures | Target role, preparation milestones, practical skills and application actions |
| Settings | Shared account settings and software preferences | Shared account settings and public service search preferences |

### Home

Keep the timeline, with a compact **Next actions** list above it. It should answer what he can do in his next preparation session: finish one story, practise a written response, review a shortlisted role, or prepare for an interview.

Show at most three suggested actions by default. Use recorded deadlines and explicit preparation tasks, with straightforward ordering; an AI briefing service is unnecessary for this feature. Include pool expiry or follow-up dates when known. Label January 2028 as a target availability milestone, without inventing a precise start day.

Hidden software learning must also stop driving Home requests and metrics. The current Home page calls `useLearningData()` even though its main feature is a timeline.

### Applications: agency radar and role suitability

Reuse the existing radar layout, labelling its entries **Agencies** in this mode. Initially save links and enter roles manually. Suitable places to monitor include DSS, NDIA, the NDIS Quality and Safeguards Commission, and ACT Government administrative teams. These are research targets based on his background, rather than promises of suitable vacancies.

For each role, record:

- Jurisdiction, agency, team, role title, classification and vacancy reference.
- Location, realistic start availability and any relocation discussion.
- Advertised annual base salary range, super separately, and source URL/check date.
- Full/part time hours and ongoing/non-ongoing/permanent/temporary tenure.
- Closing date, exact closing time and timezone when published. A date alone must be labelled as incomplete rather than interpreted as midnight.
- Advertisement, candidate pack, contact officer and recruitment portal link.
- Qualifications, eligibility and clearance requirements specified in the pack.
- Work pattern, public contact, travel, physical duties, workload indicators and training provided.

Provide a small **Role fit** panel with `Suitable`, `Needs clarification` and `Unsuitable` judgements, supported by notes or a quoted advertisement fragment. Unknown contact volume or hours should remain unknown. Do not infer low stress from agency name or APS classification.

For your dad, the initial screening questions are:

1. Are there any hands-on care, field or routine travel duties?
2. How much participant/client phone contact is expected?
3. Are there call queues, daily throughput targets, urgent escalations or frequent overtime?
4. Is the work mostly established program administration, or a rapidly changing initiative?
5. Are January 2028 availability and the advertised location compatible?
6. Does the actual available salary meet his preference?

Full time ongoing Canberra roles with established processes should be easy to filter. Sydney roles are labelled **Interim option**. Temporary roles show their tenure clearly. Do not assume a Sydney appointment can transfer to Canberra; record any confirmation obtained from the agency.

### Applications: preparation workspace

Add a role-specific preparation panel alongside the existing recruitment process:

- Capture the exact instructions from the candidate pack: CV, pitch, separate questions or selection criteria, required files, and word/page limits.
- Map each requirement to one or more evidence stories.
- Identify evidence gaps explicitly.
- Draft the pitch or individual responses in the existing rich editor.
- Link the tailored résumé and response documents to the application.
- Show word counts, editable limits and a concise submission checklist.
- Record submission date, portal receipt/reference and the documents used.

Use the actual pack's instructions; there is no universal 500-word APS pitch. The APSC describes both pitches and separate criteria responses and advises applicants to follow the advertised requirements. [APSC application guidance](https://www.apsc.gov.au/working-aps/joining-aps/cracking-code/3-applying-aps-job-cracking-code).

Preserve the current record-version and independent-document-copy model. When submission material needs to remain identifiable, retain an explicitly named independent copy of the submitted documents. Do not introduce a general revision archive as part of modes.

### Applications: recruitment outcomes and pools

The existing process supports ordered submission, assessment, interview and offer steps. Reuse that model, adding configurable assessment, referee and pre-employment stages as appropriate. Do not presume every agency uses the same sequence.

Pool membership is a separate suitability result attached to the application. Record suitability outcome, pool name/reference, jurisdiction, classification, advertised date, notification date, confirmed expiry, sharing preference where applicable, and next follow-up. Show an active pool without counting it as an offer or placement.

APS merit lists/pools may be used for similar vacancies within 18 months of the original advertisement, and can sometimes be shared between agencies. An ACT order of merit has different rules: the ACT recruitment guidance describes use within 12 months of advertisement for roles with the same duties, level and employment type. Store jurisdiction-specific rules and agency-confirmed dates. [APSC assessment and merit guidance](https://www.apsc.gov.au/working-aps/joining-aps/cracking-code/7-interview-and-other-assessment-cracking-code), [ACT selection processes](https://www.jobs.act.gov.au/how-we-hire/selection-processes).

Suggested expiry is displayed only when the original advertised date is known, identified as calculated, and overridden by the agency's notification. Expiry removes the pool from active follow-ups; it does not rewrite the original assessment outcome. Additional opportunities arising from a pool can be linked as separate applications.

### Interviews

Default public service preparation sections:

- **Evidence stories:** reuse the existing STAR bank.
- **Panel practice:** concise examples, role motivation and follow-up questions.
- **Written exercises:** short briefs, assessment summaries and professional correspondence.
- **Role preparation:** agency purpose, relevant procedures and questions for the team.

Retain custom tabs within each mode. The current interview helper automatically creates Behavioural and Technical defaults. Replace that assumption with mode-specific defaults. Keep the story bank's protected behavior, using a mode-neutral internal identity; hiding or removing another tab must not remove stories.

For stories, add evidence date/employer, capability tags, examples of personal judgement, verified results and verification notes. Do not create fabricated metrics. Older management experience can support a story, while recent examples should demonstrate that his skills are current.

### Documents

Add public service document families for **Pitch / statement of claims**, **Selection criteria responses**, **Job pack** and **Supporting documents**. Link documents to applications and preserve the existing independent copies and file handling.

Use simple editable text for drafting and allow uploaded DOCX/PDF files. Preserve the existing PDF/LaTeX system for users who choose it; your dad's ordinary drafting flow should not require editing LaTeX. Generating and editing native DOCX files would be a later document feature.

Replace hardcoded candidate names in download filenames and templates with candidate details from the workspace profile. `shared/documents.ts` currently produces `Manav_Dodia_Resume.pdf` and `Manav_Dodia_Cover_Letter.pdf`. Audit templates and demo material for similar assumptions.

Keep employer/client information anonymised in stories and practice exercises. The plan and generic starter content need no private client records or family financial details.

### Goals and Settings

Use the existing goals/actions system for explicit completion tasks and milestones. Examples: update résumé, verify qualification evidence, prepare six usable stories, complete two written exercises, practise a panel interview, and shortlist suitable agencies.

Hide LeetCode/NeetCode measure choices in this mode and reject new public service actions using software-only measures. Existing software goals retain their measures in their own workspace. Avoid equating the passage of a target date with completion of preparation: the current event progress helper treats a passed event as complete, so actual completed work needs explicit completion actions.

Account settings include authentication identity, theme and timezone. Mode settings include candidate/search profile, LeetCode handle where relevant, section configuration and starter initialisation. Showing your name in an account control must not cause documents in your dad's account or workspace to use your candidate identity.

## 4. Recommended architecture

### Define career mode independently of storage mode

The app already uses `WorkspaceMode` for `cloud | local | demo` and also has an edit mode. Introduce `CareerModeId` without reusing those names or meanings.

Define a registry in `shared/career-modes.ts`, with stable IDs `software-engineering` and `australian-public-service`. Each definition specifies label, available pages, default interview tabs, document families, goal measures, terminology and starter template version. Keep rendered components in the frontend; shared code holds serialisable configuration and contracts.

Read capabilities from this definition rather than scattering mode checks across unrelated components. Add dedicated public service panels where behavior differs, while sharing the application list, editors, file viewer, timeline and goal components.

### Make each mode a workspace owned by the account

Create `career_workspaces` with an ID, owner ID, career mode, mode preferences/profile, initialisation marker, epoch and generation. Enforce one workspace per owner and career mode initially. Existing records and actions gain a workspace ID.

| Data | Scope |
| --- | --- |
| User identity, authentication, theme and timezone | Account |
| Candidate profile, search preferences, initialisation | Career workspace |
| Records, notes, tabs, stories, applications, documents | Career workspace |
| Goal/action rows, including actions associated with multiple goals | Career workspace |
| Attachments and compiler work | Owning record's career workspace |
| Search, related-record queries, reordering and deletion cascades | Career workspace |
| Drafts, retries, editor state and query caches | Account + career workspace |
| Replacement epoch, generation and upload staging | Career workspace |
| Idempotency | Account + career workspace + request key |

Retain globally unique record IDs. Validate both ownership and workspace membership. Cross-workspace references are rejected for links, story selections, applications, appointments, files, document copies and multi-goal actions. Add appropriate scoped indexes and database constraints where practical; JSON references also need transactional validation.

### Explicit API context

Use workspace-qualified routes such as `/api/workspaces/:workspaceId/records`, with equivalent scoped endpoints for search, goals, files, learning, LaTeX and transfers. Keep account preferences and account deletion in explicit account endpoints.

Resolve account identity from the session. Verify the requested workspace belongs to that account. Creation stamps the resolved workspace; callers cannot change a record's workspace through a patch. Fetching a record or file under the wrong workspace fails without returning its contents. File URLs also carry workspace context, since ordinary download/image requests cannot rely on a mutable client header.

Pass an immutable workspace client to each operation, containing workspace ID and its epoch. Do not let an operation choose its workspace from whichever mode happens to be active after an `await`. The current API helper keeps one global epoch; it needs explicit per-workspace context.

Background uploads and compiler jobs retain their original record/workspace. Completion can update their original data without displaying it in another mode. Late network responses cannot populate the current mode's records or overwrite a different account's state.

### Extend strict contracts deliberately

Application, story, content, document and goal schemas are strict. New data cannot be added arbitrarily to `data` objects.

Add a typed public service application extension for jurisdiction, classification, salary, tenure, role fit, submission requirements and pool outcome. Extend document types and application references, story evidence metadata and mode-specific preparation tabs/scopes. Update shared references, Worker validation, deletion/detachment and transfer validation together. UI labels such as Agency can reuse the internal company record kind initially.

Prefer a separate pool extension rather than replacing the shared application status machine. Keep pool suitability, current recruitment stage and appointment schedule distinct.

### Client storage and caches

Scope keys by owner and workspace for record outboxes, action queues, editor drafts, settings drafts, document sources, navigation state and demo sessions. Capture scope when work is scheduled. Query cache keys include workspace identity.

Refactor epoch handling to clear only the replaced workspace's obsolete drafts/cache. `clearWorkspaceDeviceStorage()` currently clears broad `work*` keys; a replacement in APS must not discard software drafts.

For migration of existing device edits, assign owner-identifiable legacy entries to the software workspace. Entries lacking a safe owner mapping must be retained for explicit recovery rather than reassigned to a different logged-in account. Do not use a global storage-schema reset to discard pending work.

Each mode's demo uses separate data and the same capability configuration. Demo/local/cloud remains an independent axis from career mode.

## 5. Migration, backups and deletion

Use a new additive migration. Do not repeat the testing reset in migration `0009`.

1. Create a software career workspace for each existing owner.
2. Assign existing records, links, files, actions, learning cache and workspace state to it, preserving IDs, data, timestamps and versions.
3. Move the LeetCode preference into software preferences; retain account theme/timezone/display settings.
4. Preserve existing replacement protection and initialise the new context carefully for older open clients.
5. Leave the public service workspace empty until first enabled; initialise it atomically.
6. Verify record/file/action counts and relationship integrity before enabling the new UI.

Deploy server compatibility and migration before the new client becomes available, or use a short coordinated maintenance window. Older clients must not silently default unscoped writes into APS. Allow any temporary compatibility routes only for the software workspace, with explicit retirement after rollout.

Existing Settings exports and uploads operate on the owner's entire current workspace. The recommended new default is **Export this mode** and **Replace this mode from backup**, with the mode named in the action and confirmation. Other modes are unaffected. Export each enabled mode for a complete account backup. A combined account archive can follow later.

Introduce a versioned manifest containing career mode, mode profile/preferences and its closed record/file/action graph. Remap IDs inside the target workspace and reject cross-mode replacement. Ordinary mode restore must not replace account identity or shared account preferences. Use per-workspace staging, epoch and generation so replacing APS does not invalidate software drafts.

Recommended compatibility decision: support the currently published v1 package through one narrowly defined conversion to a software workspace package, including current global preferences split into their new scopes. This preserves existing backups. It is an intentional change to the repository's current-format-only policy, not a general historical-format reader. If that policy is retained strictly, provide an explicit pre-release conversion tool and migration instructions instead; settle this before implementation of transfers.

Switching or hiding is never deletion. Record deletion keeps the current permanent behavior within its workspace. Account deletion remains explicitly account-wide. Deleting/resetting an entire mode is unnecessary for the first release.

## 6. Tailoring the pathway for your dad

### Positioning and level

His résumé includes a Master of Social Work, EveryMan case management, SHIP and SCOUT record keeping, stakeholder coordination, acting management, staff supervision, rosters and earlier program/project administration. That is useful evidence to investigate for administrative and assessment roles. It does not by itself establish competitiveness for every APS5/6 vacancy.

APS5 involves independent organisation and judgement on moderately complex to complex work. APS6 generally expects more complex advice and autonomy, and may include management or sensitive public contact. Classifications describe work value, rather than age or graduate status. APS5 is therefore a reasonable primary target; APS6 should depend on demonstrated evidence and the specific duties. [APSC work level standards](https://www.apsc.gov.au/working-aps/aps-employees-and-managers/work-level-standards-aps-level-and-executive-level-classifications).

His experience may be valuable even where a graduate also enters APS5. The application needs to show how his judgement, documentation and coordination meet that job's requirements. It should not depend on total years worked alone.

For a salary example, DSS's agreement lists APS5 base rates of $92,885–$99,194 and APS6 rates of $101,738–$114,355 from 12 March 2026. These are one agency's published rates, not a universal APS scale or a forecast of January 2028 pay. Record the advertised salary and available entry point for each vacancy. [DSS enterprise agreement, Attachment A](https://www.dss.gov.au/system/files/resources/dss-enterprise-agreement-2024-2027_0.pdf).

### Prioritise role families by duties

The following priorities are an assessment of fit from his résumé and your preferences, not assertions that these titles guarantee a particular working environment.

| Priority | Role family to investigate | What needs checking |
| --- | --- | --- |
| Primary | Program administration, program support, internal operational support | Judgement required, reporting skills, workload and whether contact is mostly internal |
| Primary | Assessment support, quality/document review, established administrative decisions | Calls, daily targets, complex cases and delegated decision authority |
| Secondary | Grants/program administration | Financial processing, reconciliation and relevant systems skills |
| Selective | Desk-based compliance or registration support | Investigation duties, provider conflict, technical/legal requirements and external contact |
| Selective | Policy/program support in a familiar social services area | Writing quality, analysis, deadlines and change frequency |
| Selective | Small-team coordination or supervision | Recent evidence, responsibility and fit with his desired workload |

Participant-facing planning, complaints handling, frontline service delivery and field investigations deserve particular scrutiny given his preferences. Policy can involve urgent briefs and changing priorities; compliance can involve disputes and demanding evidence analysis. A desk job can still be stressful. Ask about the actual team, work allocation and day-to-day tasks before treating it as a good fit.

### Evidence to develop

Build six to eight factual stories over several weeks, prioritising:

- Assessing information and producing a supported recommendation.
- Applying procedures while exercising judgement and escalating appropriately.
- Maintaining accurate records and confidentiality.
- Coordinating professionals or agencies to achieve an outcome.
- Managing priorities and deadlines.
- Resolving a problem or improving an administrative process.
- Supervising/coaching staff, if a concrete example can be verified.
- Explaining information clearly to people with different needs.

Use his own actions and a verifiable outcome. Ask for approximate scope only when he remembers it accurately. Recent Aruma examples may show reliability and judgement; earlier case-management and acting-manager examples may better demonstrate scope and independence.

The résumé has repeated material and old expiry dates. Preparation should confirm current employment dates, actual administrative responsibilities, acting-manager duration/team size, current qualification recognition or AASW membership where relevant, and available referees. Do not treat résumé wording about membership as verified statutory registration. Update only requirements relevant to the vacancies being pursued.

### Practical skills and support

He already has substantial formal education. Start with practical exercises rather than another broad qualification: a short assessment summary from fictional material, an Excel tracking/filtering task, a clear email explaining a decision, and a concise recommendation brief.

The results will show whether he needs help with writing structure, spreadsheets or ordinary office workflows. Choose a short course only if repeated candidate packs or exercises identify a specific gap. Check eligibility and prerequisites before recommending any training; some public service learning is intended for existing employees.

You can research roles, maintain the shortlist, extract pack requirements, organise story prompts and edit for clarity. He needs to choose the work he would accept, confirm facts, understand his submitted material and practise explaining it without you. Applications should retain his voice and comply with any agency instructions concerning assistance or AI use.

## 7. Schedule to January 2028

January 2028 is roughly fifteen months from this plan's date. Use that runway for preparation and evidence, then time active recruitment to realistic availability. A merit pool may help bridge timing; it cannot guarantee a later appointment.

| Period | Dad's work | Your support and app outputs |
| --- | --- | --- |
| Oct–Dec 2026 | Confirm preferences, recount examples, attempt practical exercises | Update résumé facts, screen representative candidate packs, set up profile and first stories |
| Jan–Mar 2027 | Refine evidence and practise concise writing | Identify repeat requirements; produce résumé variants and initial role-specific practice applications |
| Apr–Jun 2027 | Rehearse panels and consider appropriate opportunities | Apply selectively where availability or pool use is plausible; confirm timing with contact officers |
| Jul–Sep 2027 | Continue a manageable number of suitable applications and interviews | Track outcomes, improve weak evidence, maintain pool records and shortlist Canberra roles |
| Oct–Dec 2027 | Pursue roles compatible with relocation and assess offers | Confirm duties, tenure, salary, start dates, pre-employment requirements and relocation logistics |
| Jan 2028 onward | Start a suitable role or continue the established search | Support onboarding or continued applications; maintain a fallback plan if recruitment takes longer |

These are preparation and activity milestones, not predicted recruitment durations. Apply earlier only when he could realistically accept the role or when the agency confirms a compatible recruitment arrangement. For practice without a feasible start date, use saved/closed packs and mock interviews.

Suggested weekly rhythm: 45–60 minutes recalling or refining a story, 30 minutes on a practical writing/systems task, and 30–45 minutes on a role review or interview rehearsal. During a live application, substitute that work for an exercise. You can do vacancy research and editing separately. Start with one or two well-matched applications per month during active periods and adjust using outcomes and his energy.

Review after four to six relevant applications: lack of shortlisting suggests revisiting job fit and written evidence; interviews without suitable outcomes suggest rehearsing examples and probing questions; offers for undesirable duties suggest tightening screening. Keep feedback as notes rather than inventing an automated readiness score.

## 8. Implementation sequence

| Stage | Deliverable | Dependency and completion condition |
| --- | --- | --- |
| 1. Contracts and migration design | Mode registry, workspace scope, preference split, transfer policy | Every data path has a defined scope; existing data migration is additive |
| 2. Data isolation | Scoped persistence, APIs, links, files, search, actions, transfers and compiler context | Server enforces ownership and same-workspace relationships across all operations |
| 3. Client switching | Selector, mode routes, durable drafts, scoped queues/caches and initialisation | Switching and late responses preserve original scope; both modes can work in different tabs |
| 4. Mode-specific shell | Navigation, defaults, interview tabs, goals and settings | APS has no coding defaults or background LeetCode requests; existing software behavior is preserved |
| 5. APS workflow | Profile, role screening, submission preparation, evidence, document families and pools | A real candidate pack can be prepared and tracked from saved role through outcome |
| 6. Tailored setup and release | Enter your dad's verified facts, preparation goals and reusable evidence prompts | Review against representative jobs; complete migration and backup checks before release |

Stages 1–4 establish modes. Stage 5 makes the second mode useful. Stage 6 personalises his account. Ship the APS mode once isolation and the essential application workflow are complete; navigation hiding alone is insufficient for his use case.

The largest effort is data isolation and safe switching because the current app assumes one owner workspace. The largest uncertainty in the APS workflow is how far document authoring should extend beyond existing rich text and uploads. Keep native DOCX generation outside the first release. Estimate implementation effort after the scoped migration/API inventory; a precise day count now would hide substantial unknowns.

### Likely files and areas

- New `shared/career-modes.ts`; extend `shared/model.ts`, application/content/document contracts, references and transfer manifest.
- New additive D1 migration and workspace resolver; scoped changes in `worker/index.ts`, records, goals, files, deletion, learning, LaTeX, idempotency, transfer and epoch handling.
- `src/lib/workspace.tsx`, API client, goals, autosave, device storage/drafts, outbox, pending sources and workspace transfers.
- `src/app/App.tsx` for navigation/routes; Settings for shared versus mode preferences.
- Home timeline/action list; Applications screening/preparation/pool panels; Interviews defaults and story metadata; Documents families/filenames; Goals measures/defaults.
- Starter/templates/demo content and later targeted verification coverage.

There are existing unrelated edits in the workspace. Implementation should preserve those and reconcile overlapping app/settings/model work carefully. This planning task adds only this document.

## 9. Acceptance criteria and future verification

No application tests or builds were run for this planning task. Implementation should be verified against these behaviors:

1. Switching away and back restores records, files, stories, goals, custom tabs and preferences without duplication or lost edits.
2. Existing software records retain IDs, contents and relationships through migration.
3. The wrong workspace cannot fetch, alter, link, reorder, copy, download or delete another workspace's content; another account remains blocked as well.
4. A queued save, upload or compiler result started in one mode cannot appear in another, including during sign-out/account changes.
5. Two tabs can operate in different modes; back/forward navigation selects the correct workspace.
6. An interrupted switch or unavailable network retains source edits. A failed destination load leaves a clear retry path.
7. APS hides Learn and software-only interview/goal defaults, and issues no LeetCode statistics requests.
8. Initialisation is idempotent and does not overwrite edited starter material.
9. Deadlines retain exact times/timezones where known; word/page limits come from the role pack.
10. Pool suitability never marks an offer, expiry uses the correct jurisdiction/advertised date, and confirmed expiry overrides a calculated suggestion.
11. Mode backup replacement affects only that mode and invalidates only its obsolete local work; relationships and files survive ID remapping.
12. Candidate filenames, templates and starter content contain the correct identity and no software-specific assumptions in APS.
13. Passed preparation target dates do not claim unfinished tasks are complete.
14. Desktop/mobile selectors are keyboard accessible and announce loading, save issues and active mode clearly.

Use focused migration/backend checks for isolation and relationships, plus end-to-end cases for switching with unsaved edits, two tabs, files, and mode restore. Validate APS workflows with representative APS and ACT candidate packs. These are checks for the future implementation, not work performed in this planning turn.

## 10. Boundaries and remaining facts

The first release includes the two fixed modes, independent data, mode-specific pages, manual job entry, APS/ACT application preparation, evidence stories and pool tracking. Authentication replacement, automated job scraping, AI drafting/briefings, shared account collaboration, automatic application submission, native DOCX authoring and employment-tool integrations are separate features.

The plan can proceed without further questions. Before creating his live materials, confirm acting-manager dates/team size, recent administrative examples, referee availability, current qualification documentation and whether full time temporary employment is acceptable. Treat ongoing/permanent as the default preference until he says otherwise.

The immediate practical deliverable for your dad is a verified résumé plus a small evidence bank and a strict role-fit checklist. Those will improve the usefulness of the tailored mode as soon as it is available.
