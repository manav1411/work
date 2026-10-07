import { contentMatches, type ContentContext } from "../../../shared/content";
import { type WorkRecord } from "../../../shared/model";
import { useWorkspace } from "../../lib/workspace";
import { RichDocumentEditor } from "./RichDocumentEditor";
export interface SeedResource {
  id: string;
  title: string;
  url: string;
  body?: string;
}
export function ContentPanel({
  context,
  seeds = [],
  record,
  initialBody = "",
  allowBlockReordering = true,
}: {
  context: ContentContext;
  seeds?: SeedResource[];
  record?: WorkRecord;
  initialBody?: string;
  allowBlockReordering?: boolean;
}) {
  const { records } = useWorkspace();
  const document =
    records.find(
      (item) =>
        item.data.category === "content-document" &&
        contentMatches(item, context),
    ) ?? record;
  const key = [
    context.scope,
    context.track,
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
      initialBody={[
        initialBody,
        ...seeds.map(
          (seed) =>
            `[${seed.title}](${seed.url})${seed.body ? `\n\n${seed.body}` : ""}`,
        ),
      ]
        .filter(Boolean)
        .join("\n\n")}
      input={{
        kind: "note",
        title: record?.title ?? "Notes",
        data: document
          ? document.data
          : { category: "content-document", ...context },
      }}
      draftKey={`workspace:${key}`}
      label={context.scope === "learn" ? "Study notes" : "Preparation notes"}
      placeholder="Capture an idea, save a link, or type / for blocks…"
      allowBlockReordering={allowBlockReordering}
    />
  );
}
