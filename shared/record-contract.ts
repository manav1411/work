import { type RecordKind } from "./model";
import {
  ApplicationDataSchema,
  RadarCompanyDataSchema,
  InterviewAppointmentDataSchema,
} from "./applications";
import { contentDataError, contentDataSchemaFor } from "./content";
import { DIRECTION_KINDS, directionDataSchema } from "./direction";
import { documentMetadataSchema, profileLinkDataSchema } from "./documents";
import type { z } from "zod";

/** Accept only the current feature contracts. */
export function recordDataError(
  kind: RecordKind,
  data: Record<string, unknown>,
): string | null {
  const content = contentDataError(kind, data);
  if (content) return content;
  let schema: z.ZodType | undefined;
  if (kind === "application") schema = ApplicationDataSchema;
  if (kind === "company") schema = RadarCompanyDataSchema;
  if (kind === "interview") schema = InterviewAppointmentDataSchema;
  if (data.category === "direction") {
    if (!DIRECTION_KINDS.some((value) => value === kind))
      return "Direction must be a path, stream, or decision.";
    schema = directionDataSchema;
  }
  if (kind === "asset") schema = documentMetadataSchema;
  if (data.category === "profile-link") {
    if (kind !== "resource") return "Profile links must be resources.";
    schema = profileLinkDataSchema;
  }
  if (!schema) {
    if (contentDataSchemaFor(kind, data)) return null;
    return "Choose a current record category.";
  }
  const result = schema.safeParse(data);
  return result.success
    ? null
    : (result.error.issues[0]?.message ?? "Invalid record details.");
}
