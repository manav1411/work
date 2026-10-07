import type { RecordInput } from "../../shared/model";
import { addDays, localDate } from "../../shared/model";
import { demoDocumentRecords } from "./demo-documents";

export interface DemoShowcaseFile {
  recordKey: string;
  attachmentKey: string;
  filename: string;
  contentType: "text/markdown" | "text/plain";
  content: string;
}

const step = (
  id: string,
  title: string,
  kind: "submission" | "assessment" | "interview" | "offer",
  state: "Planned" | "Completed",
) => ({ id, title, kind, state, date: "" });

function process(
  key: string,
  completedThrough: number,
  status: "Saved" | "Applied" | "In progress" | "Offer" | "Rejected",
) {
  const steps = [
    step(`${key}-application`, "Application", "submission", "Planned"),
    step(`${key}-screen`, "Recruiter conversation", "interview", "Planned"),
    step(`${key}-technical`, "Technical interview", "interview", "Planned"),
    step(`${key}-team`, "Team conversation", "interview", "Planned"),
    step(`${key}-offer`, "Offer", "offer", "Planned"),
  ].map((item, index) => ({
    ...item,
    state: index <= completedThrough ? ("Completed" as const) : item.state,
  }));
  const firstPlanned = steps.find(
    (item) =>
      item.state === "Planned" && !["submission", "offer"].includes(item.kind),
  );
  return {
    processVersion: 2,
    applicationStatus: status,
    recruitmentSteps: steps,
    selectedStepId: status === "In progress" ? (firstPlanned?.id ?? "") : "",
    ...(status === "Rejected" ? { terminalOutcome: "Rejected" } : {}),
  };
}

