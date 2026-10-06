import {
  contentMatches,
  orderedRecords,
  type ContentContext,
} from "../../../shared/content";
import { field, type WorkRecord } from "../../../shared/model";
import {
  storedRichDocument,
  type RichNode,
} from "../../../shared/rich-content";
import { useWorkspace } from "../../lib/workspace";
import { RichDocumentEditor } from "./RichDocumentEditor";
import { markdownDocument } from "./markdownDocument";

export interface SeedResource {
  id: string;
  title: string;
  url: string;
  body?: string;
}
export interface LegacyContentContext {
  context: ContentContext;
  title: string;
  initialBody?: string;
  resources?: SeedResource[];
}
/** Originals remain in backups; one ordered document replaces separate resource and note cards. */
export function ContentPanel({
  context,
  seeds = [],
  record,
  initialBody = "",
  allowBlockReordering = true,
  legacyContexts = [],
}: {
  context: ContentContext;
  seeds?: SeedResource[];
  record?: WorkRecord;
  initialBody?: string;
  allowBlockReordering?: boolean;
  legacyContexts?: LegacyContentContext[];
}) {
  const { records } = useWorkspace();
  const primary = records.filter((item) => contentMatches(item, context));
  const scoped = records.filter((item) =>
    [context, ...legacyContexts.map((group) => group.context)].some((scope) =>
      contentMatches(item, scope),
    ),
  );
  const document =
    primary.find((item) => item.data.category === "content-document") ?? record;
  const primaryLegacy = orderedRecords(
    primary.filter(
      (item) =>
        ["content-section", "content-resource"].includes(
          String(item.data.category),
        ) && !item.data.hidden,
    ),
  );
  const resources = seeds.flatMap((seed) =>
    primary.some((item) => item.data.seedResourceId === seed.id)
      ? []
      : [`[${seed.title}](${seed.url})${seed.body ? `\n\n${seed.body}` : ""}`],
  );
  const body = [
    record?.body ?? initialBody,
    ...primaryLegacy.map((item) =>
      item.kind === "resource"
        ? `[${item.title}](${field(item, "url")})${item.body ? `\n\n${item.body}` : ""}`
        : `## ${item.title}\n\n${item.body}`,
    ),
    ...resources,
  ]
    .filter(Boolean)
    .join("\n\n");
  const migratedRecords = scoped.filter((item) =>
    ["content-document", "content-section", "content-resource"].includes(
      String(item.data.category),
    ),
  );
  const initialDocument = (() => {
    if (!legacyContexts.length || storedRichDocument(document?.data))
      return undefined;
    const content = markdownDocument(body).content ?? [];
    const appendMarkdown = (markdown: string) => {
      if (markdown.trim())
        content.push(...(markdownDocument(markdown).content ?? []));
    };
    for (const group of legacyContexts) {
      const groupRecords = records.filter((item) =>
        contentMatches(item, group.context),
      );
      const groupDocument = groupRecords.find(
        (item) => item.data.category === "content-document",
      );
      const groupSections = orderedRecords(
        groupRecords.filter(
          (item) =>
            item.data.category === "content-section" && !item.data.hidden,
        ),
      );
      const groupResources = orderedRecords(
        groupRecords.filter(
          (item) =>
            item.data.category === "content-resource" && !item.data.hidden,
        ),
      );
      const hasContent = Boolean(
        group.initialBody ||
        groupDocument?.body ||
        storedRichDocument(groupDocument?.data) ||
        groupSections.length ||
        groupResources.length ||
        group.resources?.length,
      );
      if (!hasContent) continue;
      appendMarkdown(`## ${group.title}`);
      appendMarkdown(group.initialBody ?? "");
      if (groupDocument) {
        const rich = storedRichDocument(groupDocument.data);
        content.push(
          ...(rich?.content ??
            markdownDocument(groupDocument.body).content ??
            []),
        );
      }
      for (const section of groupSections) {
        appendMarkdown(`### ${section.title}`);
        appendMarkdown(section.body);
      }
      for (const resource of groupResources) {
        appendMarkdown(
          `- [${resource.title}](${field(resource, "url")})${resource.body ? `\n\n${resource.body}` : ""}`,
        );
      }
      for (const resource of group.resources ?? [])
        if (
          !groupRecords.some((item) => item.data.seedResourceId === resource.id)
        )
          appendMarkdown(`- [${resource.title}](${resource.url})`);
    }
    return content.length
      ? ({ type: "doc", content } satisfies RichNode)
      : undefined;
  })();
  const migratedRecordIds = [
    ...new Set([
      ...primaryLegacy.map((item) => item.id),
      ...migratedRecords
        .filter((item) => item.id !== document?.id)
        .map((item) => item.id),
    ]),
  ];
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
      initialBody={
        storedRichDocument(document?.data) || initialDocument ? "" : body
      }
      initialDocument={initialDocument}
      input={{
        kind: "note",
        title: record?.title ?? "Notes",
        data: {
          category: "content-document",
          ...context,
          migratedRecordIds,
          ...record?.data,
        },
      }}
      draftKey={`workspace:${key}`}
      label="Workspace notes"
      allowBlockReordering={allowBlockReordering}
    />
  );
}
