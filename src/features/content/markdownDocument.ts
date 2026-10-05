import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { RichNode } from "../../../shared/rich-content";
import { safeUrl } from "../../../shared/model";

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  depth?: number;
  ordered?: boolean;
  start?: number;
  checked?: boolean | null;
  lang?: string;
  url?: string;
  alt?: string;
}
export function markdownDocument(markdown: string): RichNode {
  const root = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .parse(markdown) as MarkdownNode;
  const convert = (node: MarkdownNode): RichNode[] => {
    const children = () => (node.children ?? []).flatMap(convert);
    const wrap = (
      type: string,
      attrs?: Record<string, unknown>,
    ): RichNode[] => [
      { type, ...(attrs ? { attrs } : {}), content: children() },
    ];
    switch (node.type) {
      case "root":
        return [
          {
            type: "doc",
            content: children().map((child) =>
              child.type === "text"
                ? { type: "paragraph", content: [child] }
                : child,
            ),
          },
        ];
      case "paragraph":
        return wrap("paragraph");
      case "heading":
        return wrap("heading", { level: node.depth ?? 2 });
      case "text":
        return node.value ? [{ type: "text", text: node.value }] : [];
      case "break":
        return [{ type: "hardBreak" }];
      case "thematicBreak":
        return [{ type: "horizontalRule" }];
      case "blockquote":
        return wrap("blockquote");
      case "code":
        return [
          {
            type: "codeBlock",
            attrs: {
              language:
                node.lang?.replace(/[^a-z0-9+#.-]/gi, "").slice(0, 40) ?? "",
            },
            content: node.value ? [{ type: "text", text: node.value }] : [],
          },
        ];
      case "inlineCode":
        return node.value
          ? [{ type: "text", text: node.value, marks: [{ type: "code" }] }]
          : [];
      case "strong":
      case "emphasis":
      case "delete":
        return children().map((child) => ({
          ...child,
          marks: [
            ...(child.marks ?? []),
            {
              type:
                node.type === "strong"
                  ? "bold"
                  : node.type === "emphasis"
                    ? "italic"
                    : "strike",
            },
          ],
        }));
      case "link":
        return children().map((child) => ({
          ...child,
          ...(safeUrl(node.url ?? "")
            ? {
                marks: [
                  ...(child.marks ?? []),
                  {
                    type: "link",
                    attrs: {
                      href: node.url,
                      target: "_blank",
                      rel: "noopener noreferrer",
                    },
                  },
                ],
              }
            : {}),
        }));
      case "list": {
        const task = node.children?.some(
          (child) => typeof child.checked === "boolean",
        );
        return [
          {
            type: task
              ? "taskList"
              : node.ordered
                ? "orderedList"
                : "bulletList",
            ...(node.ordered && !task
              ? { attrs: { start: node.start ?? 1 } }
              : {}),
            content: (node.children ?? []).flatMap((child) =>
              convert(
                task ? { ...child, checked: child.checked ?? false } : child,
              ),
            ),
          },
        ];
      }
      case "listItem":
        return wrap(
          typeof node.checked === "boolean" ? "taskItem" : "listItem",
          typeof node.checked === "boolean"
            ? { checked: node.checked }
            : undefined,
        );
      case "table":
        return [
          {
            type: "table",
            content: (node.children ?? []).map((row, index) => ({
              type: "tableRow",
              content: (row.children ?? []).map((cell) => ({
                type: index === 0 ? "tableHeader" : "tableCell",
                content: [
                  {
                    type: "paragraph",
                    content: (cell.children ?? []).flatMap(convert),
                  },
                ],
              })),
            })),
          },
        ];
      case "image":
        return [
          {
            type: "text",
            text: `${node.alt || "Image"}${node.url ? ` (${node.url})` : ""}`,
          },
        ];
      default:
        return node.value ? [{ type: "text", text: node.value }] : children();
    }
  };
  const document = convert(root)[0];
  return document?.content?.length
    ? document
    : { type: "doc", content: [{ type: "paragraph" }] };
}