/** Synthetic content used only in the isolated browser demo workspace. */
export function demoShowcaseRecords(today = localDate()): RecordInput[] {
  const recent = addDays(today, -12);
  const applied = addDays(today, -5);
  return [
    ...demoDocumentRecords(),
    ...demoLearningNotes(),
    {
      kind: "application",
      title: "Software Engineer, Platform",
      body: "Platform team working on internal developer tooling. Recruiter screen went well; the technical round will focus on API design and service reliability.",
      tags: ["demo", "platform", "backend"],
      data: {
        demoSeedKey: "app-atlassian-platform",
        company: "Atlassian",
        location: "Sydney, Australia",
        url: "https://www.atlassian.com/company/careers",
        applicationDate: applied,
        ...process("atlassian-platform", 1, "In progress"),
      },
    },
    {
      kind: "application",
      title: "Graduate Software Engineer",
      body: "Applied through the careers portal with the backend resume. Interested in the collaboration and publishing teams. Follow up next week if there is no response.",
      tags: ["demo", "graduate", "software engineering"],
      data: {
        demoSeedKey: "app-canva-graduate",
        company: "Canva",
        location: "Melbourne, Australia",
        url: "https://www.canva.com/careers/",
        applicationDate: recent,
        ...process("canva-graduate", 0, "Applied"),
      },
    },
    {
      kind: "application",
      title: "Software Engineer, Security",
      body: "Strong fit for my API security experience. Tailor the cover letter around the account ownership review and prepare a concise threat modelling example.",
      tags: ["demo", "security", "software engineering"],
      data: {
        demoSeedKey: "app-google-security",
        company: "Google",
        location: "Melbourne or Sydney, Australia",
        url: "https://www.google.com/about/careers/applications/",
        ...process("google-security", -1, "Saved"),
      },
    },
    {
      kind: "application",
      title: "Backend Engineer, Developer Experience",
      body: "Offer received after the team conversation. Compare mentorship, on-call expectations and the scope of developer tooling work before responding.",
      tags: ["demo", "developer experience", "backend"],
      data: {
        demoSeedKey: "app-github-developer-experience",
        company: "GitHub",
        location: "Remote — Australia",
        url: "https://github.com/about/careers",
        applicationDate: addDays(today, -35),
        ...process("github-developer-experience", 4, "Offer"),
      },
    },
    {
      kind: "application",
      title: "Software Engineer II",
      body: "The team selected a candidate with more Azure experience. Feedback was positive on problem solving; revisit cloud deployment fundamentals before the next round.",
      tags: ["demo", "software engineering"],
      data: {
        demoSeedKey: "app-microsoft-engineer",
        company: "Microsoft",
        location: "Sydney, Australia",
        url: "https://jobs.careers.microsoft.com/",
        applicationDate: addDays(today, -64),
        ...process("microsoft-engineer", 4, "Rejected"),
      },
    },
    {
      kind: "company",
      title: "Stripe",
      body: "Watch the payments infrastructure team. Their work on reliable money movement matches my interest in idempotency and distributed systems.",
      tags: ["demo", "payments", "infrastructure"],
      data: {
        demoSeedKey: "radar-stripe",
        radar: true,
        location: "Australia / Remote",
        website: "https://stripe.com/",
        careersUrl: "https://stripe.com/jobs",
      },
    },
    {
      kind: "company",
      title: "Cloudflare",
      body: "Keep an eye on developer platform roles. Read about Workers and edge caching before reaching out to the Melbourne engineering community.",
      tags: ["demo", "security", "networking"],
      data: {
        demoSeedKey: "radar-cloudflare",
        radar: true,
        location: "Melbourne / Remote",
        website: "https://www.cloudflare.com/",
        careersUrl: "https://www.cloudflare.com/careers/jobs/",
      },
    },
    {
      kind: "path",
      title: "Platform and distributed systems",
      body: "I want to own backend services end to end: APIs, data models, deployment and reliability.\n\nOver the next six months, build QueueWatch into a deployed service, write up two design decisions and practise explaining failure recovery. Target teams with strong mentoring and meaningful operational ownership.",
      tags: ["demo", "career direction", "software engineering"],
      data: {
        demoSeedKey: "direction-platform-engineering",
        category: "direction",
        status: "Exploring",
        startDate: addDays(today, -21),
        endDate: addDays(today, 420),
        researchLinks: [
          "https://thundergolfer.com/blog/get-to-the-states#fnref:1",
          "https://sre.google/books/",
        ],
        researchLinkTitles: [
          "Aussie engineers, get to the states!",
          "Site Reliability Engineering",
        ],
      },
    },
    {
      kind: "path",
      title: "Product security engineering",
      body: "Explore product security roles that keep me close to software delivery. The account ownership review was the most rewarding part of my last project.\n\nNext steps: threat-model QueueWatch, review one authentication flow and speak with two engineers about how security partners with product teams.",
      tags: ["demo", "career direction", "security"],
      data: {
        demoSeedKey: "direction-product-security",
        category: "direction",
        status: "Exploring",
        startDate: addDays(today, -21),
        endDate: addDays(today, 540),
        researchLinks: ["https://owasp.org/www-project-top-ten/"],
        researchLinkTitles: ["OWASP Top Ten"],
      },
    },
    {
      kind: "note",
      title: "Behavioural",
      body: "# Keep the answer grounded\n\n- Start with the context and why it mattered.\n- Make your own responsibility clear.\n- Explain the decisions and trade-offs you made.\n- Finish with the result and what you learned.\n\n## Useful reminder\n\nAim for a two-minute answer. Prepare the handoff story for collaboration, the incident story for problem solving and the ownership review for judgement.",
      tags: ["demo", "interviews", "behavioural"],
      data: {
        demoSeedKey: "interview-tab-behavioural",
        category: "interview-tab",
        tabKey: "behavioural",
        order: 0,
      },
    },
    {
      kind: "note",
      title: "Technical",
      body: "# Work through the problem clearly\n\n1. Clarify inputs, constraints, and expected behaviour.\n2. Describe a simple approach before optimising.\n3. Check edge cases and complexity.\n4. Test with a small example and explain trade-offs.\n\n## Topics to revisit\n\n- Hash maps and set membership\n- Graph traversal and shortest paths\n- API boundaries, data modelling, and failure handling\n\nPractice plan: one graph problem and one API design question each evening. Explain the invariant before coding and leave five minutes for testing.",
      tags: ["demo", "interviews", "technical"],
      data: {
        demoSeedKey: "interview-tab-technical",
        category: "interview-tab",
        tabKey: "technical",
        order: 1,
      },
    },
    {
      kind: "story",
      title: "Make a cross-team handoff easier to follow",
      body: "A collaboration example from the billing migration at Harbour Labs.",
      tags: ["communication", "ownership", "collaboration"],
      data: {
        demoSeedKey: "story-cross-team-handoff",
        situation:
          "Our billing migration depended on the support team checking account exceptions, but ownership and acceptance criteria were spread across chat threads.",
        task: "Clarify what each team needed and leave behind a handoff that could be checked without relying on memory.",
        action:
          "I mapped the exceptions with support, wrote a shared checklist with clear owners and added a dry-run report so both teams could verify the migration before release.",
        result:
          "We migrated 2,400 accounts without a billing interruption. Support resolved the remaining exceptions in two days, and the checklist became the template for the next rollout.",
        lessons:
          "A short written contract and explicit ownership can prevent the same clarification from being repeated.",
      },
    },
    {
      kind: "story",
      title: "Find a useful signal in an operational failure",
      body: "An incident investigation from the event ingestion service.",
      tags: ["reliability", "problem solving", "backend"],
      data: {
        demoSeedKey: "story-operational-signal",
        situation:
          "The ingestion API intermittently duplicated events after client timeouts. Logs showed successful requests but did not connect retries to the original event.",
        task: "Narrow down the failure path and make the next investigation more reliable.",
        action:
          "I reproduced the timeout in staging, traced the retry path with request IDs and added an idempotency key backed by a unique database constraint. I also added a regression test for concurrent retries.",
        result:
          "Duplicate events dropped to zero in the following four weeks. The new logs also cut incident investigation time from roughly an hour to twenty minutes.",
        lessons:
          "Observability is most useful when it is tied to a concrete question and a reproducible test.",
      },
    },
    {
      kind: "story",
      title: "Turn a security concern into a practical change",
      body: "A security improvement delivered during an account management review.",
      tags: ["security", "judgement", "engineering"],
      data: {
        demoSeedKey: "story-security-change",
        situation:
          "An account export endpoint checked authentication but trusted the account ID supplied by the client without checking ownership.",
        task: "Explain the risk clearly and suggest a change the team could deliver without disrupting the workflow.",
        action:
          "I demonstrated the issue with two staging accounts, added ownership checks at the data access boundary and reviewed the other account endpoints with a teammate.",
        result:
          "We fixed the endpoint before release and added cross-account tests to six related workflows. The team adopted the ownership check as a shared helper.",
        lessons:
          "Security recommendations land better when they include a concrete engineering path and a way to verify it.",
      },
    },
    {
      kind: "interview",
      title: "Technical interview — Atlassian platform role",
      body: "45-minute video call with the platform engineering team. Have the QueueWatch architecture sketch and latency improvement example ready.",
      tags: ["demo", "technical interview"],
      data: {
        demoSeedKey: "appointment-atlassian-technical",
        demoApplicationSeedKey: "app-atlassian-platform",
        appointmentVersion: 2,
        stepId: "atlassian-platform-technical",
        startsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        timezone: "Australia/Melbourne",
        status: "Scheduled",
      },
    },
    {
      kind: "interview",
      title: "Recruiter conversation — Atlassian platform role",
      body: "Discussed backend experience, Melbourne location and team expectations. Next round: coding and API design.",
      tags: ["demo", "recruiter conversation"],
      data: {
        demoSeedKey: "appointment-atlassian-recruiter",
        demoApplicationSeedKey: "app-atlassian-platform",
        appointmentVersion: 2,
        stepId: "atlassian-platform-screen",
        startsAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        timezone: "Australia/Melbourne",
        status: "Completed",
      },
    },
    {
      kind: "note",
      title: "Atlassian technical interview preparation",
      body: "# Before the conversation\n\n- Review one backend system design example and its trade-offs.\n- Practise explaining complexity while solving a small problem.\n- Prepare questions about service ownership, reliability, and team collaboration.\n\n## Resource\n\nRevisit the Site Reliability Engineering book and the problem notes in Learn. Bring the QueueWatch failure-recovery diagram. Ask how the team measures developer experience and shares on-call responsibilities.",
      tags: ["demo", "interview preparation"],
      data: {
        demoSeedKey: "preparation-atlassian-technical",
        category: "interview-preparation",
        demoInterviewSeedKey: "appointment-atlassian-technical",
        demoApplicationSeedKey: "app-atlassian-platform",
        storySeedKeys: ["story-operational-signal", "story-cross-team-handoff"],
        order: 0,
      },
    },
    {
      kind: "asset",
      title: "Resume review checklist",
      body: "Final checks before sending a tailored application.",
      tags: ["demo", "resume"],
      data: {
        demoSeedKey: "document-resume-outline",
        demoAttachmentSeedKey: "resume-outline",
        type: "document",
      },
    },
    {
      kind: "asset",
      title: "QueueWatch design notes",
      body: "Architecture decisions and operational checks for the QueueWatch project.",
      tags: ["demo", "project"],
      data: {
        demoSeedKey: "document-project-notes",
        demoAttachmentSeedKey: "project-notes",
        type: "document",
      },
    },
  ];
}

