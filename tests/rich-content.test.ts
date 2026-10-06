import { describe, expect, it } from "vitest";
import { markdownDocument } from "../src/features/content/markdownDocument";
import {
  richDocumentError,
  richPlainText,
  validRichDocument,
} from "../shared/rich-content";
import { contentDataError } from "../shared/content";
import { interviewTabs } from "../src/features/interviews/domain";
import { topicSolveFraction } from "../src/features/learn/foundations/Roadmap";
import type { WorkRecord } from "../shared/model";

describe("safe freeform migration and protected preparation", () => {
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
  it("revives a historically hidden or deleted Behavioural tab with original notes", () => {
    const override = {
      id: "old",
      kind: "note",
      title: "People interviews",
      body: "Original principles",
      data: { category: "interview-tab", tabKey: "behavioural", hidden: true },
      version: 2,
      tags: [],
      links: [],
      createdAt: "2026-01-01",
      updatedAt: "2026-01-02",
      deletedAt: "2026-01-02",
    } as WorkRecord;
    expect(
      interviewTabs([override]).find((tab) => tab.key === "behavioural"),
    ).toMatchObject({
      title: "People interviews",
      record: { body: "Original principles" },
    });
  });
  it("counts unique solved roadmap problems once and caps the fill", () => {
    expect(topicSolveFraction(["a", "a", "b"], new Set(["a", "extra"]))).toBe(
      0.5,
    );
    expect(topicSolveFraction(["a"], new Set(["a", "extra"]))).toBe(1);
    expect(topicSolveFraction([], new Set(["a"]))).toBe(0);
  });
  it("exposes direct legacy preparation as ordinary stable tabs and deduplicates materialized or existing notes", () => {
    const appointment = {
      id: "appointment",
      kind: "interview",
      title: "Final round",
      body: "Meeting address",
      data: { prepNotes: "Original advice", questions: "Ask about mentoring" },
      version: 1,
      tags: [],
      links: [],
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
      deletedAt: null,
    } as WorkRecord;
    const before = JSON.stringify(appointment);
    const tab = interviewTabs([appointment]).find(
      (tab) => tab.id === "legacy-prep:appointment",
    );
    expect(tab).toMatchObject({
      title: "Final round notes",
      legacyPreparationId: "appointment",
    });
    expect(tab?.legacyBody).toContain("Original advice");
    expect(tab?.legacyBody).toContain("Ask about mentoring");
    expect(JSON.stringify(appointment)).toBe(before);
    const note = {
      ...appointment,
      id: "saved",
      kind: "note",
      title: "My preparation",
      body: "Saved edits",
      data: { category: "interview-tab", legacyPreparationId: "appointment" },
    } as WorkRecord;
    expect(
      interviewTabs([appointment, note]).filter(
        (tab) => tab.id === "legacy-prep:appointment",
      ),
    ).toHaveLength(1);
    expect(
      interviewTabs([appointment, note]).find(
        (tab) => tab.id === "legacy-prep:appointment",
      )?.record?.id,
    ).toBe("saved");
    const oldPrep = {
      ...note,
      data: { category: "interview-preparation", interviewId: "appointment" },
    } as WorkRecord;
    expect(
      interviewTabs([appointment, oldPrep]).some((tab) =>
        tab.id.startsWith("legacy-prep:"),
      ),
    ).toBe(false);
  });
});
