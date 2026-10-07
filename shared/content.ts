import { z } from "zod";
import { field, type RecordKind, type WorkRecord } from "./model";
import { richContentSchema, richDocumentError } from "./rich-content";

export const CONTENT_VERSION = 1;
const id = z.string().max(180);
const order = z.number().finite().min(-1_000_000).max(1_000_000).optional();
const contextShape = {
  scope: z.enum(["learn", "interviews"]),
  track: id.optional(),
  seedId: id.optional(),
  tabId: id.optional(),
  tabKey: z.enum(["behavioural", "technical"]).optional(),
  interviewId: id.optional(),
  applicationId: id.optional(),
};
export interface ContentContext {
  scope: "learn" | "interviews";
  track?: string;
  seedId?: string;
  tabId?: string;
  tabKey?: "behavioural" | "technical";
  interviewId?: string;
  applicationId?: string;
}
export const learnTrackDataSchema = z
  .object({
    category: z.literal("learn-track"),
    seedId: id.optional(),
    richContent: richContentSchema.optional(),
    hidden: z.boolean().optional(),
    order,
  })
  .strict();
export const interviewTabDataSchema = z
  .object({
    category: z.literal("interview-tab"),
    tabKey: z.enum(["behavioural", "technical"]).optional(),
    richContent: richContentSchema.optional(),
    hidden: z.boolean().optional(),
    order,
  })
  .strict();
export const contentDocumentDataSchema = z
  .object({
    ...contextShape,
    category: z.literal("content-document"),
    richContent: richContentSchema.optional(),
  })
  .strict();
export const interviewPreparationDataSchema = z
  .object({
    richContent: richContentSchema.optional(),
    order,
    category: z.literal("interview-preparation"),
    interviewId: id,
    applicationId: id.optional(),
    storyIds: z.array(id.min(1)).max(100).optional(),
  })
  .strict();
export const storyDataSchema = z
  .object({
    order,
    situation: z.string().max(70_000).optional(),
    task: z.string().max(70_000).optional(),
    action: z.string().max(70_000).optional(),
    result: z.string().max(70_000).optional(),
    lessons: z.string().max(70_000).optional(),
  })
  .strict();

/** Validate only the explicitly scoped content owned by these features. */
export function contentDataSchemaFor(
  kind: RecordKind,
  data: Record<string, unknown>,
) {
  if (kind === "story") return storyDataSchema;
  const schemas: Record<string, { kind: RecordKind; schema: z.ZodType }> = {
    "learn-track": { kind: "topic", schema: learnTrackDataSchema },
    "interview-tab": { kind: "note", schema: interviewTabDataSchema },
    "content-document": { kind: "note", schema: contentDocumentDataSchema },
    "interview-preparation": {
      kind: "note",
      schema: interviewPreparationDataSchema,
    },
  };
  const entry =
    typeof data.category === "string" ? schemas[data.category] : undefined;
  return entry ? (entry.kind === kind ? entry.schema : z.never()) : null;
}
export function contentDataError(
  kind: RecordKind,
  data: Record<string, unknown>,
): string | null {
  if (
    data.richContent !== undefined &&
    !richContentSchema.safeParse(data.richContent).success
  ) {
    const content = data.richContent;
    const document =
      content && typeof content === "object" && !Array.isArray(content)
        ? (content as Record<string, unknown>).document
        : undefined;
    if (!content || typeof content !== "object" || Array.isArray(content))
      return "This note has an invalid document structure. Its text is still available in the editor.";
    const rich = content as Record<string, unknown>;
    if (rich.version !== 1)
      return "This note uses an unsupported saved format. Its text is still available in the editor.";
    if (Object.keys(rich).some((key) => !["version", "document"].includes(key)))
      return "This note contains unsupported saved formatting. Its text is still available in the editor.";
    return richDocumentError(document) ?? "This note could not be saved.";
  }
  const schema = contentDataSchemaFor(kind, data);
  if (!schema) return null;
  const result = schema.safeParse(data);
  if (!result.success)
    return result.error.issues[0]?.message ?? "Invalid content data.";
  if (["content-document"].includes(String(data.category))) {
    const keys = ["seedId", "tabId", "tabKey", "interviewId"].filter(
      (key) => typeof data[key] === "string" && data[key],
    );
    if (keys.length > 1)
      return "Content must belong to one topic, tab, or interview.";
    if (data.scope === "learn" && keys.some((key) => !["seedId"].includes(key)))
      return "Learning content must belong to a learning topic.";
    if (
      data.scope === "interviews" &&
      keys.some((key) => ["seedId"].includes(key))
    )
      return "Interview content must belong to an interview tab or appointment.";
  }
  return null;
}

export function contentMatches(
  record: WorkRecord,
  context: ContentContext,
): boolean {
  if (record.data.scope !== context.scope) return false;
  const keys = ["track", "seedId", "tabId", "tabKey", "interviewId"] as const;
  return keys.every(
    (key) => (record.data[key] || undefined) === (context[key] || undefined),
  );
}
export function orderedRecords(records: WorkRecord[]): WorkRecord[] {
  return [...records].sort(
    (a, b) =>
      (typeof a.data.order === "number" ? a.data.order : 100_000) -
        (typeof b.data.order === "number" ? b.data.order : 100_000) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
}
export function interviewPreparation(
  records: WorkRecord[],
  interview: WorkRecord,
): WorkRecord | undefined {
  return records.find(
    (record) =>
      record.kind === "note" &&
      record.data.category === "interview-preparation" &&
      field(record, "interviewId") === interview.id,
  );
}