export const DEMO_SHOWCASE_FILES: DemoShowcaseFile[] = [
  {
    recordKey: "document-resume-outline",
    attachmentKey: "resume-outline",
    filename: "resume-review.md",
    contentType: "text/markdown",
    content:
      "# Resume review\n\n- Tailored summary to platform engineering and developer tooling.\n- Checked the event volume and latency figures against project notes.\n- Kept experience to one page with readable spacing.\n- Proofread contact details and exported the final PDF.\n\n## Before sending\nConfirm the role title and attach the Platform engineering variant.\n",
  },
  {
    recordKey: "document-project-notes",
    attachmentKey: "project-notes",
    filename: "queuewatch-design.txt",
    contentType: "text/plain",
    content:
      "QUEUEWATCH - DESIGN NOTES\n\nGoal\nMake stalled background jobs visible before customers report missing updates.\n\nDesign\nWorkers publish heartbeat and completion events to Redis. A Python collector aggregates queue age and retry counts into PostgreSQL. The dashboard polls a summary API every 30 seconds.\n\nTrade-off\nAt-least-once delivery keeps the pipeline simple; event IDs deduplicate repeated messages. Alerts wait for three missed heartbeats to avoid noise during deploys.\n\nVerification\nLoad-tested 10,000 jobs, simulated a worker crash and confirmed a single alert after 90 seconds. Recovery clears the alert automatically.\n",
  },
];

