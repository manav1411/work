import {
  contentMatches,
  orderedRecords,
  type ContentContext,
} from "../../../shared/content";
import { field, type WorkRecord } from "../../../shared/model";
import { storedRichDocument } from "../../../shared/rich-content";
import { useWorkspace } from "../../lib/workspace";
import { RichDocumentEditor } from "./RichDocumentEditor";

export interface SeedResource {
  id: string;
  title: string;
  url: string;
  body?: string;
}
/** Originals remain in backups; one ordered document replaces separate resource and note cards. */
export function ContentPanel({
  context,
  seeds = [],
  record,
  initialBody = "",
}: {
  context: ContentContext;
  seeds?: SeedResource[];
  record?: WorkRecord;
  initialBody?: string;
}) {
  const { records } = useWorkspace();
  const scoped = records.filter((item) => contentMatches(item, context));
  const document =
    scoped.find((item) => item.data.category === "content-document") ?? record;
  const legacy = orderedRecords(
    scoped.filter(
      (item) =>
        ["content-section", "content-resource"].includes(
          String(item.data.category),
        ) && !item.data.hidden,
    ),
  );
  const resources = seeds.flatMap((seed) =>
    scoped.some((item) => item.data.seedResourceId === seed.id)
      ? []
      : [`[${seed.title}](${seed.url})${seed.body ? `\n\n${seed.body}` : ""}`],
  );
  const body = [
    record?.body ?? initialBody,
    ...legacy.map((item) =>
      item.kind === "resource"
        ? `[${item.title}](${field(item, "url")})${item.body ? `\n\n${item.body}` : ""}`
        : `## ${item.title}\n\n${item.body}`,
    ),
    ...resources,
  ]
    .filter(Boolean)
    .join("\n\n");
  const key = [
    context.scope,
    context.track,
    context.topicId,
    context.seedId,
    context.tabId,
    context.tabKey,
    context.interviewId,
  ]
    .filter(Boolean)
    .join(":");
  return (
    <RichDocumentEditor
      key={key}
      record={document}
      initialBody={storedRichDocument(document?.data) ? "" : body}
      input={{
        kind: "note",
        title: record?.title ?? "Notes",
        data: {
          category: "content-document",
          ...context,
          migratedRecordIds: legacy.map((item) => item.id),
          ...record?.data,
        },
      }}
      draftKey={`workspace:${key}`}
      label="Workspace notes"
    />
  );
}
