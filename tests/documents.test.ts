import { describe, expect, it, vi } from "vitest";
import type { Attachment, WorkRecord } from "../shared/model";
import {
  DOCX_TYPE,
  DocumentFileSaveError,
  documentMetadataSchema,
  documentPreviewKind,
  documentRecords,
  documentUploadError,
  primaryDocumentFile,
  profileLinkDataSchema,
  saveDocumentFile,
} from "../shared/documents";
import { validateFile } from "../worker/files";
import { getDocumentLinks } from "../src/features/assets/documentLinks";

const record = (id: string, data: WorkRecord["data"] = {}): WorkRecord => ({
  id,
  kind: "asset",
  title: id,
  body: "Current authored text",
  tags: [],
  links: [],
  data,
  version: 1,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
});
const file = (
  id: string,
  recordId = "resume",
  contentType = "application/pdf",
): Attachment => ({
  id,
  recordId,
  filename: `${id}.pdf`,
  contentType,
  size: 5,
  createdAt: "2026-10-01T00:00:00Z",
});

function docx(
  names = ["[Content_Types].xml", "_rels/.rels", "word/document.xml"],
) {
  // A stored ZIP fixture isolates archive structure from compression dependencies.
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const name of names) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode("<xml/>");
    const entry = new Uint8Array(30 + nameBytes.length + data.length);
    const view = new DataView(entry.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true);
    entry.set(nameBytes, 30);
    entry.set(data, 30 + nameBytes.length);
    local.push(entry);
    const directoryEntry = new Uint8Array(46 + nameBytes.length);
    const directoryView = new DataView(directoryEntry.buffer);
    directoryView.setUint32(0, 0x02014b50, true);
    directoryView.setUint16(6, 20, true);
    directoryView.setUint32(20, data.length, true);
    directoryView.setUint32(24, data.length, true);
    directoryView.setUint16(28, nameBytes.length, true);
    directoryView.setUint32(42, offset, true);
    directoryEntry.set(nameBytes, 46);
    central.push(directoryEntry);
    offset += entry.length;
  }
  const directorySize = central.reduce(
    (total, entry) => total + entry.length,
    0,
  );
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, names.length, true);
  endView.setUint16(10, names.length, true);
  endView.setUint32(12, directorySize, true);
  endView.setUint32(16, offset, true);
  const bytes = new Uint8Array(offset + directorySize + 22);
  let position = 0;
  for (const entry of [...local, ...central, end]) {
    bytes.set(entry, position);
    position += entry.length;
  }
  return bytes;
}

