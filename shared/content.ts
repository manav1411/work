import { z } from "zod";
import { arrayField, field, type RecordKind, type WorkRecord } from "./model";
import { richContentSchema, richDocumentError } from "./rich-content";

export const CONTENT_VERSION = 1;
const id = z.string().max(180);
const order = z.number().finite().min(-1_000_000).max(1_000_000).optional();
const contextShape = {
  scope: z.enum(["learn", "interviews"]),
  track: id.optional(),
  topicId: id.optional(),
  seedId: id.optional(),
  tabId: id.optional(),
  tabKey: z.enum(["behavioural", "technical"]).optional(),
  interviewId: id.optional(),
  applicationId: id.optional(),
};
export interface ContentContext {
  scope: "learn" | "interviews";
  track?: string;
  topicId?: string;
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
    hidden: z.boolean().optional(),
    order,
  })
  .passthrough();
export const learnTopicDataSchema = z
  .object({
    category: z.literal("learn-topic"),
    track: id,
    seedId: id.optional(),
    hidden: z.boolean().optional(),
    order,
  })
  .passthrough();
export const interviewTabDataSchema = z
  .object({
    category: z.literal("interview-tab"),
    tabKey: z.enum(["behavioural", "technical"]).optional(),
    hidden: z.boolean().optional(),
    order,
  })
  .passthrough();
export const contentSectionDataSchema = z
  .object({
    ...contextShape,
    category: z.literal("content-section"),
    order,
  })
  .passthrough();
export const contentDocumentDataSchema = z
  .object({
    ...contextShape,
    category: z.literal("content-document"),
    richContent: richContentSchema.optional(),
    migratedRecordIds: z.array(id).max(500).optional(),
  })
  .passthrough();
export const contentResourceDataSchema = z
  .object({
    ...contextShape,
    category: z.literal("content-resource"),
    technology: z.string().max(100).optional(),
    url: z
      .url()
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
      }, "Use an HTTP or HTTPS URL without embedded credentials."),
    seedResourceId: id.optional(),
    hidden: z.boolean().optional(),
    order,
  })
  .passthrough();
export const interviewPreparationDataSchema = z
  .object({
    category: z.literal("interview-preparation"),
    interviewId: id,
    applicationId: id.optional(),
    storyIds: z.array(id.min(1)).max(100).optional(),
  })
  .passthrough();
export const storyDataSchema = z
  .object({
    situation: z.string().max(70_000).optional(),
    task: z.string().max(70_000).optional(),
    action: z.string().max(70_000).optional(),
    result: z.string().max(70_000).optional(),
    lessons: z.string().max(70_000).optional(),
    reflection: z.string().max(70_000).optional(),
  })
  .passthrough();

/** Validate only the explicitly scoped content owned by these features. */
export function contentDataSchemaFor(
  kind: RecordKind,
  data: Record<string, unknown>,
) {
  if (kind === "story") return storyDataSchema;
  const schemas: Record<string, { kind: RecordKind; schema: z.ZodType }> = {
    "learn-track": { kind: "topic", schema: learnTrackDataSchema },
    "learn-topic": { kind: "topic", schema: learnTopicDataSchema },
    "interview-tab": { kind: "note", schema: interviewTabDataSchema },
    "content-section": { kind: "note", schema: contentSectionDataSchema },
    "content-document": { kind: "note", schema: contentDocumentDataSchema },
    "content-resource": { kind: "resource", schema: contentResourceDataSchema },
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
  if (
    ["content-section", "content-resource", "content-document"].includes(
      String(data.category),
    )
  ) {
    const keys = ["topicId", "seedId", "tabId", "tabKey", "interviewId"].filter(
      (key) => typeof data[key] === "string" && data[key],
    );
    // Deleting a parent detaches its children and leaves them recoverable in a backup.
    if (keys.length > 1)
      return "Content must belong to one topic, tab, or interview.";
    if (
      data.scope === "learn" &&
      keys.some((key) => !["topicId", "seedId"].includes(key))
    )
      return "Learning content must belong to a learning topic.";
    if (
      data.scope === "interviews" &&
      keys.some((key) => ["topicId", "seedId"].includes(key))
    )
      return "Interview content must belong to an interview tab or appointment.";
  }
  return null;
}

export function contentMatches(
  record: WorkRecord,
  context: ContentContext,
): boolean {
  if (record.deletedAt || record.data.scope !== context.scope) return false;
  const keys = [
    "track",
    "topicId",
    "seedId",
    "tabId",
    "tabKey",
    "interviewId",
  ] as const;
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
      !record.deletedAt &&
      record.kind === "note" &&
      record.data.category === "interview-preparation" &&
      field(record, "interviewId") === interview.id,
  );
}
/** Identifiable legacy preparation is displayed in its appointment, never generic imported notes. */
export function legacyInterviewPreparation(interview: WorkRecord): string {
  const main =
    field(interview, "prepNotes") ||
    field(interview, "preparation") ||
    field(interview, "preparationNotes");
  const sections = [
    main,
    ...[
      ["questions", "Questions to ask"],
      ["reflection", "Reflection"],
      ["feedback", "Feedback"],
    ].flatMap(([key, title]) =>
      field(interview, key) ? [`## ${title}\n\n${field(interview, key)}`] : [],
    ),
  ];
  const checklist = arrayField(interview, "checklist");
  if (checklist.length)
    sections.push(
      `## Preparation checklist\n\n${checklist.map((item) => `- [x] ${item}`).join("\n")}`,
    );
  return sections.filter(Boolean).join("\n\n");
}
