# JEV applications for Work

Researched 7 October 2026. Recommendations based on the current repository and TypeSafe's official documentation. These are proposed features, not implemented integrations. No API credits were spent during this research.

**My recommendation: start with a role evidence map, then an adaptive interview rehearsal flow.** Together, they would make Work answer two valuable questions: “What can I credibly show for this opportunity?” and “What should I practise next?” Add opportunity discovery on the Pi once those decisions are useful. The $5 balance is ample for experimenting; collecting useful evidence and evaluating the judgments will be the harder parts.

## What Work is trying to do

Work is a private career workspace connecting six activities:

| Area           | What exists today                                                                                              | Opportunity for JEV                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Home           | A timeline of appointments, application deadlines, follow-ups, goals and milestones                            | Turn upcoming events into a small, useful preparation queue                 |
| Learn          | A 150-problem DSA roadmap, public LeetCode statistics, Pomodoro, eight default learning tracks and custom tabs | Select practice that addresses a specific opportunity or observed mistake   |
| Applications   | Saved roles, ordered recruitment processes, appointments and a company Radar                                   | Judge relevance, interpret incoming updates and connect preparation         |
| Interviews     | Behavioural/technical/custom tabs, appointment preparation and STAR stories                                    | Find suitable stories, expose weak evidence and choose follow-up questions  |
| Documents      | Private files, profile links, editable LaTeX resumes/letters and independent document copies                   | Audit the actual rendered text and select existing evidence for a role      |
| Your Direction | Paths, experiences and decisions, plus goals linked to directions                                              | Make tradeoffs explicit and identify questions that would change a decision |

This reads as a system for moving from career intention to prepared action. Its existing content is unusually well suited to decision models: stories have Situation/Task/Action/Result/Lessons fields; applications have explicit stages; notes have scopes; goals have dates and measures; records have stable IDs and relationships.

The infrastructure is React/Vite → authenticated Hono/Cloudflare Worker → owner-scoped D1 and private R2. A private Raspberry Pi compiles LaTeX through a protected tunnel. Importantly, `compiler/run-job.sh` already runs `pdftotext`, and `worker/latex.ts` stores the extracted text as a private attachment. Native resume analysis can reuse that output.

Work keeps current content, not revision history. It has version counters, device drafts and retry queues, but no historical application submissions, progress snapshots, trash or scheduled user backups. Recommendations below should preserve that approach. They must not imply that Work knows what was submitted months ago or how an answer improved across past sessions.

Code anchors: [project overview](../readme.md), [navigation](../src/app/App.tsx), [application contracts](../shared/applications.ts), [content and story contracts](../shared/content.ts), [goals](../shared/goals.ts), [existing prompts and rubrics](../src/content/templates.ts), [Pi compiler](../compiler/README.md). Demo companies, stories and directions are synthetic examples, not evidence of your actual career preferences.

## What JEV enables

JEV accepts supplied state and returns bounded decisions. **Choice** selects an option, **Score** evaluates a descriptive rubric, and **Noul** estimates whether a statement is true. Questions can share one request, but are evaluated independently: one question cannot consume another question's answer in the same call. Decompose a broad judgment, then combine the factors in code. [TypeSafe introduction](https://docs.typesafe.ai/introduction)

