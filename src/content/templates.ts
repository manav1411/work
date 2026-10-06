export const NOTE_TEMPLATES = [
  { id: "blank", title: "Blank note", body: "" },
  {
    id: "company",
    title: "Company research",
    body: "# Company research\n\n## Why this company\n\n## Engineering teams and scope\n\n## Roles and requirements\n\n## Australia / US path\n- Source:\n- Checked on:\n- Confidence:\n- Next question:\n\n## People to speak to\n\n## Next action\n- [ ] ",
  },
  {
    id: "interview",
    title: "Interview notes",
    body: "# Interview notes\n\n## Role, stage and participants\n\n## Preparation\n- [ ] Read the job description\n- [ ] Choose two relevant stories\n- [ ] Prepare questions\n\n## Questions and observations\n\n## What went well\n\n## What I would change\n\n## Follow-up actions\n- [ ] ",
  },
  {
    id: "concept",
    title: "Technical concept",
    body: "# Technical concept\n\n## Explain it in your own words\n\n## A small example\n```python\n\n```\n\n## Tradeoffs and edge cases\n\n## Where I used it\n\n## Source\n\n## Recall question\n",
  },
  {
    id: "problem",
    title: "Problem reflection",
    body: "# Problem reflection\n\n## Pattern and invariant\n\n## First approach\n\n## Improved approach\n\n## Complexity\n- Time:\n- Space:\n\n## Mistake and how to catch it\n\n## Explain without looking\n\n## Next review\n",
  },
  {
    id: "achievement",
    title: "Work achievement",
    body: "# Work achievement\n\n## Context and problem\n\n## My contribution\n\n## Outcome\n\n## Evidence and measurement\n\n## Technologies\n\n## Feedback\n\n## Resume bullet draft\n",
  },
  {
    id: "project",
    title: "Project case study",
    body: "# Project case study\n\n## Problem and users\n\n## Scope\n\n## Architecture\n\n## Decisions and tradeoffs\n\n## Testing and reliability\n\n## Outcome and demonstration\n\n## What I would improve\n",
  },
  {
    id: "weekly",
    title: "Weekly review",
    body: "# Weekly review\n\n## Meaningful work completed\n\n## What was difficult to start\n\n## Feedback and learning\n\n## Upcoming commitments\n\n## Three priorities\n- [ ] \n- [ ] \n- [ ] \n\n## Make one task smaller\n",
  },
  {
    id: "decision",
    title: "Decision log",
    body: "# Decision log\n\n## Decision and deadline\n\n## Options\n\n## Criteria\n\n## Evidence\n\n## Unknowns and assumptions\n\n## People to consult\n\n## Decision and reasoning\n\n## Revisit on\n",
  },
];

export const STORY_PROMPTS = [
  "Introduce yourself",
  "Ownership",
  "Collaboration",
  "Conflict",
  "Failure and learning",
  "Stakeholder communication",
  "Technical tradeoff",
  "Delivering impact",
];

export const MOCK_RUBRICS: Record<string, string[]> = {
  Coding: [
    "Clarifies requirements and examples",
    "Explains an approach before coding",
    "Uses an invariant or clear reasoning",
    "Analyses time and space",
    "Tests edge cases",
    "Communicates and responds to feedback",
  ],
  Debugging: [
    "Reproduces the issue",
    "Forms testable hypotheses",
    "Uses evidence and tools",
    "Finds the root cause",
    "Verifies the fix",
    "Explains prevention",
  ],
  "System design": [
    "Clarifies scope and requirements",
    "Estimates relevant constraints",
    "Defines APIs and data model",
    "Explains tradeoffs",
    "Addresses reliability and security",
    "Responds to changing requirements",
  ],
  Behavioural: [
    "Sets context briefly",
    "Makes personal contribution clear",
    "Explains decisions",
    "Describes a supported outcome",
    "Reflects honestly",
    "Connects to the question",
  ],
  Fundamentals: [
    "Defines terms clearly",
    "Gives a concrete example",
    "Explains tradeoffs",
    "Handles follow-up questions",
    "Acknowledges uncertainty",
    "Connects to engineering experience",
  ],
};
