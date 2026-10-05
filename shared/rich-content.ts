import { z } from "zod";

export interface RichNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: RichNode[];
}
const types = new Set([
  "doc",
  "paragraph",
  "heading",
  "text",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "codeBlock",
  "blockquote",
  "horizontalRule",
  "hardBreak",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
]);
const marks = new Set([
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "link",
]);
export function validRichDocument(value: unknown): value is RichNode {
  let count = 0;
  const visit = (node: unknown, depth: number): boolean => {
    if (
      !node ||
      typeof node !== "object" ||
      Array.isArray(node) ||
      depth > 24 ||
      ++count > 5000
    )
      return false;
    const item = node as RichNode;
    if (item.content !== undefined && !Array.isArray(item.content))
      return false;
    if (
      Object.keys(item).some(
        (key) => !["type", "text", "attrs", "marks", "content"].includes(key),
      )
    )
      return false;
    if (
      !types.has(item.type) ||
      (item.text !== undefined &&
        (typeof item.text !== "string" || item.text.length > 70_000))
    )
      return false;
    if (item.attrs) {
      if (typeof item.attrs !== "object" || Array.isArray(item.attrs))
        return false;
      const allowed = new Set([
        "level",
        "start",
        "checked",
        "language",
        "colspan",
        "rowspan",
        "colwidth",
        "type",
        "align",
      ]);
      if (Object.keys(item.attrs).some((key) => !allowed.has(key)))
        return false;
      if (
        item.attrs.level !== undefined &&
        ![1, 2, 3, 4, 5, 6].includes(Number(item.attrs.level))
      )
        return false;
      if (
        item.attrs.checked !== undefined &&
        typeof item.attrs.checked !== "boolean"
      )
        return false;
      if (
        item.attrs.language !== undefined &&
        item.attrs.language !== null &&
        (typeof item.attrs.language !== "string" ||
          !/^[a-z0-9+#.-]{0,40}$/i.test(item.attrs.language))
      )
        return false;
      if (
        item.attrs.type !== undefined &&
        item.attrs.type !== null &&
        !["1", "a", "A", "i", "I"].includes(String(item.attrs.type))
      )
        return false;
      if (
        item.attrs.align !== undefined &&
        item.attrs.align !== null &&
        !["left", "center", "right"].includes(String(item.attrs.align))
      )
        return false;
      for (const key of ["start", "colspan", "rowspan"])
        if (
          item.attrs[key] !== undefined &&
          (!Number.isInteger(item.attrs[key]) ||
            Number(item.attrs[key]) < 1 ||
            Number(item.attrs[key]) > 10000)
        )
          return false;
      if (
        item.attrs.colwidth !== undefined &&
        item.attrs.colwidth !== null &&
        (!Array.isArray(item.attrs.colwidth) ||
          item.attrs.colwidth.length > 20 ||
          item.attrs.colwidth.some(
            (value) => !Number.isInteger(value) || value < 0 || value > 10000,
          ))
      )
        return false;
    }
    if (
      item.marks !== undefined &&
      (!Array.isArray(item.marks) ||
        item.marks.length > 8 ||
        item.marks.some((mark) => {
          if (
            !mark ||
            typeof mark !== "object" ||
            Array.isArray(mark) ||
            Object.keys(mark).some((key) => !["type", "attrs"].includes(key))
          )
            return true;
          if (!marks.has(mark.type)) return true;
          if (mark.type !== "link")
            return !!mark.attrs && Object.keys(mark.attrs).length > 0;
          try {
            const url = new URL(String(mark.attrs?.href));
            return (
              !["http:", "https:"].includes(url.protocol) ||
              !!url.username ||
              !!url.password ||
              String(mark.attrs?.href).length > 2048 ||
              Object.keys(mark.attrs ?? {}).some(
                (key) => !["href", "target", "rel", "class"].includes(key),
              )
            );
          } catch {
            return true;
          }
        }))
    )
      return false;
    const blockTypes = [
      "paragraph",
      "heading",
      "bulletList",
      "orderedList",
      "taskList",
      "codeBlock",
      "blockquote",
      "horizontalRule",
      "table",
    ];
    const childrenFor: Record<string, string[]> = {
      doc: blockTypes,
      paragraph: ["text", "hardBreak"],
      heading: ["text", "hardBreak"],
      codeBlock: ["text"],
      bulletList: ["listItem"],
      orderedList: ["listItem"],
      taskList: ["taskItem"],
      listItem: blockTypes,
      taskItem: blockTypes,
      blockquote: blockTypes,
      table: ["tableRow"],
      tableRow: ["tableCell", "tableHeader"],
      tableCell: blockTypes,
      tableHeader: blockTypes,
      text: [],
      horizontalRule: [],
      hardBreak: [],
    };
    if (
      item.content?.some(
        (child) => !child || !childrenFor[item.type].includes(child.type),
      )
    )
      return false;
    if (
      item.type === "text" &&
      (typeof item.text !== "string" || !item.text.length)
    )
      return false;
    if (
      ["listItem", "taskItem", "tableCell", "tableHeader"].includes(
        item.type,
      ) &&
      !item.content?.length
    )
      return false;
    return (
      item.content === undefined ||
      (Array.isArray(item.content) &&
        item.content.every((child) => visit(child, depth + 1)))
    );
  };
  return (
    visit(value, 0) &&
    (value as RichNode).type === "doc" &&
    JSON.stringify(value).length <= 70_000
  );
}
export const richContentSchema = z
  .object({
    version: z.literal(1),
    document: z.custom<RichNode>(
      validRichDocument,
      "Unsupported or unsafe rich document.",
    ),
  })
  .strict();
export function richPlainText(node: RichNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? [])
    .map(richPlainText)
    .join(
      [
        "doc",
        "blockquote",
        "listItem",
        "taskItem",
        "bulletList",
        "orderedList",
        "taskList",
        "table",
        "tableRow",
      ].includes(node.type)
        ? "\n"
        : "",
    );
}
export function storedRichDocument(
  data?: Record<string, unknown>,
): RichNode | undefined {
  const parsed = richContentSchema.safeParse(data?.richContent);
  return parsed.success ? parsed.data.document : undefined;
}
