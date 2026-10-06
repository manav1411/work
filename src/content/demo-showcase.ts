import type { RecordInput } from "../../shared/model";
import { addDays, localDate } from "../../shared/model";

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
    (item) => item.state === "Planned" && !["submission", "offer"].includes(item.kind),
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
    {
      kind: "application",
      title: "Software Engineer, Platform",
      body: "Illustrative sample application. The role, notes, and process below are demo content, not a live application.",
      tags: ["demo", "platform", "backend"],
      data: {
        demoSeedKey: "app-atlassian-platform",
        company: "Atlassian",
        location: "Sydney, Australia",
        url: "https://www.atlassian.com/company/careers",
        applicationDate: applied,
        ...process("atlassian-platform", 1, "In progress"),
        notes:
          "Sample notes: ask how the team balances service ownership with shared platform standards. Prepare a concise example of an operational improvement.",
        nextAction: "Prepare for the technical interview",
      },
    },
    {
      kind: "application",
      title: "Graduate Software Engineer",
      body: "Illustrative sample application. This record is here to preview the applied state and a multi-step process.",
      tags: ["demo", "graduate", "software engineering"],
      data: {
        demoSeedKey: "app-canva-graduate",
        company: "Canva",
        location: "Melbourne, Australia",
        url: "https://www.canva.com/careers/",
        applicationDate: recent,
        ...process("canva-graduate", 0, "Applied"),
        notes:
          "Sample notes: application submitted; revisit the role requirements before an assessment arrives.",
        nextAction: "Review the role brief and prepare for an assessment",
      },
    },
    {
      kind: "application",
      title: "Software Engineer, Security",
      body: "Illustrative saved role to demonstrate a tailored engineering application and a process that has not started.",
      tags: ["demo", "security", "software engineering"],
      data: {
        demoSeedKey: "app-google-security",
        company: "Google",
        location: "Melbourne or Sydney, Australia",
        url: "https://www.google.com/about/careers/applications/",
        ...process("google-security", -1, "Saved"),
        notes:
          "Sample notes: compare the security engineering requirements with current project experience before applying.",
        nextAction: "Check role fit and application requirements",
      },
    },
    {
      kind: "application",
      title: "Backend Engineer, Developer Experience",
      body: "Illustrative sample offer state for previewing the completed end of an application process.",
      tags: ["demo", "developer experience", "backend"],
      data: {
        demoSeedKey: "app-github-developer-experience",
        company: "GitHub",
        location: "Remote — Australia",
        url: "https://github.com/about/careers",
        applicationDate: addDays(today, -35),
        ...process("github-developer-experience", 4, "Offer"),
        notes:
          "Sample notes: review the written offer, team remit, and support arrangements before making a decision.",
        nextAction: "Compare the role against longer-term priorities",
      },
    },
    {
      kind: "application",
      title: "Software Engineer II",
      body: "Illustrative closed application to show how completed process history remains visible.",
      tags: ["demo", "software engineering"],
      data: {
        demoSeedKey: "app-microsoft-engineer",
        company: "Microsoft",
        location: "Sydney, Australia",
        url: "https://jobs.careers.microsoft.com/",
        applicationDate: addDays(today, -64),
        ...process("microsoft-engineer", 4, "Rejected"),
        notes:
          "Sample reflection: capture what went well and one area to practise before the next process.",
        nextAction: "Keep the interview reflection for future preparation",
      },
    },
    {
      kind: "company",
      title: "Stripe",
      body: "A sample company to keep on the radar while learning about infrastructure and payments engineering.",
      tags: ["demo", "payments", "infrastructure"],
      data: {
        demoSeedKey: "radar-stripe",
        radar: true,
        location: "Australia / Remote",
        website: "https://stripe.com/",
        careersUrl: "https://stripe.com/jobs",
        reason:
          "Interesting mix of API design, reliability, and product engineering. Sample research prompt: learn how local engineering teams are organised.",
        reviewDate: addDays(today, 14),
      },
    },
    {
      kind: "company",
      title: "Cloudflare",
      body: "A sample radar company for exploring edge networking and security engineering.",
      tags: ["demo", "security", "networking"],
      data: {
        demoSeedKey: "radar-cloudflare",
        radar: true,
        location: "Melbourne / Remote",
        website: "https://www.cloudflare.com/",
        careersUrl: "https://www.cloudflare.com/careers/jobs/",
        reason:
          "Sample research prompt: compare the security, networking, and platform teams and note which work sounds most engaging.",
        reviewDate: addDays(today, 24),
      },
    },
    {
      kind: "path",
      title: "Platform and distributed systems",
      body: "Sample direction: build deep software engineering experience around dependable backend services, clear interfaces, and operational ownership.",
      tags: ["demo", "career direction", "software engineering"],
      data: {
        demoSeedKey: "direction-platform-engineering",
        category: "direction",
        status: "Exploring",
        priority: "Primary",
        location: "Australia, with longer-term US options",
        focus: "Backend systems, APIs, reliability, and developer tooling",
        startDate: today,
        endDate: addDays(today, 420),
        nextStep:
          "Choose one project that demonstrates an end-to-end engineering decision and its measured outcome.",
        uncertainties:
          "Which team environment, product area, and location will be the best long-term fit?",
        researchLinks: [
          "https://thundergolfer.com/blog/get-to-the-states#fnref:1",
          "https://sre.google/books/",
        ],
        researchLinkTitles: [
          "Aussie engineers, get to the states!",
          "Site Reliability Engineering",
        ],
        reviewDate: addDays(today, 30),
      },
    },
    {
      kind: "path",
      title: "Product security engineering",
      body: "Sample direction: combine software engineering with practical security work, threat modelling, and secure-by-default systems.",
      tags: ["demo", "career direction", "security"],
      data: {
        demoSeedKey: "direction-product-security",
        category: "direction",
        status: "Exploring",
        priority: "Alternative",
        location: "Australia",
        focus: "Application security, secure development, and infrastructure",
        startDate: today,
        endDate: addDays(today, 540),
        nextStep:
          "Compare hands-on product security roles with security-focused software engineering roles.",
        uncertainties:
          "How much of the day-to-day work is coding, engineering enablement, or review?",
        researchLinks: ["https://owasp.org/www-project-top-ten/"],
        researchLinkTitles: ["OWASP Top Ten"],
        reviewDate: addDays(today, 45),
      },
    },
    {
      kind: "note",
      title: "Behavioural interview notes",
      body: "# Keep the answer grounded\n\n- Start with the context and why it mattered.\n- Make your own responsibility clear.\n- Explain the decisions and trade-offs you made.\n- Finish with the result and what you learned.\n\n## Useful reminder\n\nUse the story bank as a prompt, then answer the question in your own words. These are illustrative demo notes.",
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
      title: "Technical interview notes",
      body: "# Work through the problem clearly\n\n1. Clarify inputs, constraints, and expected behaviour.\n2. Describe a simple approach before optimising.\n3. Check edge cases and complexity.\n4. Test with a small example and explain trade-offs.\n\n## Topics to revisit\n\n- Hash maps and set membership\n- Graph traversal and shortest paths\n- API boundaries, data modelling, and failure handling\n\nSample preparation notes; replace these with your own as you practise.",
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
      body: "Illustrative STAR story. Replace the scenario and outcome with a real example before using it in an interview.",
      tags: ["communication", "ownership", "collaboration"],
      data: {
        demoSeedKey: "story-cross-team-handoff",
        situation:
          "A sample project depended on a handoff between an engineering team and an adjacent group, and the assumptions were not written down in one place.",
        task:
          "Clarify what each team needed and leave behind a handoff that could be checked without relying on memory.",
        action:
          "I would map the dependency, confirm the contract with both sides, document the decision and edge cases, then add a small verification step to the workflow.",
        result:
          "In this sample, both teams can see the agreed interface and follow-up owner. Replace this outcome with evidence from real work.",
        lessons:
          "A short written contract and explicit ownership can prevent the same clarification from being repeated.",
      },
    },
    {
      kind: "story",
      title: "Find a useful signal in an operational failure",
      body: "Illustrative STAR story. The details are placeholders rather than a claim about real work.",
      tags: ["reliability", "problem solving", "backend"],
      data: {
        demoSeedKey: "story-operational-signal",
        situation:
          "A sample service produced an intermittent failure that was difficult to reproduce from the available logs.",
        task:
          "Narrow down the failure path and make the next investigation more reliable.",
        action:
          "I would reproduce the boundary conditions, add focused structured context, and write a regression test around the failing path before changing the implementation.",
        result:
          "The sample outcome is a repeatable test and clearer diagnostic evidence. Replace this with the actual outcome and any verified measure.",
        lessons:
          "Observability is most useful when it is tied to a concrete question and a reproducible test.",
      },
    },
    {
      kind: "story",
      title: "Turn a security concern into a practical change",
      body: "Illustrative STAR story to show a second competency and another populated card.",
      tags: ["security", "judgement", "engineering"],
      data: {
        demoSeedKey: "story-security-change",
        situation:
          "A sample review found that an internal workflow trusted more input than it needed to.",
        task:
          "Explain the risk clearly and suggest a change the team could deliver without disrupting the workflow.",
        action:
          "I would describe the trust boundary, agree on the smallest safe validation step, and pair it with tests for both expected and malformed input.",
        result:
          "The placeholder outcome is a narrower trust boundary with a regression test. Replace it with a real example and evidence.",
        lessons:
          "Security recommendations land better when they include a concrete engineering path and a way to verify it.",
      },
    },
    {
      kind: "interview",
      title: "Technical interview — Atlassian platform role",
      body: "Sample scheduled interview linked to the Atlassian application and its current process step.",
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
      body: "Sample completed appointment retained in the application's interview history.",
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
      body: "# Before the conversation\n\n- Review one backend system design example and its trade-offs.\n- Practise explaining complexity while solving a small problem.\n- Prepare questions about service ownership, reliability, and team collaboration.\n\n## Resource\n\nRevisit the Site Reliability Engineering book and the problem notes in Learn. These are demo prompts, not company-specific interview guidance.",
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
      kind: "resource",
      title: "Sample LinkedIn profile",
      body: "A safe placeholder external profile link for the isolated demo workspace.",
      tags: ["demo", "profile"],
      data: {
        demoSeedKey: "profile-link-linkedin",
        scope: "documents",
        category: "profile-link",
        url: "https://www.linkedin.com/",
      },
    },
    {
      kind: "resource",
      title: "Sample GitHub profile",
      body: "A safe placeholder external profile link for the isolated demo workspace.",
      tags: ["demo", "profile"],
      data: {
        demoSeedKey: "profile-link-github",
        scope: "documents",
        category: "profile-link",
        url: "https://github.com/",
      },
    },
    {
      kind: "asset",
      title: "Sample resume outline",
      body: "A text preview showing how a supporting document appears in the demo workspace. This is not a finished or verified resume.",
      tags: ["demo", "resume"],
      data: {
        demoSeedKey: "document-resume-outline",
        demoAttachmentSeedKey: "resume-outline",
        type: "document",
      },
    },
    {
      kind: "asset",
      title: "Sample project notes",
      body: "A second text preview so the document grid demonstrates more than one file.",
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
    filename: "sample-resume-outline.md",
    contentType: "text/markdown",
    content:
      "# Sample Engineer\n\n## Summary\nSoftware engineer focused on backend systems and reliable services. Replace with a verified summary.\n\n## Experience\n\n### Software Engineering Intern\n- Describe a real contribution and its context.\n- Add only outcomes you can support with evidence.\n\n## Projects\n- Project name — problem, design decision, and result.\n\n## Skills\nPython · TypeScript · APIs · SQL · Testing\n",
  },
  {
    recordKey: "document-project-notes",
    attachmentKey: "project-notes",
    filename: "sample-project-notes.txt",
    contentType: "text/plain",
    content:
      "PROJECT NOTES — DEMO\n\nGoal\nDescribe the user problem and constraints.\n\nDesign\nRecord the important decisions and trade-offs.\n\nVerification\nList tests, operational checks, and evidence of the result.\n",
  },
];
