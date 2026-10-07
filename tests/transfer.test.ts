import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES } from "../shared/model";
import { makeRecord } from "../src/lib/demo";
import { readWorkspacePackage } from "../src/lib/workspace-transfer";
import {
  tarHeader,
  tarPadding,
  type WorkspaceManifest,
} from "../shared/transfer";
function pkg(
  manifest: WorkspaceManifest,
  entries: { path: string; bytes: Uint8Array }[] = [],
) {
  const metadata = new TextEncoder().encode(JSON.stringify(manifest));
  const parts: BlobPart[] = [];
  for (const entry of [{ path: "workspace.json", bytes: metadata }, ...entries])
    parts.push(
      tarHeader(entry.path, entry.bytes.length).buffer as ArrayBuffer,
      entry.bytes.buffer as ArrayBuffer,
      new Uint8Array(tarPadding(entry.bytes.length)),
    );
  parts.push(new Uint8Array(1024));
  return new File(parts, "workspace.tar", { type: "application/x-tar" });
}
const manifest = (): WorkspaceManifest => ({
  format: "work-workspace",
  version: 1,
  exportedAt: new Date().toISOString(),
  records: [
    makeRecord({
      kind: "asset",
      title: "Current document",
      data: { type: "document" },
    }),
  ],
  goals: [],
  preferences: { ...DEFAULT_PREFERENCES },
  attachments: [],
});
describe("current workspace files", () => {
  it("reads complete current binary files without decoding or changing them", async () => {
    const current = manifest(),
      bytes = new Uint8Array([0, 255, 14, 128]);
    current.attachments = [
      {
        id: crypto.randomUUID(),
        recordId: current.records[0].id,
        filename: "data.json",
        contentType: "application/json",
        size: bytes.length,
        createdAt: new Date().toISOString(),
        path: "files/000000",
      },
    ];
    const upload = await readWorkspacePackage(
      pkg(current, [{ path: "files/000000", bytes }]),
    );
    expect(
      new Uint8Array(await upload.files.values().next().value!.arrayBuffer()),
    ).toEqual(bytes);
  });
  it("rejects earlier backup formats and legacy metadata", async () => {
    const current = manifest();
    await expect(
      readWorkspacePackage(
        pkg({
          ...current,
          format: "work-backup",
        } as unknown as WorkspaceManifest),
      ),
    ).rejects.toThrow();
    current.records[0].data.type = "cover-letter";
    await expect(readWorkspacePackage(pkg(current))).rejects.toThrow();
  });
  it("rejects missing, duplicate, and unlisted archive entries", async () => {
    const current = manifest();
    current.attachments = [
      {
        id: crypto.randomUUID(),
        recordId: current.records[0].id,
        filename: "current.txt",
        contentType: "text/plain",
        size: 1,
        createdAt: new Date().toISOString(),
        path: "files/000000",
      },
    ];
    await expect(readWorkspacePackage(pkg(current))).rejects.toThrow("Missing");
    const entry = { path: "files/000000", bytes: new Uint8Array([65]) };
    await expect(
      readWorkspacePackage(pkg(current, [entry, entry])),
    ).rejects.toThrow("duplicate");
    await expect(
      readWorkspacePackage(pkg(manifest(), [entry])),
    ).rejects.toThrow("do not match");
  });
  it("rejects corrupt headers, traversal paths and truncated archives", async () => {
    const current = pkg(manifest());
    const bytes = new Uint8Array(await current.arrayBuffer());
    bytes[0] ^= 1;
    await expect(
      readWorkspacePackage(new File([bytes], "bad.tar")),
    ).rejects.toThrow("invalid");
    expect(() => tarHeader("../files/000000", 1)).toThrow();
    await expect(
      readWorkspacePackage(
        new File([await current.slice(0, 600).arrayBuffer()], "truncated.tar"),
      ),
    ).rejects.toThrow("truncated");
  });
});
