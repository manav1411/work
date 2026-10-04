import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, type WorkRecord } from "../shared/model";
import {
  BACKUP_MANIFEST_PATH,
  backupStructureError,
  readTarHeader,
  tarHeader,
  tarPadding,
  type WorkBackupManifest,
} from "../shared/backup";
import { previewWorkBackup } from "../src/lib/backup";
import { validateRestoredRelations } from "../worker/import-export";

const record = (
  id = "document",
  data: WorkRecord["data"] = {},
): WorkRecord => ({
  id,
  kind: "asset",
  title: "My résumé",
  body: "Preserved content",
  tags: [],
  links: [],
  data,
  version: 1,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  deletedAt: null,
});
const manifest = (): WorkBackupManifest => ({
  format: "work-backup",
  version: 3,
  exportedAt: "2026-10-05T00:00:00Z",
  preferences: DEFAULT_PREFERENCES,
  records: [record()],
  attachments: [],
  goals: [],
  revisions: [],
});
function archive(
  backup: WorkBackupManifest,
  files: { path: string; data: Uint8Array }[] = [],
) {
  const metadata = new TextEncoder().encode(JSON.stringify(backup));
  const parts: Uint8Array[] = [
    tarHeader(BACKUP_MANIFEST_PATH, metadata.length),
    metadata,
    new Uint8Array(tarPadding(metadata.length)),
  ];
  for (const file of files)
    parts.push(
      tarHeader(file.path, file.data.length),
      file.data,
      new Uint8Array(tarPadding(file.data.length)),
    );
  parts.push(new Uint8Array(1024));
  return new File(parts as Uint8Array<ArrayBuffer>[], "work-backup.tar", {
    type: "application/x-tar",
  });
}

describe("portable streamed backups", () => {
  it("previews a file-inclusive archive larger than 20 MB without reading its complete binary contents", async () => {
    const backup = manifest();
    const files = Array.from({ length: 3 }, (_, index) => ({
      path: `attachments/${String(index).padStart(6, "0")}`,
      data: new Uint8Array(7 * 1024 * 1024),
    }));
    backup.attachments = files.map((file, index) => ({
      id: `file-${index}`,
      recordId: "document",
      filename: `version-${index}.pdf`,
      contentType: "application/pdf",
      size: file.data.length,
      createdAt: "2026-10-01T00:00:00Z",
      path: file.path,
    }));
    const file = archive(backup, files);
    file.arrayBuffer = async () => {
      throw new Error("Whole archive reads are prohibited");
    };
    file.text = async () => {
      throw new Error("Whole archive text reads are prohibited");
    };
    const preview = await previewWorkBackup(file);
    expect(file.size).toBeGreaterThan(20 * 1024 * 1024);
    expect(preview.manifest.attachments).toHaveLength(3);
    expect(preview.entries.get("attachments/000002")?.size).toBe(
      7 * 1024 * 1024,
    );
  });
  it("previews legacy v1/v2 JSON and preserves missing file metadata", async () => {
    for (const version of [1, 2]) {
      const backup = {
        ...manifest(),
        format: "work-export",
        version,
        attachments: [
          {
            id: "lost",
            recordId: "document",
            filename: "unavailable.pdf",
            contentType: "application/pdf",
            size: 8,
            createdAt: "2026-10-01T00:00:00Z",
          },
        ],
      };
      const preview = await previewWorkBackup(
        new File([JSON.stringify(backup)], "old.json"),
      );
      expect(preview.format).toBe("json");
      expect(preview.manifest.attachments[0]).toMatchObject({
        id: "lost",
        missing: true,
        filename: "unavailable.pdf",
      });
      expect(preview.manifest.records[0].body).toBe("Preserved content");
    }
  });
  it("rejects truncated, duplicated or unexplained archive contents before restore", async () => {
    const backup = manifest();
    const valid = archive(backup);
    await expect(
      previewWorkBackup(
        new File([valid.slice(0, valid.size - 512)], "truncated.tar"),
      ),
    ).rejects.toThrow("truncated");
    await expect(
      previewWorkBackup(
        archive(backup, [
          { path: "attachments/000000", data: new Uint8Array(4) },
        ]),
      ),
    ).rejects.toThrow("absent");
    backup.attachments = [
      {
        id: "file",
        recordId: "document",
        filename: "copy.pdf",
        contentType: "application/pdf",
        size: 4,
        createdAt: "2026-10-01T00:00:00Z",
        path: "attachments/000000",
      },
    ];
    await expect(previewWorkBackup(archive(backup))).rejects.toThrow("missing");
    await expect(
      previewWorkBackup(
        archive(backup, [
          { path: "attachments/000000", data: new Uint8Array(4) },
          { path: "attachments/000000", data: new Uint8Array(4) },
        ]),
      ),
    ).rejects.toThrow("duplicate");
  });
  it("verifies TAR checksums and rejects traversal paths and unsupported entry types", () => {
    expect(readTarHeader(tarHeader("attachments/000000", 517))).toEqual({
      path: "attachments/000000",
      size: 517,
    });
    expect(() => tarHeader("../outside", 4)).toThrow("Invalid");
    const header = tarHeader("attachments/000000", 5);
    header[156] = 50;
    expect(() => readTarHeader(header)).toThrow("unsupported");
  });
  it("rejects duplicate IDs and links escaping the backup snapshot", () => {
    const backup = manifest();
    backup.records.push(record());
    expect(backupStructureError(backup)).toContain("duplicate record");
    backup.records = [{ ...record(), links: ["another-owner"] }];
    expect(backupStructureError(backup)).toContain("missing record");
  });
  it("preflights ownership and type of structured references before staging binary files", () => {
    const backup = manifest();
    const doc = record("document", {
      type: "resume",
      primaryAttachmentId: "file",
    });
    const another = record("another");
    const wrongFile = {
      id: "file",
      record_id: "another",
      owner_id: "owner",
      object_key: "owner/another/file",
      filename: "copy.pdf",
      content_type: "application/pdf",
      size: 5,
      created_at: "2026-10-01T00:00:00Z",
    };
    expect(() =>
      validateRestoredRelations([doc, another], [wrongFile], backup.goals),
    ).toThrow("different document");
    expect(() =>
      validateRestoredRelations(
        [record("legacy", { primaryAttachmentId: "file" }), another],
        [wrongFile],
        [],
      ),
    ).not.toThrow();
    expect(() =>
      validateRestoredRelations(
        [
          {
            ...record("reading", {
              category: "content-resource",
              scope: "learn",
              topicId: "missing",
              url: "https://example.com",
            }),
            kind: "resource",
          },
        ],
        [],
        [],
      ),
    ).toThrow("missing record");
  });
});
