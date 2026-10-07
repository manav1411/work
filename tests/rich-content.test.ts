import { describe, expect, it } from "vitest";
import { markdownDocument } from "../src/features/content/markdownDocument";
import {
  richDocumentError,
  richPlainText,
  validRichDocument,
} from "../shared/rich-content";
import { contentDataError } from "../shared/content";

describe("structured document content", () => {
  it("retains authored Markdown as structured nested lists, tasks, code, tables and links", () => {
    const document = markdownDocument(
      "# Databases\n\nRead **transactions** and [SQL](https://example.com/sql).\n\n- parent\n  - child\n\n- [x] Read paper\n- Plain task companion\n\n```python\nprint('kept')\n```\n\n| Key | Value |\n| --- | --- |\n| Original | Preserved |\n\n<script>never evaluated</script>\n\n![diagram](https://example.com/image.png)",
    );
    expect(validRichDocument(document)).toBe(true);
    expect(richPlainText(document)).toContain("print('kept')");
    expect(richPlainText(document)).toContain("Original");
    expect(richPlainText(document)).toContain(
      "<script>never evaluated</script>",
    );
    expect(JSON.stringify(document)).toContain('"taskList"');
    expect(JSON.stringify(document)).toContain('"bold"');
  });
  it("accepts the attributes emitted by the installed Tiptap extensions", () => {
    expect(
      validRichDocument({
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { start: 2, type: "i" },
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: "HTTP guide",
                        marks: [
                          {
                            type: "link",
                            attrs: {
                              href: "https://developer.mozilla.org/en-US/docs/Web/HTTP",
                              target: "_blank",
                              rel: "noopener noreferrer nofollow",
                              class: null,
                              title: null,
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableHeader",
                    attrs: {
                      colspan: 1,
                      rowspan: 1,
                      colwidth: null,
                      align: "center",
                    },
                    content: [{ type: "paragraph" }],
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).toBe(true);
  });
  it("accepts saved indentation levels and rejects invalid values", () => {
    for (const indent of [0, 1, 6]) {
      const document = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { indent },
            content: [{ type: "text", text: "Retained note" }],
          },
        ],
      };
      expect(validRichDocument(document)).toBe(true);
      expect(richDocumentError(document)).toBeNull();
      expect(richPlainText(document)).toBe("Retained note");
    }
    for (const indent of [-1, 7, 1.5, "1", null]) {
      const document = {
        type: "doc",
        content: [{ type: "paragraph", attrs: { indent } }],
      };
      expect(validRichDocument(document)).toBe(false);
      expect(richDocumentError(document)).toMatch(/indentation.*invalid/);
    }
  });
  it("rejects dangerous links, arbitrary nodes/attributes, malformed marks and invalid nesting", () => {
    expect(
      validRichDocument({
        type: "doc",
        content: [
          {
            type: "codeBlock",
            attrs: { language: null },
            content: [{ type: "text", text: "code" }],
          },
          {
            type: "orderedList",
            attrs: { start: 1, type: null },
            content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
          },
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableCell",
                    attrs: {
                      colspan: 1,
                      rowspan: 1,
                      colwidth: null,
                      align: null,
                    },
                    content: [{ type: "paragraph" }],
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).toBe(true);
    expect(
      validRichDocument({
        type: "doc",
        content: [{ type: "iframe", attrs: { src: "https://example.com" } }],
      }),
    ).toBe(false);
    expect(
      validRichDocument({
        type: "doc",
        content: [{ type: "paragraph", attrs: { onclick: "evil" } }],
      }),
    ).toBe(false);
    expect(
      validRichDocument({
        type: "doc",
        content: [{ type: "text", text: "wrong parent" }],
      }),
    ).toBe(false);
    for (const marks of [
      [null],
      [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
      [{ type: "link", attrs: { href: "https://secret:pw@example.com" } }],
    ])
      expect(
        validRichDocument({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Unsafe", marks }],
            },
          ],
        }),
      ).toBe(false);
    expect(validRichDocument({ type: "doc", content: "malformed" })).toBe(
      false,
    );
    expect(
      contentDataError("note", {
        category: "content-document",
        scope: "learn",
        richContent: { version: 1, document: markdownDocument("Safe") },
        tabId: "wrong-parent",
      }),
    ).toMatch(/Learning content/);
  });
  it("explains rich content save failures while retaining text from unsupported formatting", () => {
    const unsupported = {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: { src: "https://example.com/chart.png" },
          content: [{ type: "text", text: "Chart notes" }],
        },
      ],
    } as const;
    expect(richDocumentError(unsupported)).toMatch(
      /image block.*not supported/i,
    );
    expect(richPlainText(unsupported)).toContain("Chart notes");

    const unsafeLink = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Keep this label",
              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
            },
          ],
        },
      ],
    } as const;
    expect(richDocumentError(unsafeLink)).toMatch(/HTTP or HTTPS/i);
    expect(richPlainText(unsafeLink)).toContain("Keep this label");
  });
});
