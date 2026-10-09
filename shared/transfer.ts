import { actionGoalIds, actionLinks } from "./goals";
import { z } from "zod";
import {
  RECORD_KINDS,
  type WorkRecord,
  type Attachment,
  type UserPreferences,
} from "./model";
import { goalSchema, type Goal } from "./goals";
import { recordDataError } from "./record-contract";
import { dataReferences } from "./references";
import { recruitmentSteps } from "./applications";

export const MANIFEST_PATH = "workspace.json";
export const MANIFEST_MAX_BYTES = 32 * 1024 * 1024;
export const TAR_BLOCK_BYTES = 512;
const identifier = z.string().min(1).max(120);
export const workspaceManifestSchema = z
  .object({
    format: z.literal("work-workspace"),
    version: z.literal(1),
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
          })
          .strict(),
      )
      .max(5000),
    goals: z.array(goalSchema).max(1000),
    preferences: z.record(z.string(), z.unknown()),
    attachments: z
      .array(
        z
          .object({
            id: identifier,
            recordId: identifier,
            filename: z.string().min(1).max(240),
            contentType: z.string().max(100),
            size: z
              .number()
              .int()
              .positive()
              .max(10 * 1024 * 1024),
            createdAt: z.string().datetime(),
            path: z.string().regex(/^files\/\d{6}$/),
          })
          .strict(),
      )
      .max(5000),
  })
  .strict();
export interface WorkspaceManifest {
  format: "work-workspace";
  version: 1;
  exportedAt: string;
  records: WorkRecord[];
  goals: Goal[];
  preferences: UserPreferences;
  attachments: (Attachment & { path: string })[];
}

/** A workspace upload is closed: all relations must be inside the package. */
export function workspacePackageError(
  manifest: WorkspaceManifest,
): string | null {
  const records = new Map(
    manifest.records.map((record) => [record.id, record]),
  );
  const files = new Map(manifest.attachments.map((file) => [file.id, file]));
  if (
    records.size !== manifest.records.length ||
    files.size !== manifest.attachments.length ||
    new Set(manifest.goals.map((goal) => goal.id)).size !==
      manifest.goals.length
  )
    return "The workspace contains duplicate IDs.";
  if (
    new Set([
      ...records.keys(),
      ...files.keys(),
      ...manifest.goals.map((goal) => goal.id),
    ]).size !==
    records.size + files.size + manifest.goals.length
  )
    return "Workspace IDs must be unique.";
  const belongs = (id: unknown, kinds: string[], category?: string) =>
    !id ||
    (typeof id === "string" &&
      kinds.includes(records.get(id)?.kind ?? "") &&
      (!category || records.get(id)?.data.category === category));
  if (
    new Set(manifest.attachments.map((file) => file.path)).size !==
    manifest.attachments.length
  )
    return "File paths must be unique.";
  for (const file of files.values())
    if (!records.has(file.recordId))
      return "A file belongs to a missing record.";
  for (const record of records.values()) {
    const error = recordDataError(record.kind, record.data);
    if (error) return error;
    const refs = dataReferences(record.data);
    if (
      record.links.some((id) => !records.has(id)) ||
      refs.records.some((id) => !records.has(id)) ||
      refs.files.some((id) => !files.has(id))
    )
      return "The workspace contains a missing record or file reference.";
    if (
      !belongs(record.data.companyId, ["company"]) ||
      !belongs(record.data.applicationId, ["application"]) ||
      !belongs(record.data.interviewId, ["interview"]) ||
      !belongs(record.data.tabId, ["note"], "interview-tab")
    )
      return "A workspace relation has the wrong record type.";
    if (
      record.data.track &&
      /^[0-9a-f-]{36}$/i.test(String(record.data.track)) &&
      !belongs(record.data.track, ["topic"], "learn-track")
    )
      return "Choose a learning tab.";
    if (
      Array.isArray(record.data.storyIds) &&
      record.data.storyIds.some((id) => !belongs(id, ["story"]))
    )
      return "Choose a STAR story.";
    const interview = records.get(String(record.data.interviewId));
    if (
      interview &&
      record.data.applicationId &&
      interview.data.applicationId !== record.data.applicationId
    )
      return "Preparation uses a different application.";
    if (record.kind === "interview") {
      const application = records.get(String(record.data.applicationId));
      if (
        !application ||
        !recruitmentSteps(application.data).some(
          (step) =>
            step.id === record.data.stepId &&
            !["submission", "offer"].includes(step.kind),
        )
      )
        return "An appointment needs an existing recruitment step.";
    }
    if (record.kind === "asset") {
      if (Array.isArray(record.data.latexJobs))
        for (const job of record.data.latexJobs as {
          sourceId: string;
          status: string;
          pdfAttachmentId?: string;
          textAttachmentId?: string;
          logAttachmentId?: string;
          synctexAttachmentId?: string;
        }[]) {
          for (const id of [
            job.sourceId,
            job.pdfAttachmentId,
            job.textAttachmentId,
            job.logAttachmentId,
            job.synctexAttachmentId,
          ])
            if (id && files.get(id)?.recordId !== record.id)
              return "A native build file belongs to a different document.";
        }
      if (
        record.data.primaryAttachmentId &&
        files.get(String(record.data.primaryAttachmentId))?.recordId !==
          record.id
      )
        return "Choose this document's file.";
      const project = record.data.latexProject as
        { sourceId?: string } | undefined;
      if (
        project &&
        (files.get(project.sourceId ?? "")?.contentType !==
          "application/json" ||
          !files
            .get(project.sourceId ?? "")
            ?.filename.startsWith("latex-source-"))
      )
        return "A native project needs a current source file.";
      if (project && files.get(project.sourceId ?? "")?.recordId !== record.id)
        return "A document needs its current source file.";
    }
  }
  if (
    manifest.goals.some((goal) =>
      actionGoalIds(goal).some(
        (id) => !belongs(id, ["path", "rotation", "decision"]),
      ),
    )
  )
    return "An action needs existing goals.";
  return null;
}

export function remapWorkspace(
  manifest: WorkspaceManifest,
  ids: ReadonlyMap<string, string>,
): WorkspaceManifest {
  const visit = (value: unknown): unknown => {
    if (typeof value === "string") {
      if (ids.has(value)) return ids.get(value)!;
      return value.replace(
        /(record|interview|tab|track|goal|action)=([^&#\s]+)/g,
        (match, key, id) => {
          try {
            return ids.has(decodeURIComponent(id))
              ? `${key}=${encodeURIComponent(ids.get(decodeURIComponent(id))!)}`
              : match;
          } catch {
            return match;
          }
        },
      );
    }
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, visit(item)]),
      );
    return value;
  };
  return {
    ...manifest,
    records: manifest.records.map((record) => ({
      ...record,
      id: ids.get(record.id)!,
      version: 1,
      links: record.links.map((id) => ids.get(id)!),
      body: visit(record.body) as string,
      data: visit(record.data) as WorkRecord["data"],
    })),
    goals: manifest.goals.map((goal) => ({
      ...goal,
      id: ids.get(goal.id)!,
      version: 1,
      ...actionLinks(actionGoalIds(goal).map((id) => ids.get(id)!)),
    })),
    attachments: manifest.attachments.map((file) => ({
      ...file,
      id: ids.get(file.id)!,
      recordId: ids.get(file.recordId)!,
    })),
  };
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
    throw new Error("The workspace export archive is truncated.");
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
      "The workspace export contains an unsupported or invalid archive entry.",
    );
  return { path, size: octal(124, 12) };
}
