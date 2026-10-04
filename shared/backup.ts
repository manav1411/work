import { z } from "zod";
import { goalBackupSchema, type Goal } from "./goals";
import {
  RECORD_KINDS,
  type Attachment,
  type RecordRevision,
  type UserPreferences,
  type WorkRecord,
} from "./model";

export const BACKUP_MANIFEST_PATH = "work-manifest.json";
export const BACKUP_MANIFEST_MAX_BYTES = 32 * 1024 * 1024;
export const TAR_BLOCK_BYTES = 512;
export interface BackupAttachment extends Attachment {
  path?: string;
  missing?: boolean;
}
export interface WorkBackupManifest {
  format: "work-backup";
  version: 3;
  exportedAt: string;
  records: WorkRecord[];
  preferences: UserPreferences;
  attachments: BackupAttachment[];
  revisions: RecordRevision[];
  goals: Goal[];
  connectors?: unknown;
}
export interface BackupRestoreResult {
  restored: number;
  attachments: number;
  warnings: string[];
}

const identifier = z.string().min(1).max(120);
const metadataFields = {
  exportedAt: z.string().datetime(),
  records: z
    .array(
      z
        .object({
          id: identifier,
          kind: z.enum(RECORD_KINDS),
          title: z.string().trim().min(1).max(240),
          body: z.string().max(500_000),
          tags: z.array(z.string().max(60)).max(40),
          links: z.array(identifier).max(100),
          data: z
            .record(z.string(), z.unknown())
            .refine((value) => JSON.stringify(value).length <= 100_000),
          version: z.number().int().positive(),
          createdAt: z.string().datetime(),
          updatedAt: z.string().datetime(),
          deletedAt: z.string().datetime().nullable(),
        })
        .strict(),
    )
    .max(5000),
  // The server applies its complete preferences schema before creating a session.
  preferences: z
    .record(z.string(), z.unknown())
    .transform((value) => value as unknown as UserPreferences),
  revisions: z
    .array(
      z
        .object({
          id: z.string().max(250),
          recordId: identifier,
          version: z.number().int().positive(),
          title: z.string().max(240),
          body: z.string().max(500_000),
          tags: z.array(z.string()),
          links: z.array(z.string()),
          data: z.record(z.string(), z.unknown()),
          createdAt: z.string().datetime(),
        })
        .strict(),
    )
    .max(50_000)
    .default([]),
  goals: z.array(goalBackupSchema).max(1000).default([]),
  connectors: z.unknown().optional(),
};
const attachmentFields = {
  id: identifier,
  recordId: identifier,
  filename: z.string().min(1).max(240),
  contentType: z.string().max(100),
  size: z
    .number()
    .int()
    .min(0)
    .max(10 * 1024 * 1024),
  createdAt: z.string().datetime(),
  missing: z.boolean().optional(),
};
export const workBackupManifestSchema = z
  .object({
    format: z.literal("work-backup"),
    version: z.literal(3),
    ...metadataFields,
    attachments: z
      .array(
        z
          .object({
            ...attachmentFields,
            path: z
              .string()
              .regex(/^attachments\/\d{6}$/)
              .optional(),
          })
          .strict(),
      )
      .max(5000),
  })
  .strict();
export const legacyWorkBackupSchema = z
  .object({
    format: z.literal("work-export"),
    version: z.union([z.literal(1), z.literal(2)]),
    ...metadataFields,
    attachments: z
      .array(
        z
          .object({
            ...attachmentFields,
            base64: z.string().max(14_000_000).optional(),
          })
          .strict(),
      )
      .max(5000),
  })
  .strict();

/** Closed snapshots must not borrow another workspace's IDs during restore. */
export function backupStructureError(
  manifest: Pick<
    WorkBackupManifest,
    "records" | "attachments" | "goals" | "revisions"
  >,
): string | null {
  const recordIds = new Set(manifest.records.map((record) => record.id));
  if (recordIds.size !== manifest.records.length)
    return "The backup contains duplicate record IDs.";
  if (
    new Set(manifest.attachments.map((file) => file.id)).size !==
    manifest.attachments.length
  )
    return "The backup contains duplicate attachment IDs.";
  if (
    new Set(manifest.goals.map((goal) => goal.id)).size !==
    manifest.goals.length
  )
    return "The backup contains duplicate goal IDs.";
  if (
    manifest.records.some((record) =>
      record.links.some((link) => !recordIds.has(link)),
    )
  )
    return "The backup links to a missing record.";
  if (manifest.attachments.some((file) => !recordIds.has(file.recordId)))
    return "An attachment belongs to a missing record.";
  if (manifest.revisions.some((revision) => !recordIds.has(revision.recordId)))
    return "A revision belongs to a missing record.";
  return null;
}

export function tarPadding(size: number): number {
  return (TAR_BLOCK_BYTES - (size % TAR_BLOCK_BYTES)) % TAR_BLOCK_BYTES;
}

/** A deliberately small USTAR writer: ordinary files, ASCII paths, no extraction. */
export function tarHeader(
  path: string,
  size: number,
  timestamp = 0,
): Uint8Array {
  if (
    !/^[a-zA-Z0-9._/-]{1,99}$/.test(path) ||
    path.startsWith("/") ||
    path.split("/").includes("..") ||
    !Number.isSafeInteger(size) ||
    size < 0 ||
    size > 0o77777777777
  )
    throw new Error("Invalid archive entry.");
  const header = new Uint8Array(TAR_BLOCK_BYTES);
  const encoder = new TextEncoder();
  const write = (offset: number, value: string) =>
    header.set(encoder.encode(value), offset);
  const octal = (value: number, width: number) =>
    value.toString(8).padStart(width - 1, "0") + "\0";
  write(0, path);
  write(100, "0000600\0");
  write(108, "0000000\0");
  write(116, "0000000\0");
  write(124, octal(size, 12));
  write(136, octal(Math.max(0, Math.floor(timestamp)), 12));
  header.fill(32, 148, 156);
  write(156, "0");
  write(257, "ustar\0");
  write(263, "00");
  const checksum = header.reduce((total, byte) => total + byte, 0);
  write(148, checksum.toString(8).padStart(6, "0") + "\0 ");
  return header;
}

export function readTarHeader(
  header: Uint8Array,
): { path: string; size: number } | null {
  if (header.length !== TAR_BLOCK_BYTES)
    throw new Error("The backup archive is truncated.");
  if (header.every((byte) => byte === 0)) return null;
  const decode = (offset: number, length: number) =>
    new TextDecoder()
      .decode(header.subarray(offset, offset + length))
      .split("\0")[0];
  const octal = (offset: number, length: number) => {
    const text = decode(offset, length).trim();
    if (!/^[0-7]+$/.test(text))
      throw new Error("The archive contains an invalid size or checksum.");
    return Number.parseInt(text, 8);
  };
  const checksum = octal(148, 8);
  const expected = header.reduce(
    (total, byte, index) => total + (index >= 148 && index < 156 ? 32 : byte),
    0,
  );
  const path = decode(0, 100);
  const type = decode(156, 1);
  if (
    checksum !== expected ||
    !["0", ""].includes(type) ||
    decode(257, 6) !== "ustar" ||
    decode(345, 155) ||
    !/^[a-zA-Z0-9._/-]{1,99}$/.test(path) ||
    path.startsWith("/") ||
    path.split("/").includes("..")
  )
    throw new Error(
      "The backup contains an unsupported or invalid archive entry.",
    );
  return { path, size: octal(124, 12) };
}
