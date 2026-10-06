import { field, type RecordData, type WorkRecord } from "../../../shared/model";

export interface Criterion {
  id: string;
  label: string;
  weight: number;
}
export interface RoleOption {
  id: string;
  title: string;
  currency: string;
  base: string;
  equity: string;
  bonus: string;
  location: string;
  arrangement: string;
  scope: string;
  mentorship: string;
  growth: string;
  mobility: string;
  startDate: string;
  deadline: string;
  source: string;
  checkedAt: string;
  confirmation: "Unknown" | "Employer-stated" | "Written offer";
  nonNegotiables: "Unknown" | "Yes" | "No";
  scores: Record<string, number | null>;
  notes: string;
}
export interface Milestone {
  id: string;
  text: string;
  done: boolean;
  dueDate: string;
}

export const defaultCriteria = (): Criterion[] =>
  [
    "Engineering ownership",
    "Technical depth",
    "Mentorship",
    "Growth and demonstrable impact",
    "Location and life fit",
    "Personal interest",
  ].map((label, index) => ({ id: `criterion-${index}`, label, weight: 1 }));
export const blankOption = (title = ""): RoleOption => ({
  id: crypto.randomUUID(),
  title,
  currency: "",
  base: "",
  equity: "",
  bonus: "",
  location: "",
  arrangement: "",
  scope: "",
  mentorship: "",
  growth: "",
  mobility: "",
  startDate: "",
  deadline: "",
  source: "",
  checkedAt: "",
  confirmation: "Unknown",
  nonNegotiables: "Unknown",
  scores: {},
  notes: "",
});

export function criteriaFromData(data: RecordData): Criterion[] {
  if (Array.isArray(data.criteria))
    return data.criteria
      .filter(
        (item): item is Criterion =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as Criterion).label === "string",
      )
      .map((item) => ({
        id: typeof item.id === "string" ? item.id : crypto.randomUUID(),
        label: item.label,
        weight:
          typeof item.weight === "number" && item.weight >= 0 ? item.weight : 1,
      }));
  if (typeof data.criteria === "string" && data.criteria.trim())
    return data.criteria
      .split("\n")
      .filter(Boolean)
      .map((label, index) => ({ id: `criterion-${index}`, label, weight: 1 }));
  return defaultCriteria();
}

export function optionsFromData(data: RecordData): RoleOption[] {
  if (Array.isArray(data.options))
    return data.options
      .filter(
        (item): item is RoleOption =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as RoleOption).title === "string",
      )
      .map((item) => ({
        ...blankOption(),
        ...item,
        scores:
          typeof item.scores === "object" && item.scores !== null
            ? item.scores
            : {},
      }));
  if (typeof data.options === "string")
    return data.options
      .split("\n")
      .filter(Boolean)
      .map((title) => blankOption(title));
  return [];
}

/** No score is shown until every weighted criterion has an actual user-entered rating. */
export function weightedRating(
  option: RoleOption,
  criteria: Criterion[],
): number | null {
  const active = criteria.filter((criterion) => criterion.weight > 0);
  if (
    !active.length ||
    active.some(
      (criterion) =>
        typeof option.scores[criterion.id] !== "number" ||
        option.scores[criterion.id]! < 1 ||
        option.scores[criterion.id]! > 5,
    )
  )
    return null;
  const weight = active.reduce(
    (total, criterion) => total + criterion.weight,
    0,
  );
  return (
    active.reduce(
      (total, criterion) =>
        total + (option.scores[criterion.id] as number) * criterion.weight,
      0,
    ) / weight
  );
}

export function milestonesFromData(data: RecordData): Milestone[] {
  return Array.isArray(data.milestones)
    ? data.milestones
        .filter(
          (item): item is Milestone =>
            typeof item === "object" &&
            item !== null &&
            typeof (item as Milestone).text === "string",
        )
        .map((item) => ({
          id: item.id || crypto.randomUUID(),
          text: item.text,
          done: item.done === true,
          dueDate: typeof item.dueDate === "string" ? item.dueDate : "",
        }))
    : [];
}

export function milestonesFromText(
  text: string,
  previous: Milestone[] = [],
): Milestone[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(
      (line) =>
        previous.find((item) => item.text === line) || {
          id: crypto.randomUUID(),
          text: line,
          done: false,
          dueDate: "",
        },
    );
}

export function evidenceStory(record: WorkRecord) {
  return {
    kind: "story" as const,
    title: record.title,
    body: record.body,
    tags: record.tags,
    links: [record.id, ...record.links],
    data: {
      situation: field(record, "situation"),
      task: field(record, "task"),
      action: field(record, "contribution"),
      result: field(record, "outcome", field(record, "impact")),
      reflection: field(record, "reflection"),
      evidence: field(record, "evidence"),
      verified: record.data.verified === true,
    },
  };
}

export function evidenceBullet(record: WorkRecord) {
  const contribution = field(record, "contribution");
  const outcome = field(record, "outcome", field(record, "impact"));
  return {
    kind: "asset" as const,
    title: `${record.title} — resume bullet`,
    body: [contribution, outcome].filter(Boolean).join(" "),
    tags: record.tags,
    links: [record.id, ...record.links],
    data: {
      type: "bullet",
      verified: record.data.verified === true,
      impact: outcome,
      scope: field(record, "scope"),
      technologies: field(record, "technologies"),
      versionLabel: "Evidence draft",
    },
  };
}

export const CAREER_TIMELINE = [
  {
    month: "OCT 2026",
    title: "Set the direction",
    body: "Capture actual work evidence, establish a resume baseline, shortlist teams, and choose a sustainable routine.",
  },
  {
    month: "NOV 2026",
    title: "Build usable preparation",
    body: "Tailor assets, practise explaining your work, record coding reflections, and talk to relevant people.",
  },
  {
    month: "DEC 2026",
    title: "Start serious applications",
    body: "Apply to suitable real roles, track deadlines and follow-ups, and prepare for the actual pipeline.",
  },
  {
    month: "JAN 2027",
    title: "Use the feedback",
    body: "Focus preparation on upcoming interviews and observed gaps. Keep internal options visible.",
  },
  {
    month: "FEB 2027",
    title: "Choose the next chapter",
    body: "Compare available offers and roll-off roles with evidence, open questions, and personal priorities.",
  },
];