describe("independent document library", () => {
  it("includes uploaded named documents without application binding", () => {
    const variant = record("Resume for Google", {
      primaryAttachmentId: "variant-file",
    });
    const resume = record("resume", { type: "resume", documentDefault: true });
    expect(
      documentRecords([
        variant,
        resume,
        { ...record("application"), kind: "application" },
      ]),
    ).toEqual([resume, variant]);
    expect(variant.body).toBe("Current authored text");
  });
  it("resolves primary files only within the selected asset and does not revive a missing pointer", () => {
    const own = file("old");
    const other = file("new", "another-record");
    expect(
      primaryDocumentFile(record("resume", { primaryAttachmentId: "new" }), [
        own,
        other,
      ]),
    ).toBeUndefined();
    expect(
      primaryDocumentFile(record("resume", { primaryAttachmentId: "old" }), [
        own,
        other,
      ]),
    ).toEqual(own);
    expect(primaryDocumentFile(record("resume"), [other, own])).toBeUndefined();
  });
  it("does not offer empty resume or cover-letter records as document links", () => {
    const emptyResume = record("empty-resume", {
      type: "resume",
      nativeDocument: true,
    });
    const linkedResume = record("linked-resume", {
      type: "resume",
      primaryAttachmentId: "resume-file",
    });
    expect(getDocumentLinks([emptyResume])).toEqual({
      resume: {},
      coverLetter: {},
    });
    expect(getDocumentLinks([emptyResume, linkedResume]).resume).toEqual({
      record: linkedResume,
    });
  });
  it("previews only safe image/PDF formats and offers other files as downloads", () => {
    expect(documentPreviewKind(file("pdf"))).toBe("pdf");
    expect(documentPreviewKind(file("notes", "resume", "text/markdown"))).toBe(
      "text",
    );
    expect(
      documentPreviewKind(file("data", "resume", "application/json")),
    ).toBe("text");
    expect(documentPreviewKind(file("image", "resume", "image/png"))).toBe(
      "image",
    );
    expect(documentPreviewKind(file("word", "resume", DOCX_TYPE))).toBe(
      "download",
    );
    expect(documentPreviewKind(file("svg", "resume", "image/svg+xml"))).toBe(
      "download",
    );
    expect(
      documentUploadError({
        name: "large.pdf",
        type: "application/pdf",
        size: 11 * 1024 * 1024,
      }),
    ).toContain("10 MB");
  });
  it("preserves generic source URLs and safe profile destinations, rejecting active or credential-bearing URLs", () => {
    expect(
      documentMetadataSchema.safeParse({
        type: "document",
        sourceUrl: "https://example.com/source/resume",
        primaryAttachmentId: "own-file",
      }).success,
    ).toBe(true);
    expect(
      documentMetadataSchema.safeParse({
        type: "document",
        sourceUrl: "https://user:secret@example.com/source",
      }).success,
    ).toBe(false);
    expect(
      profileLinkDataSchema.safeParse({
        scope: "documents",
        category: "profile-link",
        url: "javascript:alert(1)",
      }).success,
    ).toBe(false);
    expect(
      profileLinkDataSchema.safeParse({
        scope: "documents",
        category: "profile-link",
        url: "https://user:password@example.com/",
      }).success,
    ).toBe(false);
  });
});

describe("recoverable file replacement", () => {
  it("retains an uploaded copy after pointer failure and retries selection without another upload", async () => {
    const previous = record("resume", { primaryAttachmentId: "old" });
    const next = file("new");
    const upload = vi.fn(async () => next);
    const select = vi
      .fn()
      .mockRejectedValueOnce(new Error("Metadata save interrupted"))
      .mockResolvedValue(undefined);
    let uploaded: Attachment | undefined;
    try {
      await saveDocumentFile({ upload, select });
    } catch (failure) {
      expect(failure).toBeInstanceOf(DocumentFileSaveError);
      uploaded = (failure as DocumentFileSaveError).attachment;
    }
    expect(previous.data.primaryAttachmentId).toBe("old");
    expect(uploaded).toEqual(next);
    await expect(
      saveDocumentFile({ upload, select }, uploaded),
    ).resolves.toEqual(next);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledTimes(2);
  });
  it("never changes the primary pointer when upload fails", async () => {
    const select = vi.fn();
    await expect(
      saveDocumentFile({
        upload: async () => {
          throw new Error("Disconnected");
        },
        select,
      }),
    ).rejects.toMatchObject({ attachment: undefined });
    expect(select).not.toHaveBeenCalled();
  });
});

describe("DOCX uploads", () => {
  it("accepts a document package and rejects ZIPs disguised as DOCX, macros and unsafe paths", () => {
    expect(() => validateFile(DOCX_TYPE, docx())).not.toThrow();
    for (const names of [
      ["file.txt"],
      [
        "[Content_Types].xml",
        "_rels/.rels",
        "word/document.xml",
        "word/vbaProject.bin",
      ],
      [
        "[Content_Types].xml",
        "_rels/.rels",
        "word/document.xml",
        "../outside.xml",
      ],
    ])
      expect(() => validateFile(DOCX_TYPE, docx(names))).toThrow(
        "contents do not match",
      );
    expect(() =>
      validateFile(DOCX_TYPE, new TextEncoder().encode("%PDF-1.7")),
    ).toThrow("contents do not match");
    const malformed = docx();
    malformed[malformed.length - 6] = 255;
    expect(() => validateFile(DOCX_TYPE, malformed)).toThrow(
      "contents do not match",
    );
  });
});
