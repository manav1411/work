import type { RecordInput } from "../../shared/model";

export const STARTER_RECORDS: RecordInput[] = [
  {
    kind: "action",
    title: "Capture one backend achievement",
    body: "Start with what changed, your contribution, and evidence you can verify.",
    tags: ["career"],
    data: {
      status: "todo",
      estimatedMinutes: 15,
      firstStep: "Write one sentence about a problem you helped solve.",
      priority: "high",
      pinned: true,
      category: "evidence",
    },
  },
  {
    kind: "action",
    title: "Review one coding pattern",
    body: "Choose a problem, explain the approach, and record what you want to remember.",
    tags: ["practice"],
    data: {
      status: "todo",
      estimatedMinutes: 30,
      firstStep:
        "Open a familiar problem and explain the approach before coding.",
      priority: "normal",
      category: "practice",
    },
  },
  {
    kind: "action",
    title: "Refresh the experience section of your resume",
    body: "Bring the backend and cybersecurity rotations up to date with verified evidence.",
    tags: ["applications"],
    data: {
      status: "todo",
      estimatedMinutes: 25,
      firstStep: "Write one bullet about the backend rotation.",
      priority: "normal",
      category: "assets",
    },
  },
  {
    kind: "company",
    title: "Google",
    body: "Primary research target. Save roles that fit your experience and record what you learn about the teams.",
    tags: ["priority", "research target"],
    data: {
      location: "Australia / United States",
      website: "https://www.google.com/about/careers/applications/",
      hiringUrl:
        "https://www.google.com/about/careers/applications/jobs/results/",
      priority: "High",
      path: "australia-transfer",
      status: "Researching",
      checkedAt: "",
      nextQuestion: "Which SWE roles and teams fit my current experience?",
    },
  },
  {
    kind: "path",
    title: "Australia → US",
    body: "Apply to large technology companies in Australia and research the possibility of a later internal US transfer.",
    tags: ["strategy"],
    data: {
      slug: "australia-us",
      location: "Australia, then US",
      confidence: "To research",
      priority: "Primary",
      nextStep:
        "Find suitable Australian SWE roles and ask about the actual mobility process.",
      uncertainties:
        "Employer policy, transfer timing, team availability, work authorisation.",
      reviewDate: "2027-02-01",
      evidence: "",
      source: "",
    },
  },
  {
    kind: "path",
    title: "Direct to the US",
    body: "Explore direct US software engineering opportunities alongside Australian applications.",
    tags: ["strategy"],
    data: {
      slug: "direct-us",
      location: "San Francisco Bay Area",
      confidence: "To research",
      priority: "Primary",
      nextStep:
        "Save a relevant US role and record its experience and authorisation requirements.",
      uncertainties:
        "Sponsorship, relocation support, role fit, and recruitment timeline.",
      reviewDate: "2027-02-01",
      evidence: "",
      source: "",
    },
  },
  {
    kind: "path",
    title: "A Flutter-group move",
    body: "Explore a possible move through the current company’s parent group. Keep this as a lower-confidence option until researched.",
    tags: ["strategy"],
    data: {
      slug: "flutter",
      location: "United States",
      confidence: "Low / unverified",
      priority: "Exploratory",
      nextStep:
        "Identify a useful internal contact and a relevant engineering team.",
      uncertainties:
        "Availability, eligibility, transfer policy, and actual engineering scope.",
      reviewDate: "2027-02-01",
      evidence: "",
      source: "",
    },
  },
  {
    kind: "decision",
    title: "The February 2027 next-chapter decision",
    body: "Compare external opportunities with available roll-off roles. Consider engineering ownership, mentoring, technical depth, location, and growth.",
    tags: ["career"],
    data: {
      reviewDate: "2027-02-01",
      status: "Researching",
      options:
        "External SWE opportunity\nCurrent-company roll-off\nPotential frontend rotation",
      criteria:
        "Engineering ownership\nMentorship\nTechnical depth\nDemonstrable impact\nLocation and personal interest",
      nextStep: "Collect the questions you need answered before deciding.",
      nonNegotiables: "",
      outcome: "",
    },
  },
  {
    kind: "rotation",
    title: "Backend engineering rotation",
    body: "Collect the outcomes, decisions, collaboration, and lessons from the first rotation.",
    tags: ["experience"],
    data: {
      status: "Completed",
      focus: "Backend software engineering",
      outcomes: "",
      feedback: "",
      nextStep: "Add one verifiable achievement to the evidence bank.",
    },
  },
  {
    kind: "rotation",
    title: "Cybersecurity rotation",
    body: "Keep track of technical work, engineering lessons, feedback, and goals during the second rotation.",
    tags: ["experience"],
    data: {
      status: "Current",
      focus: "Cybersecurity",
      endDate: "2027-02-01",
      outcomes: "",
      feedback: "",
      nextStep:
        "Record a technical problem, your contribution, and the result.",
    },
  },
  {
    kind: "note",
    title: "A little momentum goes a long way",
    body: "# Your next move, in one place\n\nPick one useful action on **Today**, save notes as you go, and connect them to the role, company, or skill they belong to.\n\n## Your current direction\n\n- Build towards a software engineering role at a large technology company.\n- Explore Australia → US, direct US, and a possible Flutter-group move.\n- Start serious applications in late 2026.\n- Compare the next chapter around February 2027.\n\n## Keep it small\n\nA first sentence, one problem reflection, or a useful follow-up is enough to get started. You can return to the exact draft later.\n\nUse the capture button or **C** to save an idea. **⌘K / Ctrl+K** opens search.\n",
    tags: ["getting started"],
    data: { collection: "Workspace", pinned: true },
  },
];

export const DEMO_EXTRAS: RecordInput[] = [
  {
    kind: "application",
    title: "Software engineer — sample opportunity",
    body: "This is an illustrative opportunity for exploring the application workflow, not a current job listing.",
    tags: ["demo"],
    data: {
      company: "Example Engineering",
      location: "Melbourne",
      stage: "Researching",
      path: "Australia → US",
      nextAction: "Research the team and role requirements",
      history: [],
      jobDescription:
        "A sample role focused on backend services and working with a collaborative engineering team.",
    },
  },
  {
    kind: "achievement",
    title: "Made an endpoint easier to debug",
    body: "An example of how to record your contribution, evidence, and reflection. Replace this with your own work.",
    tags: ["demo", "backend"],
    data: {
      situation: "An illustrative backend problem",
      contribution: "Added clearer logging and a reproducible test case.",
      impact: "Record the actual result here; don’t invent a metric.",
      evidence: "",
      verified: false,
    },
  },
  {
    kind: "note",
    title: "Interview reflection template",
    body: "# Interview reflection\n\n## What went well?\n\n## What surprised me?\n\n## A concept to revisit\n\n## One next step\n\n",
    tags: ["interviews"],
    data: { collection: "Interview prep", pinned: false },
  },
];