function demoLearningNotes(): RecordInput[] {
  const notes = [
    [
      "backend",
      "Reliable API notes",
      "## Retries and idempotency\n\nA timeout does not tell the client whether the server committed the request. Store an idempotency key with the result so retries return the original response.\n\n### QueueWatch experiment\nTwo concurrent requests with the same event ID produced one database row. The unique constraint is the final guard; an in-memory check is not enough.\n\n[HTTP reference](https://developer.mozilla.org/en-US/docs/Web/HTTP)",
    ],
    [
      "databases",
      "Query tuning",
      "## Indexes and query plans\n\nThe slow jobs query filtered by queue_id and ordered by created_at. A composite index on both fields removed the sort and reduced p95 latency from 420ms to 180ms.\n\nNext: compare EXPLAIN ANALYZE before and after adding the index, including write overhead.\n\n[PostgreSQL tutorial](https://www.postgresql.org/docs/current/tutorial.html)",
    ],
    [
      "systems",
      "Networking notes",
      "## Following an HTTPS request\n\nDNS resolves the hostname, TCP establishes the connection, TLS negotiates encryption and HTTP carries the request. Connection reuse avoids repeating the setup for every API call.\n\nExercise: trace a dashboard request in DevTools and compare a cold request with a reused connection.",
    ],
    [
      "testing",
      "Debugging journal",
      "## Duplicate event regression\n\nReproduce the timeout after a transaction commits. Retry with the same event ID and assert exactly one stored event and the same response.\n\nAlso test two concurrent retries: sequential tests missed the race. Keep the test at the database boundary.",
    ],
    [
      "design",
      "QueueWatch architecture",
      "## Background job monitoring\n\nWorkers emit events to Redis; a collector stores summaries in PostgreSQL. The dashboard reads queue age and failure rate through a small API.\n\nTrade-off: polling every 30 seconds is sufficient for the current use case and simpler to operate than a live socket connection.\n\nNext: define retention and backpressure behaviour before increasing event volume.",
    ],
    [
      "frontend",
      "Form state notes",
      "## Clear ownership of state\n\nKeep the saved record separate from the editable draft. Show loading, saving and retry states explicitly. Cancel or ignore stale responses when switching records.\n\nKeyboard check: labels, visible focus, errors connected to their fields and focus restored after closing a dialog.",
    ],
    [
      "security",
      "Account ownership review",
      "## Authentication is only the first check\n\nEvery query must scope the requested record to the signed-in account. Check ownership in the shared data access helper so a new route cannot forget it.\n\nRegression check: account A cannot read, update or delete account B's exports, even with a valid record ID.",
    ],
  ];
  return notes.map(([track, title, body]) => ({
    kind: "note",
    title,
    body,
    tags: ["demo"],
    data: {
      demoSeedKey: `learn-${track}`,
      category: "content-document",
      scope: "learn",
      track,
    },
  }));
}
