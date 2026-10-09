import { z } from "zod";

const date = z
  .string()
  .refine(
    (value) =>
      !value ||
      (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(`${value}T12:00:00Z`)) &&
        new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value),
    "Use a valid date.",
  );
const destination = z
  .string()
  .max(2048)
  .refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "Use an https URL.");
export const milestoneSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(240),
    date,
    done: z.boolean(),
    completedAt: z.string().datetime().nullable(),
  })
  .strict();
export const goalFields = z
  .object({
    title: z.string().trim().min(1).max(240),
    targetDate: date.default(""),
    startDate: date.default(""),
    sourceUrl: destination.default(""),
    scheduleKind: z.enum(["range", "event"]).optional(),
    directionId: z.string().max(120).default(""),
    goalIds: z
      .array(z.string().min(1).max(120))
      .max(100)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Linked goals must be unique.",
      )
      .optional(),
    measure: z
      .enum(["completion", "leetcode", "neetcode150"])
      .default("completion"),
    target: z.number().finite().positive().max(1_000_000_000).default(1),
    milestones: z.array(milestoneSchema).max(100).default([]),
    status: z.enum(["active", "completed"]).default("active"),
    completedAt: z.string().datetime().nullable().default(null),
  })
  .strict();
export const goalInputSchema = goalFields
  .refine(
    (value) =>
      value.scheduleKind !== "event" || value.startDate === value.targetDate,
    "An event must have one date.",
  )
  .refine(
    (value) => actionGoalIds(value).length > 0,
    "Choose at least one goal for this action.",
  )
  .refine(
    (value) =>
      !value.startDate ||
      !value.targetDate ||
      value.startDate <= value.targetDate,
    "The start date must be before the target date.",
  )
  .refine(
    (value) =>
      new Set(value.milestones.map((item) => item.id)).size ===
      value.milestones.length,
    "Milestone IDs must be unique.",
  );
export const goalSchema = goalFields
  .extend({
    id: z.string().uuid(),
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .refine(
    (value) =>
      value.scheduleKind !== "event" || value.startDate === value.targetDate,
    "An event must have one date.",
  )
  .refine(
    (value) => actionGoalIds(value).length > 0,
    "Choose at least one goal for this action.",
  )
  .refine(
    (value) =>
      !value.startDate ||
      !value.targetDate ||
      value.startDate <= value.targetDate,
    "The start date must be before the target date.",
  )
  .refine(
    (value) =>
      new Set(value.milestones.map((item) => item.id)).size ===
      value.milestones.length,
    "Milestone IDs must be unique.",
  );
export type GoalInput = z.infer<typeof goalFields>;
export type Goal = z.infer<typeof goalSchema>;
export type Milestone = z.infer<typeof milestoneSchema>;
export const EMPTY_GOAL: GoalInput = {
  title: "",
  targetDate: "",
  startDate: "",
  sourceUrl: "",
  scheduleKind: "range",
  directionId: "",
  measure: "completion",
  target: 1,
  milestones: [],
  status: "active",
  completedAt: null,
};
/** Actions can support multiple goals. Older saved actions have one directionId. */
export function actionGoalIds(
  action: Pick<GoalInput, "directionId" | "goalIds">,
): string[] {
  return action.goalIds ?? (action.directionId ? [action.directionId] : []);
}
export function actionLinks(goalIds: string[]) {
  return { goalIds, directionId: goalIds[0] ?? "" };
}
export function actionInput(goal: Goal): GoalInput {
  return {
    ...(Object.fromEntries(
      Object.keys(EMPTY_GOAL).map((key) => [
        key,
        goal[key as keyof GoalInput] ?? EMPTY_GOAL[key as keyof GoalInput],
      ]),
    ) as GoalInput),
    ...actionLinks(actionGoalIds(goal)),
  };
}
export function newGoal(input: GoalInput): Goal {
  const at = new Date().toISOString();
  return {
    ...input,
    ...actionLinks(actionGoalIds(input)),
    id: crypto.randomUUID(),
    version: 1,
    createdAt: at,
    updatedAt: at,
  };
}
export function eventStatus(date: string, today: string) {
  return !date
    ? "Date not set"
    : date < today
      ? "Passed"
      : date > today
        ? "Upcoming"
        : "Today";
}
export function actionOrder(a: Goal, b: Goal) {
  return (
    (a.startDate || "9999-99-99").localeCompare(b.startDate || "9999-99-99") ||
    (a.targetDate || "9999-99-99").localeCompare(
      b.targetDate || "9999-99-99",
    ) ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id)
  );
}
export function goalProgress(
  goal: Goal,
  observedValue?: number,
  today = new Date().toISOString().slice(0, 10),
) {
  const passed =
    goal.scheduleKind === "event" &&
    !!goal.targetDate &&
    goal.targetDate < today;
  const value =
    goal.measure === "completion"
      ? goal.status === "completed" || passed
        ? 1
        : 0
      : (observedValue ?? 0);
  const target = goal.measure === "completion" ? 1 : goal.target;
  return {
    value,
    target,
    percent: Math.min(100, Math.max(0, (value / target) * 100)),
    complete: goal.status === "completed" || value >= target || passed,
  };
}
