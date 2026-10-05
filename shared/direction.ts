import { z } from "zod";
import { normalizeWebUrl } from "./urls";

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
  .transform(normalizeWebUrl)
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
    priority: z.string().max(80).optional(),
    status: z.string().max(80).default("Exploring"),
    location: z.string().max(240).optional(),
    focus: z.string().max(240).optional(),
    nextStep: z.string().max(2000).optional(),
    uncertainties: z.string().max(10_000).optional(),
    outcome: z.string().max(10_000).optional(),
    reviewDate: directionDate.optional(),
    startDate: directionDate.default(""),
    endDate: directionDate.default(""),
    researchLinks: z.array(researchUrl).max(40).default([]),
    researchLinkTitles: z.array(z.string().max(240)).max(40).default([]),
  })
  .passthrough()
  .refine(
    (value) =>
      !value.startDate || !value.endDate || value.startDate <= value.endDate,
    "The start date must be before the end date.",
  );

export const DIRECTION_KINDS = ["path", "rotation", "decision"] as const;
