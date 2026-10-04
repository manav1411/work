import { type RecordKind } from "./model";
import {
  ApplicationDataSchema,
  RadarCompanyDataSchema,
  InterviewAppointmentDataSchema,
} from "./applications";
import { contentDataError } from "./content";
import { DIRECTION_KINDS, directionDataSchema } from "./direction";
import { documentMetadataSchema, profileLinkDataSchema } from "./documents";
import type { z } from "zod";

/** New feature contracts are explicit; older imported metadata stays readable. */
export function recordDataError(
  kind: RecordKind,
  data: Record<string, unknown>,
): string | null {
  const content = contentDataError(kind, data);
  if (content) return content;
  let schema: z.ZodType | undefined;
  if (
    kind === "application" &&
    (data.applicationStatus !== undefined ||
      data.recruitmentSteps !== undefined)
  )
    schema = ApplicationDataSchema;
  if (kind === "company" && data.radar === true)
    schema = RadarCompanyDataSchema;
  if (kind === "interview" && (data.startsAt || data.stepId))
    schema = InterviewAppointmentDataSchema;
  if (data.category === "direction") {
    if (!DIRECTION_KINDS.some((value) => value === kind))
      return "Direction must be a path, stream, or decision.";
    schema = directionDataSchema;
  }
  if (
    kind === "asset" &&
    (["resume", "letter", "document", "cover-letter"].includes(
      String(data.type),
    ) ||
      data.documentDefault === true)
  )
    schema = documentMetadataSchema;
  if (data.category === "profile-link") {
    if (kind !== "resource") return "Profile links must be resources.";
    schema = profileLinkDataSchema;
  }
  if (!schema) return null;
  const result = schema.safeParse(data);
  return result.success
    ? null
    : (result.error.issues[0]?.message ?? "Invalid record details.");
}