Current documented model: `jev-1.13.0`, also exposed through `jev-latest`. Input is text/JSON, not PDF bytes, images or audio. Limits are 64k total request tokens and 32k for state plus the longest question. Pin a version for evaluated behavior. [Models](https://docs.typesafe.ai/models)

Choice supports up to 255 options; Score uses 2–10 descriptive levels. HTTP requests go to `POST https://api.typesafe.ai/v1/systemone`, with bearer authentication and `{model, state, questions}`; responses contain `answers`, `model` and `usage`. [API reference](https://docs.typesafe.ai/api)

This makes three patterns especially useful for Work:

1. **Choose existing content.** Return story, paragraph, problem, question or record IDs; Work displays the original text.
2. **Turn meaning into inspectable signals.** Assess personal ownership, relevance, evidence strength or an explicitly stated requirement; Work decides what to do with those signals.
3. **Select the next question.** Choose a useful follow-up from an authored bank; the resulting interaction can feel adaptive without generating prose.

Typed output guarantees shape, not truth. Choice/Score confidence summarizes their probability distribution; Noul has no separate confidence field, and values near 0.5 signal uncertainty. Thresholds need evaluation on Work's actual tasks. [Confidence](https://docs.typesafe.ai/confidence)

TypeSafe documents weaknesses in arithmetic, date comparison, indirect reasoning, irrelevant long context, adversarial text and option-order sensitivity. Keep calculations in code, filter context and test reordered candidates. JEV does not provide open-ended writing. [Jev 1.13 limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13)

## Ranked shortlist

Effort is relative engineering scope, not a delivery estimate. “Small” means an explicit action over existing text; “medium” adds a workflow or new derived state; “large” introduces ingestion or substantial new UI.

| Rank | Application                                      | Why it belongs in Work                                         | Effort         | Pi needed?                             |
| ---- | ------------------------------------------------ | -------------------------------------------------------------- | -------------- | -------------------------------------- |
| 1    | Role evidence map                                | Connects Applications, STAR stories, Documents and preparation | Small → medium | No; reuse existing compiler text later |
| 2    | Adaptive interview rehearsal                     | Turns stored preparation into targeted practice                | Medium         | No                                     |
| 3    | “I have 25 minutes” action selector              | Connects the timeline to an achievable next action             | Medium         | No                                     |
| 4    | Resume evidence and readability audit            | Checks what the rendered document actually communicates        | Small → medium | Existing compiler sufficient           |
| 5    | Paste-to-Work capture                            | Removes repetitive categorization and linking                  | Medium         | No                                     |
| 6    | Opportunity Radar that finds relevant changes    | Lets the home server do useful background discovery            | Large          | Useful                                 |
| 7    | DSA transfer practice                            | Tests whether you can recognize a pattern without its label    | Medium         | No                                     |
| 8    | Direction stress test                            | Surfaces assumptions and missing decision evidence             | Medium         | No                                     |
| 9    | Interview debrief → current preparation          | Converts notes into specific suggested updates                 | Small → medium | No                                     |
| 10   | Semantic evidence search                         | Finds useful passages across the workspace                     | Medium         | No                                     |
| 11   | One project that closes several gaps             | Selects a portfolio experiment with broad career value         | Medium         | Useful for running projects            |
| 12   | Explain a technical tradeoff through Work itself | Uses your real app as interview material                       | Small → medium | Useful for real failure experiments    |

## 1. Role evidence map: the best first integration

**Interaction:** Open an application, paste its job description and choose “Find my evidence.” Work shows the requirements, relevant resume passages and STAR stories, plus a short list of preparation gaps.

An illustrative result might be:

| Requirement from the posting | Existing evidence                       | Useful interpretation                                 |
| ---------------------------- | --------------------------------------- | ----------------------------------------------------- |
| Own reliable services        | Story about handling duplicate requests | Relevant story; ownership needs a clearer explanation |
| Design APIs                  | Resume passage about a backend project  | Direct evidence available                             |
| Communicate tradeoffs        | Story describing a team decision        | Relevant, but the alternatives are not explained      |
| Kubernetes experience        | No matching supplied passage            | Missing evidence; ask whether this is essential       |

**Decision design:**

- Code splits the posting into candidate requirement clauses with IDs. JEV judges each clause's relevance and whether it is mandatory, preferred, a responsibility or unclear. Preserve the exact source text.
- For each selected requirement, ask separate Scores about each candidate story/passage: relevance and strength of demonstrated evidence. Use explicit levels such as “not addressed,” “mentioned without an example,” and “specific action and supported outcome.”
- Work calculates coverage and ranks candidates. For important matches, a second call selects the supporting sentence IDs from the original content. It can also return `none`.
- Work distinguishes **not documented**, **adjacent experience**, **direct evidence**, and **unclear requirement**. Missing documentation does not establish that you lack the skill.

The interesting extension is a coverage matrix across several saved roles. If API reliability is repeatedly important and poorly evidenced, preparing one strong reliability story may help several applications. Count the affected roles and choose the intervention in code. You get a concrete preparation priority instead of a generic match percentage.

**Why this is first:** It works with existing stories and manually supplied postings. It does not require external ingestion, embeddings, a generative model or a new career profile. It makes several existing sections more useful together.

**First version:** One application, its pasted description and 5–10 stories. Return up to three relevant stories and one gap, with source passages. Expand to rendered resume text after the story matcher proves useful. Use appointment preparation's existing `storyIds` relationship when the user accepts a suggestion.

**Measure:** Do the suggested stories beat simple tag/keyword matching? How often is the selected evidence actually sufficient? Does preparation take less time?

## 2. Adaptive interview rehearsal without generated questions

**Interaction:** Choose an upcoming interview and start a short rehearsal. Work asks an authored question, you type your answer, and it selects a follow-up based on the weakest part of that answer.

Example flow:

> “Tell me about a technical tradeoff.” → Your answer describes what the team built. → Work asks: “Which alternative did you reject, and why?” → Your answer explains the alternative. → Work asks: “What evidence showed the decision worked?”

JEV chooses these prompts from a bank. Feedback comes from authored templates such as “Your answer explains the team outcome; make your own contribution explicit,” with a selected source passage where useful.

**Decision design:** Rate one dimension per question: personal contribution, explicit alternatives, supported outcome, relevance to the interview question and reflection. Code selects the weakest actionable dimension, then routes to a follow-up question. These dependent steps require sequential calls or a deterministic mapping from the first call's results.

Work already has `STORY_PROMPTS` and `MOCK_RUBRICS` in [templates.ts](../src/content/templates.ts). They are reusable content, although the rehearsal interface itself is new. Start with Behavioural and Fundamentals; use technical rubrics to assess explanations, while actual code correctness belongs to execution/tests.

**Creative extension:** Rehearse the same truthful story for different audiences: a recruiter, a backend engineer and an engineering manager. A Choice picks the lens; separate rubric judgments identify whether the answer addresses that audience's supplied concerns. This tests adaptability without rewriting your experience.

Keep the session transient by default. Allow “Save this reflection” to update a current preparation note explicitly. Avoid introducing an answer-history database merely to personalize the next question.

**Measure:** Are follow-ups relevant? Does a second answer address the identified omission? Manually check that weaker but honest answers are not penalized in favor of impressive unsupported claims.

## 3. “I have 25 minutes”: a decision system for starting

**Interaction:** On Home, choose available time and an optional mode such as “low energy,” “deep focus” or “interview tomorrow.” Work proposes one action and two alternatives, each opening an existing record or an authored exercise.

Example: “Choose and rehearse one ownership story for Thursday's interview,” rather than “Prepare for interviews.”

**Decision design:** Code first builds valid candidates from upcoming appointments, application deadlines/follow-ups, active goals and prepared exercise templates. It removes completed/closed items, calculates urgency and filters by supplied time. JEV evaluates narrow semantic factors: relevance to the next interview, alignment with the selected direction, and whether the action has a clear output. Code combines those judgments with dates and user-selected constraints.

For scoring rubrics with different numbers of levels, normalize `score / (levels - 1)` before weighting. A score is a position on a rubric, not a measurement of minutes or a probability of success. [Score documentation](https://docs.typesafe.ai/primitives/score)

**The useful twist:** Include “You already have enough preparation; do the rehearsal” as an authored action. The selector can counter endless research by recognizing when existing evidence is sufficient for a concrete practice step. It should still display the reasoning as supplied factors and links, not infer your motivation or mental state.

This feature depends on having candidate actions. Work currently has goals and notes, not a general task database or reliable duration estimates. Start with a small authored action catalog whose time buckets you set; add structured tasks only if needed. Offer an explicit choice when the supplied data cannot justify a recommendation.

**Measure:** Acceptance and actual completion of the selected action, with current session feedback. Compare against a baseline that picks the earliest actionable deadline. Calendar arithmetic alone does not need JEV.

## 4. Resume evidence audit over the rendered PDF text

**Interaction:** After a successful compile, choose a role and “Check this resume.” Work marks paragraphs that support the role, claims with weak backing and important evidence that exists in a story but is absent from the resume.

**Decision design:** Use the compiler's current extracted text, segmented into sentence/paragraph candidates. Ask atomic judgments: Does this passage describe personal action? Does it identify a concrete outcome? Does it support this requirement? Does its claim conflict with the supplied story? Return passage IDs and authored advice.

Distinguish “the supplied notes do not support this claim” from “the claim is false.” Work cannot independently verify your employment achievements. Numeric comparisons and exact claim consistency should use parsers where possible.

This can also choose among independent resume variants: “For this role, this existing document has the strongest relevant evidence.” It cannot establish which version you submitted to an old application, because Work does not keep submission snapshots.

**Two layers of checking:**

- Deterministic checks handle empty text, broken encoding, missing headings, duplicate lines and extraction failures.
- JEV handles semantic clarity, relevance and evidence strength.

Rendered text is valuable because it reflects what extraction produced, rather than what the LaTeX source appears to say. However, text input cannot establish whether the PDF looks good or predict how a particular applicant tracking system will parse it. Uploaded/scanned PDFs and DOCX need a separate extraction path; reuse of compiler text applies specifically to native compiled documents.

**Measure:** Compare flagged passages against your own review; count useful changes accepted. Run the audit on demand or after a successful changed build, not on every LaTeX keystroke.

## 5. Paste-to-Work capture: choose meaning, copy facts

**Interaction:** Paste a recruiter message, a job posting, an achievement note or a useful article excerpt. Work suggests a destination and a preview of the resulting record or update.

Examples:

- An assessment invitation → suggest the existing application and recruitment step; show candidate dates and meeting links.
- “I resolved duplicate task execution by adding idempotency keys…” → suggest an achievement note or a STAR draft whose fields contain selected original sentences.
- A concept explanation → suggest the existing learning tab and a note template.

**Decision design:** First classify the input and destination from current IDs. Code extracts candidate dates, URLs, titles and sentences. JEV selects which candidate fills each role; code copies the original value and validates it. For dates, show the source phrase, reference date and timezone; resolve offsets and daylight saving in code.

This follows TypeSafe's documented pattern of finding possible values first, selecting among them, then normalizing deterministically. Candidate recall is the limit: a value the parser missed cannot be selected. [Pre-parsed extraction cookbook](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook)

**Useful extension:** “Where does this belong?” can select an existing application, interview or direction even when the text uses a different phrase. Always include `none`/`ambiguous`, especially when two roles share a company.

Free-form titles can come from pasted headings or user input. A first version should leave ambiguous STAR fields empty rather than pretend that sentence selection generates a polished narrative. Updates to application status or appointments remain previewed, validated writes through the current contracts.

**Measure:** Time saved and correction rate by field. Treat a wrong appointment time as more consequential than a wrong suggested tab.

## 6. A Pi-powered Opportunity Radar

**Interaction:** Work's Radar gains a small “New opportunities to review” area. The Pi checks selected company feeds or structured careers endpoints and presents only plausibly relevant new roles.

**Pipeline:**

1. You choose sources and preferences: location, role families, experience range and directions to explore. These preferences need a new explicit contract; they cannot be assumed from the current timezone/display-name settings.
2. The Pi fetches public structured listings where available. Use conditional requests, stable role IDs and content hashes. Start with a handful of selected companies and daily checks.
3. Code applies reliable structured filters and removes already-reviewed unchanged listings.
4. JEV classifies ambiguous role content: engineering focus, hands-on scope, stated experience expectations and connection to your selected directions.
5. Work shows the source text, link and reason labels. “Save application” creates a normal Saved application after review.

The useful question is often **“Is this worth investigating?”**, rather than “Am I qualified?” A security-oriented title could describe product engineering, compliance or sales; the work described matters more than the label.

**Creative extension:** Search for adjacent roles that share your selected interests but use unfamiliar titles. This can widen discovery without indiscriminately collecting every job. Unknown eligibility, sponsorship or residency requirements remain unknown unless explicitly sourced; they should never silently exclude an opportunity.

The Pi is useful for browser-based collection and heavier parsing when simple feeds fail. Lightweight scheduled HTTP fetches could also run in the Worker. The existing Worker cron already runs every minute for operational cleanup, so scheduling alone does not justify sending work to the Pi.

This needs a separate automation service and a narrow new Worker integration. There is currently no general Pi automation credential/API; the compiler token is not a workspace API credential. Keep the compiler service and queue isolated. Retain current candidate state and hashes with expiry, not full histories of every careers page. The Pi still calls hosted JEV; its CPU is not running the model locally.

**Measure:** Fraction of surfaced roles you want to inspect, missed relevant listings in a manually reviewed sample, and collector maintenance time. Discovery is valuable only if it saves more effort than maintaining the collectors costs.

## Further applications worth exploring

### 7. DSA transfer practice: hide the pattern label

The roadmap organizes problems by patterns, which is useful for learning but can give away the approach. Add a mixed-practice mode that chooses existing problem IDs and hides the category until after you explain your first approach.

JEV evaluates the explanation against the problem's supplied description/reference material: identified invariant, plausible pattern and acknowledged edge cases. It selects an authored hint or a simpler existing exercise. Tests validate code; a model judgment cannot certify an algorithm.

Start with an authored subset of problems for which you have dependable reference explanations. Existing metadata/slugs alone are insufficient to grade a solution. LeetCode completion is evidence of a solve, not proof of mastery. Personalized review scheduling or mistake tracking would need new explicit current state; the app does not already hold that data.

### 8. Direction stress test: find the question that could change the choice

Choose two directions, roles or offers. Supply the criteria you care about and the relevant notes. JEV judges each option separately against each criterion, with supporting passage IDs and explicit unknowns. Code applies your weights and shows how the result changes when you change a weight.

The creative part is selecting a **decision-changing question** from an authored bank: “What does on-call actually involve?” or “How often will I ship product code?” Favor questions attached to important criteria with missing evidence. Call this a heuristic for reducing uncertainty, not a measured expected value of information.

A useful outcome may be “Ask about mentorship before deciding,” rather than an overall winner. Broad judgments such as future happiness, admission chances or compensation potential cannot be established from sparse notes.

### 9. Interview debrief → current preparation

After an interview, choose “Review this debrief.” JEV identifies selected sentences that describe asked questions, difficulties, promises and preparation gaps. It matches each gap to an existing story or learning note and proposes a current update: link a story, add a follow-up date, or append a reflection to preparation.

This creates a loop from experience to action. It does not require storing old versions of everything. Keep the preview transient; save only the updates you accept. A statement like “they said they'd be in touch” should not automatically advance a recruitment stage.

### 10. Semantic evidence search without starting with a vector database

Try queries such as “Where did I explain handling a partial failure?” Retrieve a shortlist, then ask JEV to rate passages and select the best supporting IDs. Work returns original excerpts and record links. The official reranking cookbook uses this retrieval-then-judgment pattern. [Reranking cookbook](https://docs.typesafe.ai/cookbooks/rerank_typesafe)

The existing backend has owner-scoped SQLite FTS, while some screens filter records locally. FTS needs a relevant shortlist to work: a reranker cannot recover a story that never reached it. For a small workspace, include a bounded set of story/note summaries, broaden retrieval with curated synonyms or index derived semantic tags. Add embeddings only if retrieval recall demonstrably needs them.

The FTS schema already indexes `data` alongside title, body and tags, so it can retrieve STAR fields stored in structured data. Local screen filters have their own behavior; a new cross-workspace search should use a consistent searchable representation. Start by reusing this feature's passage selection inside the role evidence map. See [the FTS definition](../migrations/0009_current_workspace.sql).

### 11. Choose one portfolio project that closes several gaps

Given selected applications and current evidence, choose from an authored project menu: an idempotent queue worker, an observable API, a failure-recovery exercise or a cache with consistency tests. JEV maps each requirement to the projects that could demonstrate it; code calculates coverage and applies your effort constraints.

The Pi can run the chosen experiment and collect real evidence. After you complete it, review the output and save a project case study or achievement note using Work's existing templates. This connects Learn → real work → Documents → Interviews. The model selects the experiment; it cannot invent completion, benchmarks or the resulting story.

### 12. Turn Work itself into interview practice

Use the project you're actively building as the source of concrete technical questions. Author prompts around D1 transaction boundaries, stale device writes, idempotency, private attachments, compiler isolation and tunnel failure. JEV chooses a prompt and judges your explanation against a supplied, current reference excerpt.

Example: “A device comes back online after a workspace replacement. What should happen to its queued writes, and why?” Follow with a question about version counters versus workspace epochs if your answer confuses them.

On the Pi, run controlled local experiments such as cancelling a compile or restarting a test service, then capture observations. Use those observations as current case-study material. This builds credible engineering explanations from a system you know intimately. Experiments should use a local/staging setup so practice does not disrupt the compiler you rely on.

## How to integrate it with this codebase

### Keep request handling in the Worker

For the first feature, add a proposed authenticated route such as `POST /api/decisions/role-evidence`. The browser sends a bounded task request and selected record IDs; the Worker resolves ownership, loads current records, constructs fixed questions, calls TypeSafe and returns a validated result. The browser renders original excerpts and authored labels.

- Put `TYPESAFE_API_KEY` in Worker secrets. Use the direct TypeSafe endpoint for the credits you bought; another provider's billing route should not be assumed to use that balance.
- Add a small `worker/jev.ts` client and task-specific schemas in `shared/jev.ts`. These files do not exist yet. Built-in `fetch` is enough for a first integration; adopt the SDK if its retry/types support earns its dependency cost.
- Update the known-route matcher in `worker/index.ts`; otherwise new `/api/decisions/...` requests will receive 404 before authentication. Preserve session/owner checks and workspace-epoch handling. The same-origin frontend CSP already fits a Worker proxy.
- Make tasks server-defined. Do not expose an arbitrary public prompt proxy or accept client-supplied owner IDs. Bound inputs, question counts and candidate IDs.
- Use a timeout and bounded retries for transient failures/429s, honoring `Retry-After`. Track retry spend: a provider call is not made idempotent by Work's write receipts. Avoid calls on each keystroke.

### Separate judgments from writes

An accepted suggestion uses the normal versioned write path and current validation. Revalidate referenced IDs and versions before applying it. A changed or deleted story should not be linked because a cached result still mentions it.

The schemas are strict. Adding `fitScore`, `skills` or `jevMetadata` directly to `application.data` or `story.data` will fail. Start with transient results; if caching is useful, introduce an explicitly scoped derived table with a separate migration rather than weakening the core contracts.

A cache key should include owner, workspace epoch, task/schema version, pinned model, input hash and relevant record versions. Deletion, content changes and workspace replacement must invalidate affected outputs, including selected excerpts. Keep only current derived state. Add metadata to transfer/deletion contracts deliberately if it becomes persistent user-owned content.

### Use IDs to make outputs inspectable

Pass locally assigned clause/passage IDs with their actual text. Questions must explicitly name the passage or requirement being assessed; question-map keys are not inference instructions. Return those IDs, validate membership, then display the original text.

For an explanation, combine an authored label (“Personal contribution is unclear”) with the selected excerpt. JEV cannot generate a free-form rationale. Selecting an excerpt also does not prove the classification; check the judgment on evaluated examples.

Always provide a missing/ambiguous option where a closed set could force a bad answer. Avoid combining 150 problems, every story and every application into one giant state. Batch questions that share relevant context; keep unrelated contexts separate. TypeSafe's fan-out pattern explains why shared-state batching is useful. [Fan-out](https://docs.typesafe.ai/patterns/fan-out)

### Give the Pi a narrow job

For discovery or heavier extraction, use a separate service account, systemd service/timer, bounded temporary directory and resource limits. Preserve the compiler's existing one-job-at-a-time behavior and sandbox. Prefer outbound calls from the Pi when possible; a broad new public Pi endpoint is unnecessary for scheduled collectors.

Design a scoped machine credential for the new integration, with per-owner authorization and revocation. Do not reuse GitHub session cookies or the LaTeX compiler token. Have the Worker construct JEV requests from permitted data where practical, keeping the TypeSafe key in one place.

Native PDF text already in R2 needs no additional extraction service. Add Pi work only where the Worker/browser cannot conveniently do it, such as a browser-dependent collector or controlled project experiment.

### Make the data boundary explicit

Selected private career content will leave your existing Cloudflare/Pi boundary for hosted inference. Provide a clear enablement setting describing this, and send only the necessary passages. Remove contact details when they add no value. Production and staging need separate configuration; the public demo should use synthetic fixtures rather than spending your balance.

TypeSafe says customer requests/responses are not used to train models and identifies enterprise zero-data-retention options. That does not establish zero retention for this $5 account. Verify the account's applicable data handling before sending sensitive documents. [Model data handling](https://docs.typesafe.ai/models)

Store usage, task/model identifiers, input hashes and latency without logging raw notes or resumes. Keep user content out of telemetry and source control.

## What $5 buys, and how to spend it

TypeSafe advertises **$42 per billion input tokens**, equivalent to **$0.042 per million**; its model documentation says output tokens are free. These are current public prices, not a guarantee about future billing. [Public price](https://typesafe.ai/), [billing basis](https://docs.typesafe.ai/models)

The following arithmetic assumes that rate and that the balance is US$5. “Input tokens” includes the supplied state and questions; measure actual `usage.input_tokens` rather than estimating only the source document.

| Total input per request | Approximate price | Approximate requests for $5 |
| ----------------------- | ----------------- | --------------------------- |
| 2,000 tokens            | $0.000084         | 59,500                      |
| 5,000 tokens            | $0.000210         | 23,800                      |
| 15,000 tokens           | $0.000630         | 7,900                       |

Formula: `cost = input_tokens × 0.042 / 1,000,000`. $5 corresponds to about 119 million input tokens at this rate. These counts exclude retries, other infrastructure costs and future price changes.

An illustrative personal workload—20 daily requests at 5,000 tokens each—costs about $0.63 over 30 days. The balance should support many experiments; accuracy and usefulness deserve more attention than squeezing each prompt to its absolute minimum.

Suggested experimental allocation:

- **$0.25:** establish actual latency, usage and quality on synthetic/minimized examples.
- **$0.75:** compare several role-evidence and rehearsal rubric designs.
- **$0.50:** held-out evaluation, adversarial/ambiguous inputs and candidate-order checks.
- **$0.50:** a short real-use trial.
- **$3.00:** reserve for whichever workflow proves worth using.

These are ceilings, not spending targets. Start with a per-day cap, an experiment-wide cap and a small concurrency limit. Reserve estimated budget atomically before dispatching concurrent calls, then reconcile actual usage. A local ledger is approximate if the same key is used elsewhere; inspect the TypeSafe console balance as well. Do not enable automatic refills as part of the experiment.

## A concrete first experiment

1. **Prepare a small evaluation set.** Use 5–10 current stories and several pasted postings. Manually label about 60 requirement/story pairs, including direct support, adjacent evidence, irrelevant stories and absent evidence. Use synthetic or minimized material where appropriate.
2. **Compare baselines.** Evaluate keyword/tag matching and JEV with simple explicit rubrics. Hold out some postings and stories when tuning; repeated variants of the same story should not leak into the test set.
3. **Check failures that matter.** Include two applications at one company, contradictory claims, empty STAR fields, reordered candidates and postings containing instructions to the model. Look for unsupported confident matches and missed good evidence.
4. **Set task-specific acceptance rules.** An initial target could be at least 90% precision for evidence displayed as “direct,” with ambiguous cases visibly withheld or labeled. This is a proposed product target, not observed JEV accuracy. Track recall and coverage too; silence alone can look artificially precise.
5. **Build the smallest useful UI.** “Find my evidence” → three story suggestions, supporting passages and one gap. Accepting a story links it to appointment preparation. Saving unrelated metadata is unnecessary.
6. **Evaluate the actual workflow.** Over a week, record transient usefulness feedback and aggregate correction counts. Measure end-to-end p50/p95 latency, failure/retry rate and cost. Keep whichever feature meaningfully reduces preparation effort.
7. **Add rehearsal next.** Use the strongest selected story and the existing rubric bank to choose follow-ups. Add Radar ingestion only after you trust the relevance judgments that would filter its results.

For merely displaying suggestions, conservative confidence gates and an explicit uncertain state are sufficient starting points. Confidence thresholds must come from the evaluation; a returned 0.9 is not a validated 90% correctness rate for this application. No classifier confidence should authorize external messages, applications, offer acceptance or destructive workspace operations.

## Applications I would defer

- **Generic chat, resume rewriting or cover-letter generation:** the desired output is open-ended text. JEV is more useful selecting and checking existing evidence.
- **Automatic applications, recruiter replies or offer decisions:** a wrong semantic judgment has consequences beyond a reversible suggestion. Begin with drafts/previews and your normal explicit actions.
- **A single employability or interview-success percentage:** the input cannot establish a hiring probability. Expose separate evidence dimensions instead.
- **Replacing date logic, LeetCode totals, goal progress or compile diagnostics:** the app already has deterministic data or executable checks for these.
- **Using JEV as the security boundary for uploaded text or LaTeX:** TypeSafe documents adversarial-input susceptibility. Existing authorization, validation and compiler isolation remain necessary.
- **An always-on personal agent over the whole workspace:** it would require task semantics, machine access and data lifecycle decisions that Work does not yet have. Start with bounded decisions whose value you can inspect.

The best sequence is **evidence → practice → next action → discovery**. It gives Work a useful intelligence layer while keeping the content, decisions and career priorities under your control.
