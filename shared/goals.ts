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
    directionId: z.string().max(120).default(""),
    measure: z.enum(["completion", "leetcode"]).default("completion"),
    target: z.number().finite().positive().max(1_000_000_000).default(1),
    milestones: z.array(milestoneSchema).max(100).default([]),
    status: z.enum(["active", "completed"]).default("active"),
    completedAt: z.string().datetime().nullable().default(null),
  })
  .strict();
export const goalInputSchema = goalFields
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
  directionId: "",
  measure: "completion",
  target: 1,
  milestones: [],
  status: "active",
  completedAt: null,
};
export function newGoal(input: GoalInput): Goal {
  const at = new Date().toISOString();
  return {
    ...input,
    id: crypto.randomUUID(),
    version: 1,
    createdAt: at,
    updatedAt: at,
  };
}
export function goalProgress(goal: Goal, observedValue?: number) {
  const value =
    goal.measure === "completion"
      ? goal.status === "completed"
        ? 1
        : 0
      : (observedValue ?? 0);
  const target = goal.measure === "completion" ? 1 : goal.target;
  return {
    value,
    target,
    percent: Math.min(100, Math.max(0, (value / target) * 100)),
    complete: goal.status === "completed" || value >= target,
  };
}
