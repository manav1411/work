import { describe, expect, it } from "vitest";
import {
  cleanNotionTitle,
  parseMarkdownFiles,
} from "../src/features/settings/import";

function file(path: string, content: string | Uint8Array, type = ""): File {
  const item = new File(
    [typeof content === "string" ? content : (content.buffer as ArrayBuffer)],
    path.split("/").pop()!,
    { type, lastModified: Date.parse("2025-01-05T12:00:00Z") },
  );
  Object.defineProperty(item, "webkitRelativePath", {
    value: path.includes("/") ? path : "",
  });
  return item;
}
const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);
const pdf = "%PDF-1.7\nSynthetic test document\n";

describe("private Markdown import preview", () => {
  it("retains historical content and resolves directory links and attachments", async () => {
    const source =
      "# Python notes 0123456789abcdef0123456789abcdef\n\nCreated: 2025-01-02\n\n[Next](Nested/Next%20note.md#example)\n\n![Example](images/example.png)\n\n```python\nprint(42)\n```";
    const preview = await parseMarkdownFiles([
      file("Export/Python.md", source),
      file("Export/Nested/Next note.md", "# Next note\nUseful notes"),
      file("Export/images/example.png", png, "image/png"),
    ]);
    expect(preview.errors).toEqual([]);
    expect(preview.records).toHaveLength(2);
    expect(preview.stats.attachments).toBe(1);
    const first = preview.records.find(
      (item) => item.record.title === "Python notes",
    )!;
    const next = preview.records.find(
      (item) => item.record.title === "Next note",
    )!;
    expect(first.record.body).toContain(
      `work-source://${encodeURIComponent(next.sourceId)}#example`,
    );
    expect(first.record.links).toEqual([next.sourceId]);
    expect(first.record.body).toContain("work-attachment://example.png");
    expect(first.record.body).toContain("print(42)");
    expect(first.record.data?.originalMarkdown).toBe(source);
    expect(first.record.data?.sourceDate).toBe("2025-01-02");
    expect(first.record.data?.originalPath).toBe("Python.md");
    expect(first.attachments[0].base64).toBe(btoa(String.fromCharCode(...png)));
  });
  it("produces stable fingerprints and changes them when note or attachment content changes", async () => {
    const note = file("Export/Note.md", "# Note\n![x](a.png)");
    const image = file("Export/a.png", png);
    const a = await parseMarkdownFiles([note, image]);
    const b = await parseMarkdownFiles([image, note]);
    expect(a.records[0].sourceId).toBe(b.records[0].sourceId);
    expect(a.records[0].hash).toBe(b.records[0].hash);
    const updated = new Uint8Array([...png, 4]);
    const c = await parseMarkdownFiles([note, file("Export/a.png", updated)]);
    expect(c.records[0].sourceId).toBe(a.records[0].sourceId);
    expect(c.records[0].hash).not.toBe(a.records[0].hash);
  });
  it("never picks an arbitrary basename match", async () => {
    const result = await parseMarkdownFiles([
      file("Export/Note.md", "# Note\n![x](missing/example.png)"),
      file("Export/a/example.png", png),
      file("Export/b/example.png", png),
    ]);
    expect(result.records[0].attachments).toEqual([]);
    expect(result.records[0].record.body).toContain("missing/example.png");
    expect(
      result.warnings.some((value) => value.includes("matches 2 files")),
    ).toBe(true);
    expect(result.stats.unresolvedLinks).toBe(1);
  });
  it("resolves ../ links inside the selected folder but rejects escape paths and malformed encoding", async () => {
    const result = await parseMarkdownFiles([
      file(
        "Export/Nested/Note.md",
        "# Note\n[Parent](../Parent.md)\n[Escape](../../secret.md)\n[Bad](%E0%A4%A)",
      ),
      file("Export/Parent.md", "# Parent"),
    ]);
    expect(result.records[0].record.links).toHaveLength(1);
    expect(
      result.warnings.some((value) => value.includes("../../secret.md")),
    ).toBe(true);
    expect(result.warnings.some((value) => value.includes("%E0%A4%A"))).toBe(
      true,
    );
  });
  it("supports Markdown reference links without changing external URLs", async () => {
    const result = await parseMarkdownFiles([
      file(
        "Export/Note.md",
        '# Note\n[Read][next]\n\n[next]: Next.md "title"\n[Docs](https://example.com/a?b=1)',
      ),
      file("Export/Next.md", "# Next"),
    ]);
    expect(result.records[0].record.body).toContain("[next]: work-source://");
    expect(result.records[0].record.body).toContain(
      "https://example.com/a?b=1",
    );
  });
  it("preserves Markdown examples inside fenced and inline code", async () => {
    const raw =
      "# Note\n```markdown\n[Example](Next.md)\n```\n\n`[Inline](Next.md)`\n\n[Real](Next.md)";
    const result = await parseMarkdownFiles([
      file("Export/Note.md", raw),
      file("Export/Next.md", "# Next"),
    ]);
    expect(result.records[0].record.body).toContain(
      "```markdown\n[Example](Next.md)\n```",
    );
    expect(result.records[0].record.body).toContain("`[Inline](Next.md)`");
    expect(result.records[0].record.body).toContain("[Real](work-source://");
  });
  it("attaches each selected file once even when fragments differ", async () => {
    const result = await parseMarkdownFiles([
      file(
        "Export/Note.md",
        "# Note\n[One](a.pdf#page=1)\n[Two](a.pdf#page=2)",
      ),
      file("Export/a.pdf", pdf),
    ]);
    expect(result.records[0].attachments).toHaveLength(1);
    expect(result.records[0].record.body).toContain(
      "work-attachment://a.pdf#page=2",
    );
  });
  it("imports a standalone résumé PDF as a versioned asset", async () => {
    const result = await parseMarkdownFiles([
      file("resume.pdf", pdf, "application/pdf"),
    ]);
    expect(result.errors).toEqual([]);
    expect(result.records[0].record.kind).toBe("asset");
    expect(result.records[0].record.data?.subtype).toBe("resume");
    expect(result.records[0].attachments[0].contentType).toBe(
      "application/pdf",
    );
  });
  it("reports corrupt files, unsupported CSVs and ambiguous selections", async () => {
    const corrupt = await parseMarkdownFiles([
      file("Export/Note.md", "# Note\n![x](a.png)"),
      file("Export/a.png", "not a png"),
      file("Export/Database.csv", "a,b"),
    ]);
    expect(
      corrupt.errors.some((value) => value.includes("contents do not match")),
    ).toBe(true);
    expect(corrupt.warnings.some((value) => value.includes("CSV"))).toBe(true);
    const duplicate = await parseMarkdownFiles([
      file("same.md", "# One"),
      file("same.md", "# Two"),
    ]);
    expect(duplicate.records).toHaveLength(0);
    expect(
      duplicate.errors.some((value) => value.includes("share this path")),
    ).toBe(true);
  });
  it("rejects oversized selections before reading private contents", async () => {
    const fake = file("large.md", "# Synthetic");
    Object.defineProperty(fake, "size", { value: 21 * 1024 * 1024 });
    const result = await parseMarkdownFiles([fake]);
    expect(result.records).toEqual([]);
    expect(result.errors[0]).toContain("20 MB");
  });
});
it("cleans export identifiers without inventing titles", () => {
  expect(
    cleanNotionTitle("Career plan abcdef0123456789abcdef0123456789.md"),
  ).toBe("Career plan");
  expect(cleanNotionTitle("Useful notes.md")).toBe("Useful notes");
});
