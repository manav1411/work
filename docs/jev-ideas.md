# Jev ideas for Work

Saved 5 October 2026. These are proposed experiments, separate from the Work improvements implementation. No Jev calls, crawlers, mailbox connections, or email delivery are enabled by this document.

Jev would supply structured choices, rubric scores, and yes/no probabilities; Work would collect information, calculate dates, combine scores, and take actions. Templates or a separate text model would supply generated prose where needed. See [TypeSafe's introduction](https://docs.typesafe.ai/introduction).

The credits were bought directly from [TypeSafe's console](https://console.typesafe.ai). Published pricing is $0.042 per million input tokens, with free output. $5 represents roughly 119 million input tokens, or 59,500 evaluations at 2,000 billed input tokens each, at that rate. Crawling and email delivery have separate costs. See [published pricing](https://typesafe.ai/blog/introducing-system-one-models-and-jev).

## 1. Career radar: good matches and interesting stretches

Collect new job listings daily and evaluate separate criteria: interest in the actual work, relevant experience, career direction, seniority, and important unknowns. Combine those judgments using user-controlled weights.

Keep Strong match, Interesting stretch, and Needs clarification categories. Missing information, such as relocation support, remains unknown. A role can be interesting despite a skill gap. Include an occasional wildcard to avoid reinforcing a narrow preference loop.

Send a morning email with a handful of new opportunities, matching factors, source excerpts, and links into Work to save, dismiss, or review them. Feedback updates a saved preference profile supplied with later evaluations.

Begin with employer feeds such as [Greenhouse](https://docs.greenhouse.io/job-board.html) and [Lever](https://github.com/lever/postings-api), adding selected career-page scrapers later. The same shortlist lives in Applications, so email is a doorway into Work.

## 2. Company radar: meaningful changes before an application

Monitor career pages and selected engineering announcements for companies on the radar. Classify changes against the user's interests: infrastructure teams, security hiring, early-career programmes, or a role shifting from support toward product engineering.

Alert on observed relevant changes, such as two new backend roles, with dated sources. An engineering announcement alone should not imply upcoming recruitment. Companies remain useful to follow without a current vacancy or application.

## 3. Learning priorities from the actual shortlist

Map saved listing requirements onto Learn concepts, separating explicit requirements from preferences. Count recurring topics in code and compare them with recorded experience.

Example: transactions and concurrency recur across saved roles, so show the relevant Databases readings and notes. Distinguish missing skill from missing evidence: documenting an existing project may help more than starting another course.

## 4. STAR story coverage and retrieval

Evaluate each story's personal contribution, specific actions, meaningful result, and competency relevance. Show coverage across conflict, ownership, ambiguity, failure, collaboration, and technical judgment.

Rank existing stories against a role/interview question. Return concrete feedback labels such as Result missing or Your contribution is unclear, linked to the appropriate fields. Preserve the user's facts and wording.

## 5. Preparation packs for the actual interview round

Use the scheduled round, recruiter instructions, job description, and saved material to select relevant resources, story cards, technical notes, and exercises/questions from a bank.

Assemble a small preparation page: API trade-off notes, two relevant exercises, and an incident story, for example. Highlight missing information such as whether the round is live coding or system design, so preparation is directed at the right task.

## 6. Practice that responds to weaknesses in an answer

Evaluate whether a practice answer addresses the question, exposes reasoning, discusses trade-offs, and supports claims with examples. Select the next exercise from a tagged bank: a trade-off exercise for a technology list without decisions, or a shorter STAR retelling for an unclear behavioural answer.

Use accumulated feedback to identify recurring weaknesses. Technical correctness relies on executable tests or suitable reference material rather than a model's confidence alone.

## 7. Recruitment email to application timeline

Begin with pasting or forwarding individual recruitment messages. Classify assessment invitations, interview requests, rejections, offers, and availability requests; associate them with candidate applications.

Propose a structured update for review, such as adding an online assessment deadline. Select dates and links from source material, highlight ambiguous values, and calculate dates/timezones in code. Later, an optional selected-mailbox connection could automate collection.

The result is less manual tracker maintenance and immediate preparation context without unreviewed consequential changes.

## 8. Projects that close several useful gaps

Score the user's project ideas or curated briefs against shortlist requirements, interests, and existing experience. Identify projects supplying several missing examples together.

For instance, a small service with transactions, background jobs, and integration tests could support multiple role requirements and interview stories. Display the gaps it addresses, the saved roles making those gaps relevant, and a small completion milestone.

## 9. Career experiments in Your Direction

For alternatives such as cybersecurity and software engineering, record unresolved questions and reversible experiments: shadowing a team, a small backend task, a security exercise, or a conversation with someone doing the role.

Evaluate each experiment's relevance to the questions. Combine that with user-supplied effort estimates in code. Record what was learned and revisit the comparison; the user's experience supplies the evidence for the decision.

## 10. Preference laboratory

Explore changes such as technical ownership becoming more important than company prestige, or which opportunities remain attractive across several career directions.

Score independent dimensions once, then recompute rankings in code when weights change. Compare rankings with company names hidden to expose brand effects. Surface missing information that prevents a confident comparison, such as mentoring quality, and link a predefined research/interview question to it.

## Suggested sequence

Start with career radar, shortlist-informed learning, and STAR retrieval. Add recruitment email ingestion afterward. Career experiments and preference comparisons are the more distinctive longer-term features.

Before building a broad crawler, evaluate listings the user has personally labelled. Preserve source excerpts, use narrow questions and explicit unknowns, measure errors, and keep arithmetic/date handling in code. See [composite scoring](https://docs.typesafe.ai/patterns/composite-scoring) and [known model limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13).

Work's Cloudflare backend can run [scheduled collection](https://developers.cloudflare.com/workers/configuration/cron-triggers/). Suggestions should appear in their relevant pages, while Home remains centred on its timeline.
