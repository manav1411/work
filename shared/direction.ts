import { z } from "zod";

export const directionDate = z
  .string()
  .refine(
    (value) =>
      !value ||
      (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(`${value}T12:00:00Z`)) &&
        new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value),
    "Use a valid date.",
  );
const researchUrl = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        ["https:", "http:"].includes(url.protocol) &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, "Use an http or https research link.");
export const directionDataSchema = z
  .object({
    category: z.literal("direction"),
    priority: z.string().max(80).default("Exploratory"),
    status: z.string().max(80).default("Exploring"),
    location: z.string().max(240).default(""),
    focus: z.string().max(240).default(""),
    nextStep: z.string().max(2000).default(""),
    uncertainties: z.string().max(10_000).default(""),
    outcome: z.string().max(10_000).default(""),
    reviewDate: directionDate.default(""),
    startDate: directionDate.default(""),
    endDate: directionDate.default(""),
    researchLinks: z.array(researchUrl).max(40).default([]),
  })
  .passthrough()
  .refine(
    (value) =>
      !value.startDate || !value.endDate || value.startDate <= value.endDate,
    "The start date must be before the end date.",
  );

export const DIRECTION_KINDS = ["path", "rotation", "decision"] as const;
