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
              (mark.attrs?.title !== undefined &&
                mark.attrs.title !== null &&
                (typeof mark.attrs.title !== "string" ||
                  mark.attrs.title.length > 500)) ||
              Object.keys(mark.attrs ?? {}).some(
                (key) =>
                  !["href", "target", "rel", "class", "title"].includes(key),
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

/** Explain rich document validation failures without exposing the rejected value. */
export function richDocumentError(value: unknown): string | null {
  if (validRichDocument(value)) return null;
  if (!value || typeof value !== "object" || Array.isArray(value))
    return "This note has an invalid document structure. Its text is still available in the editor.";

  let count = 0;
  const allowedNodeTypes = types;
  const walk = (node: unknown, path: string, depth: number): string | null => {
    if (!node || typeof node !== "object" || Array.isArray(node))
      return `This note has invalid formatting at ${path}.`;
    if (depth > 24) return "This note is nested too deeply to save.";
    if (++count > 5000) return "This note contains too many blocks to save.";
    const item = node as Record<string, unknown>;
    const nodeType =
      typeof item.type === "string" ? item.type : "unknown block";
    const nodePath = `${path} › ${nodeType}`;
    if (!allowedNodeTypes.has(nodeType))
      return `The ${nodeType} block at ${path} is not supported. Paste it as plain text to keep its wording.`;
    const extraKey = Object.keys(item).find(
      (key) => !["type", "text", "attrs", "marks", "content"].includes(key),
    );
    if (extraKey)
      return `The ${extraKey} formatting on ${nodePath} is not supported. Paste as plain text to keep the wording.`;
    if (
      item.text !== undefined &&
      (typeof item.text !== "string" || item.text.length > 70_000)
    )
      return `Text in ${nodePath} is too large to save.`;
    if (item.attrs !== undefined) {
      if (
        !item.attrs ||
        typeof item.attrs !== "object" ||
        Array.isArray(item.attrs)
      )
        return `The formatting on ${nodePath} is invalid.`;
      const attrs = item.attrs as Record<string, unknown>;
      const extraAttr = Object.keys(attrs).find(
        (key) =>
          ![
            "level",
            "start",
            "checked",
            "language",
            "colspan",
            "rowspan",
            "colwidth",
            "type",
            "align",
          ].includes(key),
      );
      if (extraAttr)
        return `The ${extraAttr} formatting on ${nodePath} is not supported. Paste as plain text to keep the wording.`;
      if (
        attrs.level !== undefined &&
        ![1, 2, 3, 4, 5, 6].includes(Number(attrs.level))
      )
        return `The heading level on ${nodePath} is invalid.`;
      if (attrs.checked !== undefined && typeof attrs.checked !== "boolean")
        return `The checklist state on ${nodePath} is invalid.`;
      if (
        attrs.language !== undefined &&
        attrs.language !== null &&
        (typeof attrs.language !== "string" ||
          !/^[a-z0-9+#.-]{0,40}$/i.test(attrs.language))
      )
        return `The code language on ${nodePath} is invalid.`;
      if (
        attrs.type !== undefined &&
        attrs.type !== null &&
        !["1", "a", "A", "i", "I"].includes(String(attrs.type))
      )
        return `The list style on ${nodePath} is unsupported.`;
      if (
        attrs.align !== undefined &&
        attrs.align !== null &&
        !["left", "center", "right"].includes(String(attrs.align))
      )
        return `The table alignment on ${nodePath} is unsupported.`;
      for (const key of ["start", "colspan", "rowspan"])
        if (
          attrs[key] !== undefined &&
          (!Number.isInteger(attrs[key]) ||
            Number(attrs[key]) < 1 ||
            Number(attrs[key]) > 10000)
        )
          return `The ${key} formatting on ${nodePath} is invalid.`;
      if (
        attrs.colwidth !== undefined &&
        attrs.colwidth !== null &&
        (!Array.isArray(attrs.colwidth) ||
          attrs.colwidth.length > 20 ||
          attrs.colwidth.some(
            (width) =>
              !Number.isInteger(width) ||
              Number(width) < 0 ||
              Number(width) > 10000,
          ))
      )
        return `The table column widths on ${nodePath} are invalid.`;
    }
    if (item.marks !== undefined && !Array.isArray(item.marks))
      return `The text formatting on ${nodePath} is invalid.`;
    if (Array.isArray(item.marks)) {
      for (const mark of item.marks) {
        if (!mark || typeof mark !== "object" || Array.isArray(mark))
          return `The text formatting on ${nodePath} is invalid.`;
        const typedMark = mark as { type?: unknown; attrs?: unknown };
        const extraMarkKey = Object.keys(mark).find(
          (key) => !["type", "attrs"].includes(key),
        );
        if (extraMarkKey)
          return `The ${extraMarkKey} text formatting on ${nodePath} is not supported.`;
        if (typeof typedMark.type !== "string" || !marks.has(typedMark.type))
          return `The ${String(typedMark.type ?? "unknown")} text formatting on ${nodePath} is not supported.`;
        if (
          typedMark.attrs !== undefined &&
          (!typedMark.attrs ||
            typeof typedMark.attrs !== "object" ||
            Array.isArray(typedMark.attrs))
        )
          return `The ${typedMark.type} text formatting on ${nodePath} is invalid.`;
        if (typedMark.type === "link") {
          const attrs =
            typedMark.attrs && typeof typedMark.attrs === "object"
              ? (typedMark.attrs as Record<string, unknown>)
              : {};
          try {
            const href = String(attrs.href);
            const url = new URL(href);
            if (
              !["http:", "https:"].includes(url.protocol) ||
              !!url.username ||
              !!url.password
            )
              return `A link in ${nodePath} must use HTTP or HTTPS and cannot contain sign-in details.`;
            if (href.length > 2048)
              return `A link in ${nodePath} is too long to save. Remove the tracking parameters or paste the address as text.`;
            const extraLinkAttr = Object.keys(attrs).find(
              (key) =>
                !["href", "target", "rel", "class", "title"].includes(key),
            );
            if (extraLinkAttr)
              return `The ${extraLinkAttr} link formatting on ${nodePath} is not supported.`;
            if (
              attrs.title !== undefined &&
              attrs.title !== null &&
              (typeof attrs.title !== "string" || attrs.title.length > 500)
            )
              return `The link description in ${nodePath} is too long to save.`;
          } catch {
            return `A link in ${nodePath} has an invalid address. Use an HTTP or HTTPS link.`;
          }
        }
      }
    }
    if (item.content !== undefined && !Array.isArray(item.content))
      return `The content structure inside ${nodePath} is invalid.`;
    if (Array.isArray(item.content)) {
      for (const [index, child] of item.content.entries()) {
        const problem = walk(
          child,
          `${nodePath}, block ${index + 1}`,
          depth + 1,
        );
        if (problem) return problem;
      }
    }
    return null;
  };

  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > 70_000)
      return "This note is too large to save. Keep the text and split it across shorter notes.";
    const problem = walk(value, "document", 0);
    return (
      problem ??
      "This note has formatting the editor cannot save. Paste it as plain text to keep the wording."
    );
  } catch {
    return "This note has an invalid document structure. Its text is still available in the editor.";
  }
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
export function richPlainText(node: unknown): string {
  const visit = (value: unknown): string => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "";
    const item = value as { type?: unknown; text?: unknown; content?: unknown };
    if (item.type === "text")
      return typeof item.text === "string" ? item.text : "";
    if (item.type === "hardBreak") return "\n";
    const children = Array.isArray(item.content) ? item.content.map(visit) : [];
    return children.join(
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
      ].includes(String(item.type))
        ? "\n"
        : "",
    );
  };
  return visit(node);
}
export function storedRichDocument(
  data?: Record<string, unknown>,
): RichNode | undefined {
  const parsed = richContentSchema.safeParse(data?.richContent);
  return parsed.success ? parsed.data.document : undefined;
}
