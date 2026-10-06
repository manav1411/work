import {
  DEFAULT_PREFERENCES,
  type Attachment,
  type RecordInput,
  type RecordPatch,
  type RecordRevision,
  type UserPreferences,
  type WorkRecord,
} from "../../shared/model";
import { dataReferences, detachDataReferences } from "../../shared/references";
import {
  goalInputSchema,
  goalBackupSchema,
  checkpointSchema,
  newGoal,
  goalProgress,
  sourceCheckpointHistory,
  type Goal,
} from "../../shared/goals";
import { recruitmentSteps } from "../../shared/applications";
import {
  latexInputHash,
  latexMetadata,
  latexSaveSchema,
  latexSourceSchema,
  type LatexProject,
  type LatexSource,
} from "../../shared/latex";
import { recordDataError } from "../../shared/record-contract";
import { demoGoals } from "./demo-goals";
import {
  DEMO_SHOWCASE_FILES,
  demoShowcaseRecords,
} from "../content/demo-showcase";
import {
  legacyGoalId,
  legacyMappingReport,
  legacyProjectInput,
  legacySelectionSchema,
} from "../../shared/simplification";
import { DEMO_EXTRAS, STARTER_RECORDS } from "../content/starter";
import { ApiError, type ApiAdapter } from "./api";
import {
  assertDemoProviderPatch,
  type DemoConnectorState,
} from "./demo-connectors";

interface DemoBatch {
  id: string;
  source: string;
  createdAt: string;
  undoneAt: string | null;
  created: number;
  updated: number;
  skipped: number;
  changes: { id: string; version: number; before: WorkRecord | null }[];
}
interface DemoState {
  goals?: Goal[];
  records: WorkRecord[];
  preferences: UserPreferences;
  revisions: RecordRevision[];
  attachments: Attachment[];
  files: Record<string, string>;
  batches?: DemoBatch[];
  restored?: Record<
    string,
    { restored: number; attachments: number; warnings: string[] }
  >;
  connectors?: DemoConnectorState;
  /** Tracks sample records already added so demo upgrades never overwrite edits. */
  demoSeedKeys?: string[];
  /** Keeps a deleted sample attachment from being silently re-added. */
  demoAttachmentKeys?: string[];
}
interface ImportItem {
  sourceId: string;
  hash: string;
  record: RecordInput;
  attachments?: { filename: string; contentType: string; base64: string }[];
}

export function makeRecord(input: RecordInput): WorkRecord {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    kind: input.kind,
    title: input.title,
    body: input.body ?? "",
    tags: input.tags ?? [],
    links: input.links ?? [],
    data: input.data ?? {},
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

function base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function seedDemoShowcase(
  state: DemoState,
  validate: (record: WorkRecord) => void,
): void {
  const records = demoShowcaseRecords();
  const recordByKey = new Map<string, WorkRecord>();
  for (const record of state.records) {
    const key = record.data.demoSeedKey;
    if (typeof key === "string" && key) recordByKey.set(key, record);
  }
  const seededKeys = new Set(state.demoSeedKeys ?? []);
  for (const [key] of recordByKey) seededKeys.add(key);
  const created: WorkRecord[] = [];

  for (const input of records) {
    const key = input.data?.demoSeedKey;
    if (typeof key !== "string" || !key || seededKeys.has(key)) continue;
    const record = makeRecord(input);
    state.records.push(record);
    recordByKey.set(key, record);
    seededKeys.add(key);
    created.push(record);
  }

  for (const record of created) {
    const data = { ...record.data };
    const applicationKey = data.demoApplicationSeedKey;
    const interviewKey = data.demoInterviewSeedKey;
    const storyKeys = data.storySeedKeys;
    delete data.demoApplicationSeedKey;
    delete data.demoInterviewSeedKey;
    delete data.storySeedKeys;
    if (typeof applicationKey === "string") {
      const application = recordByKey.get(applicationKey);
      if (application) {
        data.applicationId = application.id;
        if (record.kind === "interview")
          record.links = [...new Set([...record.links, application.id])];
      }
    }
    if (typeof interviewKey === "string") {
      const appointment = recordByKey.get(interviewKey);
      if (appointment) data.interviewId = appointment.id;
    }
    if (Array.isArray(storyKeys))
      data.storyIds = storyKeys.flatMap((key) => {
        const story =
          typeof key === "string" ? recordByKey.get(key) : undefined;
        return story ? [story.id] : [];
      });
    record.data = data;
  }

  const seededAttachments = new Set(state.demoAttachmentKeys ?? []);
  for (const file of DEMO_SHOWCASE_FILES) {
    if (seededAttachments.has(file.attachmentKey)) continue;
    const record = recordByKey.get(file.recordKey);
    if (!record || record.deletedAt) continue;
    const id = crypto.randomUUID();
    const bytes = new TextEncoder().encode(file.content);
    const attachment: Attachment = {
      id,
      recordId: record.id,
      filename: file.filename,
      contentType: file.contentType,
      size: bytes.byteLength,
      createdAt: new Date().toISOString(),
    };
    state.attachments.push(attachment);
    state.files[id] = base64(file.content);
    record.data = { ...record.data, primaryAttachmentId: id };
    seededAttachments.add(file.attachmentKey);
  }

  created.forEach(validate);
  state.demoSeedKeys = [...seededKeys];
  state.demoAttachmentKeys = [...seededAttachments];
}

export function createDemoStore() {
  const storageKey = "work-demo-v1";
  let state: DemoState;
  try {
    const stored = sessionStorage.getItem(storageKey);
    state = stored
      ? (JSON.parse(stored) as DemoState)
      : {
          records: [...STARTER_RECORDS, ...DEMO_EXTRAS].map(makeRecord),
          preferences: { ...DEFAULT_PREFERENCES },
          revisions: [],
          attachments: [],
          files: {},
        };
    if (!Array.isArray(state.records) || !state.preferences)
      throw new Error("Invalid demo");
  } catch {
    state = {
      records: [...STARTER_RECORDS, ...DEMO_EXTRAS].map(makeRecord),
      preferences: { ...DEFAULT_PREFERENCES },
      revisions: [],
      attachments: [],
      files: {},
    };
  }
  const persist = () => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      /* A full preview storage must not destroy the live workspace. */
    }
  };
  state.goals ??= demoGoals();
  state.goals = state.goals.map((goal) => ({
    ...goal,
    directionId: goal.directionId || "",
  }));
  const validate = (item: WorkRecord) => {
    const error = recordDataError(item.kind, item.data);
    if (error) throw new ApiError(error, 400);
    if (item.kind === "interview" && item.data.stepId) {
      const app = state.records.find(
        (record) =>
          record.id === item.data.applicationId &&
          record.kind === "application",
      );
      if (
        !app ||
        !recruitmentSteps(app.data, true).some(
          (step) => step.id === item.data.stepId,
        )
      )
        throw new ApiError("Choose a step in this application.", 400);
    }
    if (
      item.kind === "asset" &&
      ["resume", "letter", "document", "cover-letter"].includes(
        String(item.data.type),
      ) &&
      item.data.primaryAttachmentId &&
      !state.attachments.some(
        (file) =>
          file.id === item.data.primaryAttachmentId &&
          file.recordId === item.id,
      )
    )
      throw new ApiError("Choose this document's file.", 400);
  };
  seedDemoShowcase(state, validate);
  const validateGoal = (directionId: string) => {
    if (
      directionId &&
      !state.records.some(
        (item) =>
          item.id === directionId &&
          ["path", "rotation", "decision"].includes(item.kind),
      )
    )
      throw new ApiError("Choose a direction in this workspace.", 400);
  };
  const record = (id: string) => {
    const found = state.records.find((item) => item.id === id);
    if (!found) throw new ApiError("Record not found.", 404);
    return found;
  };
  const urls = new Map<string, string>();
  const revisions = (previous: WorkRecord) => {
    state.revisions.push({
      id: crypto.randomUUID(),
      recordId: previous.id,
      version: previous.version,
      title: previous.title,
      body: previous.body,
      tags: previous.tags,
      links: previous.links,
      data: previous.data,
      createdAt: new Date().toISOString(),
    });
  };
  const assertFilesUnused = (fileIds: string[]) => {
    if (
      state.records.some(
        (item) =>
          item.kind === "application" &&
          dataReferences(item.data).files.some((file) =>
            fileIds.includes(file),
          ),
      )
    )
      throw new ApiError(
        "This document was captured in an application. Remove its captured version before deleting it.",
        409,
      );
  };
  const detachRelations = (
    recordIds: string[],
    fileIds: string[],
    excluded = "",
  ) => {
    const removedRecords = new Set(recordIds);
    const removedFiles = new Set(fileIds);
    state.goals = state.goals!.map((goal) =>
      removedRecords.has(goal.directionId)
        ? {
            ...goal,
            directionId: "",
            version: goal.version + 1,
            updatedAt: new Date().toISOString(),
          }
        : goal,
    );
    state.records = state.records.map((before) => {
      if (before.id === excluded) return before;
      const links = before.links.filter((link) => !removedRecords.has(link));
      const data = detachDataReferences(
        before.data,
        removedRecords,
        before.kind === "application" ? new Set<string>() : removedFiles,
      );
      if (
        links.length === before.links.length &&
        JSON.stringify(data) === JSON.stringify(before.data)
      )
        return before;
      revisions(structuredClone(before));
      return {
        ...before,
        links,
        data,
        version: before.version + 1,
        updatedAt: new Date().toISOString(),
      };
    });
  };
  const parse = (init?: RequestInit): Record<string, unknown> =>
    typeof init?.body === "string"
      ? (JSON.parse(init.body) as Record<string, unknown>)
      : {};
  const documentAsset = (id: string) => {
    const found = record(id);
    if (found.kind !== "asset" || found.deletedAt)
      throw new ApiError("Document not found.", 404);
    return found;
  };
  const latexProject = (asset: WorkRecord): LatexProject | null => {
    const revisionId = latexMetadata(asset.data)?.revisionId;
    if (!revisionId) return null;
    const stored = state.files[revisionId];
    if (!stored) throw new ApiError("The source is unavailable.", 410);
    const bytes = Uint8Array.from(atob(stored), (character) =>
      character.charCodeAt(0),
    );
    const source = latexSourceSchema.parse(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    return { ...source, version: asset.version, revisionId };
  };
  const saveLatex = async (asset: WorkRecord, source: LatexSource) => {
    const inputHash = await latexInputHash(source);
    if (latexMetadata(asset.data)?.inputHash === inputHash) return asset;
    const revisionId = crypto.randomUUID();
    const text = JSON.stringify(source);
    state.attachments.push({
      id: revisionId,
      recordId: asset.id,
      filename: `latex-source-${revisionId}.json`,
      contentType: "application/json",
      size: new TextEncoder().encode(text).length,
      createdAt: new Date().toISOString(),
    });
    state.files[revisionId] = base64(text);
    const next = {
      ...asset,
      version: asset.version + 1,
      updatedAt: new Date().toISOString(),
      data: {
        ...asset.data,
        latexProject: {
          revisionId,
          mainFile: source.mainFile,
          engine: source.engine,
          inputHash,
        },
      },
    };
    state.records = state.records.map((item) =>
      item.id === asset.id ? next : item,
    );
    persist();
    return next;
  };
  const adapter: ApiAdapter = async (path, init) => {
    if (path.startsWith("/api/connectors"))
      throw new ApiError("Connections have been retired.", 410);
    const url = new URL(path, "https://demo.invalid");
    const method = init?.method ?? "GET";
    const body = parse(init);
    const latexRoute = /^\/api\/latex\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
    if (latexRoute) {
      const asset = documentAsset(decodeURIComponent(latexRoute[1]));
      const action = latexRoute[2];
      if (!action && method === "GET")
        return { project: latexProject(asset), configured: false };
      if (!action && method === "PUT") {
        const parsed = latexSaveSchema.safeParse(body);
        if (!parsed.success)
          throw new ApiError(parsed.error.issues[0].message, 400);
        const { expectedVersion, ...source } = parsed.data;
        if (expectedVersion !== asset.version)
          throw new ApiError(
            "This document changed. Reload the saved source.",
            409,
          );
        const saved = await saveLatex(asset, source);
        return { project: latexProject(saved), record: saved };
      }
      if (action === "copy" && method === "POST") {
        if (
          typeof body.targetAssetId !== "string" ||
          body.targetAssetId === asset.id
        )
          throw new ApiError("Choose a different document.", 400);
        const target = documentAsset(body.targetAssetId);
        const source = latexProject(asset);
        if (!source) throw new ApiError("Save the source before copying.", 400);
        const content = {
          files: source.files,
          mainFile: source.mainFile,
          engine: source.engine,
        };
        if (
          latexMetadata(target.data) &&
          latexMetadata(target.data)?.inputHash !==
            (await latexInputHash(content))
        )
          throw new ApiError(
            "The target document already contains a different project.",
            409,
          );
        const saved = await saveLatex(target, content);
        return { project: latexProject(saved), record: saved };
      }
      if (action === "compile" && method === "POST")
        throw new ApiError(
          "The demo saves LaTeX source. PDF compilation is available in your signed-in workspace.",
          503,
        );
      throw new ApiError("This document operation is unavailable.", 404);
    }
    if (url.pathname === "/api/goals" && method === "GET")
      return { goals: state.goals!.filter((goal) => !goal.deletedAt) };
    if (url.pathname === "/api/goals" && method === "POST") {
      const parsed = goalInputSchema.safeParse(body);
      if (!parsed.success)
        throw new ApiError(parsed.error.issues[0].message, 400);
      validateGoal(parsed.data.directionId);
      const goal = newGoal(parsed.data);
      state.goals!.push(goal);
      persist();
      return { goal };
    }
    if (url.pathname === "/api/goals/legacy" && method === "GET")
      return legacyMappingReport(state.records, state.goals!, "demo");
    if (url.pathname === "/api/goals/legacy" && method === "POST") {
      const parsed = legacySelectionSchema.safeParse(body);
      if (!parsed.success)
        throw new ApiError("Choose a valid project selection.", 400);
      const created: Goal[] = [];
      for (const selection of parsed.data.selected) {
        const source = state.records.find(
          (item) => item.id === selection.recordId,
        );
        if (!source) throw new ApiError("This project was not found.", 404);
        if (source.version !== selection.version)
          throw new ApiError(
            "A selected project changed. Load the mapping report again.",
            409,
          );
        const candidate = legacyProjectInput(source);
        if (!candidate.input) throw new ApiError(candidate.reason, 400);
        const id = await legacyGoalId("demo", source.id);
        if (!state.goals!.some((goal) => goal.id === id))
          created.push({ ...newGoal(candidate.input), id });
      }
      state.goals!.push(...created);
      persist();
      return {
        created: created.length,
        skipped: parsed.data.selected.length - created.length,
        goalIds: created.map((goal) => goal.id),
        report: await legacyMappingReport(state.records, state.goals!, "demo"),
      };
    }
    if (url.pathname.startsWith("/api/goals/")) {
      const goalId = url.pathname.split("/")[3],
        before = state.goals!.find(
          (goal) => goal.id === goalId && !goal.deletedAt,
        );
      if (!before) throw new ApiError("Goal not found.", 404);
      const at = new Date().toISOString();
      if (method === "DELETE") {
        state.goals = state.goals!.map((goal) =>
          goal.id === goalId
            ? { ...goal, deletedAt: at, version: goal.version + 1 }
            : goal,
        );
        persist();
        return { deleted: true };
      }
      let next: Goal;
      if (url.pathname.endsWith("/checkpoint")) {
        const parsed = checkpointSchema.safeParse(body);
        if (!parsed.success)
          throw new ApiError("Invalid progress measurement.", 400);
        const input = parsed.data;
        if (!["curriculum", "problems", "leetcode"].includes(before.measure))
          throw new ApiError("This goal uses manual progress.", 400);
        if (Date.parse(input.at) > Date.now() + 300_000)
          throw new ApiError("A checkpoint cannot be in the future.", 400);
        if (
          (input.measure !== undefined && input.measure !== before.measure) ||
          (input.scope !== undefined && input.scope !== before.scope)
        )
          throw new ApiError(
            "This goal's progress source changed. Reload and try again.",
            409,
          );
        const checkpoints = sourceCheckpointHistory(before, input);
        if (!checkpoints) return { goal: before };
        next = {
          ...before,
          value: input.value,
          checkpoints,
          version: before.version + 1,
          updatedAt: at,
        };
      } else {
        if (body.version !== before.version)
          throw new ApiError("This goal changed. Reload and try again.", 409);
        const { version: _version, ...fields } = body;
        void _version;
        const parsed = goalInputSchema.safeParse(fields);
        if (!parsed.success)
          throw new ApiError(parsed.error.issues[0].message, 400);
        validateGoal(parsed.data.directionId);
        next = {
          ...before,
          ...parsed.data,
          version: before.version + 1,
          updatedAt: at,
        };
        if (goalProgress(next).value !== goalProgress(before).value)
          next.checkpoints = [
            ...before.checkpoints,
            {
              value: goalProgress(next).value,
              at,
              unit: next.unit,
              measure: next.measure,
              scope: next.scope,
            },
          ].slice(-1000);
      }
      state.goals = state.goals!.map((goal) =>
        goal.id === goalId ? next : goal,
      );
      persist();
      return { goal: next };
    }
    if (url.pathname === "/api/session")
      return {
        user: { id: "demo", name: "Manav", email: "Preview workspace" },
        local: false,
        configured: true,
      };
    if (url.pathname === "/api/preferences") {
      if (method === "PUT") {
        state.preferences = {
          ...state.preferences,
          ...body,
        } as UserPreferences;
        persist();
      }
      return { preferences: state.preferences };
    }
    if (url.pathname === "/api/records/batch") {
      const items = body.records as RecordInput[];
      const created = items.map(makeRecord);
      created.forEach(validate);
      state.records.push(...created);
      persist();
      return { records: created };
    }
    if (url.pathname === "/api/records") {
      if (method === "POST") {
        const created = makeRecord(body as unknown as RecordInput);
        validate(created);
        state.records.push(created);
        persist();
        return { record: created };
      }
      return {
        records: state.records.filter(
          (item) =>
            url.searchParams.get("includeDeleted") === "true" ||
            !item.deletedAt,
        ),
      };
    }
    if (url.pathname === "/api/search") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      return {
        records: state.records.filter(
          (item) =>
            !item.deletedAt &&
            `${item.title} ${item.body} ${item.tags.join(" ")} ${JSON.stringify(item.data)}`
              .toLowerCase()
              .includes(q),
        ),
      };
    }
    const route = /^\/api\/records\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
    if (route) {
      const previous = record(route[1]);
      const sub = route[2];
      if (sub === "revisions")
        return {
          revisions: state.revisions
            .filter((item) => item.recordId === previous.id)
            .reverse(),
        };
      if (sub === "restore") {
        previous.deletedAt = null;
        previous.version++;
        persist();
        return { record: previous };
      }
      if (sub === "permanent") {
        if (!previous.deletedAt)
          throw new ApiError("Move the record to trash first.", 409);
        const fileIds = state.attachments
          .filter((item) => item.recordId === previous.id)
          .map((item) => item.id);
        assertFilesUnused(fileIds);
        detachRelations([previous.id], fileIds, previous.id);
        state.records = state.records.filter((item) => item.id !== previous.id);
        state.revisions = state.revisions.filter(
          (item) => item.recordId !== previous.id,
        );
        state.attachments
          .filter((item) => item.recordId === previous.id)
          .forEach((item) => {
            delete state.files[item.id];
          });
        state.attachments = state.attachments.filter(
          (item) => item.recordId !== previous.id,
        );
        persist();
        return { success: true };
      }
      if (sub === "attachments") {
        if (method === "POST" && init?.body instanceof FormData) {
          const file = init.body.get("file");
          if (!(file instanceof File))
            throw new ApiError("Choose a file.", 400);
          if (file.size > 10 * 1024 * 1024)
            throw new ApiError("Choose a file smaller than 10 MB.", 413);
          const bytes = new Uint8Array(await file.arrayBuffer());
          let binary = "";
          bytes.forEach((byte) => {
            binary += String.fromCharCode(byte);
          });
          const created: Attachment = {
            id: crypto.randomUUID(),
            recordId: previous.id,
            filename: file.name,
            contentType: file.type || "application/octet-stream",
            size: file.size,
            createdAt: new Date().toISOString(),
          };
          state.attachments.push(created);
          state.files[created.id] = btoa(binary);
          persist();
          return { attachment: created };
        }
        return {
          attachments: state.attachments.filter(
            (item) => item.recordId === previous.id,
          ),
        };
      }
      if (method === "PATCH") {
        if (body.version !== previous.version)
          throw new ApiError(
            "This record changed. Keep your draft and reload the latest version.",
            409,
          );
        assertDemoProviderPatch(previous, body as RecordPatch);
        revisions(structuredClone(previous));
        const next = {
          ...previous,
          ...body,
          id: previous.id,
          kind: previous.kind,
          version: previous.version + 1,
          updatedAt: new Date().toISOString(),
        } as WorkRecord;
        validate(next);
        state.records = state.records.map((item) =>
          item.id === previous.id ? next : item,
        );
        persist();
        return { record: next };
      }
      if (method === "DELETE") {
        previous.deletedAt = new Date().toISOString();
        previous.version++;
        persist();
        return { success: true };
      }
      return { record: previous };
    }
    if (url.pathname.startsWith("/api/attachments/") && method === "DELETE") {
      const id = url.pathname.split("/").pop()!;
      if (!state.attachments.some((item) => item.id === id))
        throw new ApiError("File not found.", 404);
      assertFilesUnused([id]);
      detachRelations([], [id]);
      state.attachments = state.attachments.filter((item) => item.id !== id);
      delete state.files[id];
      persist();
      return { success: true };
    }
    if (url.pathname === "/api/export")
      return {
        format: "work-export",
        version: 2,
        exportedAt: new Date().toISOString(),
        records: state.records,
        goals: state.goals,
        revisions: state.revisions,
        preferences: state.preferences,
        attachments: state.attachments.map((item) => ({
          ...item,
          ...(url.searchParams.get("files") === "false"
            ? {}
            : { base64: state.files[item.id] }),
        })),
      };
    if (url.pathname === "/api/import" && method === "GET")
      return { batches: state.batches ?? [] };
    if (/^\/api\/import\/[^/]+\/undo$/.test(url.pathname)) {
      const batch = state.batches?.find(
        (item) => item.id === url.pathname.split("/")[3],
      );
      if (!batch) throw new ApiError("Import not found.", 404);
      if (batch.undoneAt) return { undone: true };
      if (
        batch.changes.some(
          (change) => record(change.id).version !== change.version,
        )
      )
        throw new ApiError(
          "Some imported records were edited later. Keep those edits; reconcile them individually.",
          409,
        );
      for (const change of batch.changes) {
        const current = record(change.id);
        revisions(structuredClone(current));
        const next = change.before
          ? {
              ...change.before,
              version: current.version + 1,
              updatedAt: new Date().toISOString(),
            }
          : {
              ...current,
              version: current.version + 1,
              deletedAt: new Date().toISOString(),
            };
        state.records = state.records.map((item) =>
          item.id === current.id ? next : item,
        );
      }
      batch.undoneAt = new Date().toISOString();
      persist();
      return { undone: true };
    }
    if (url.pathname === "/api/import" && method === "POST") {
      const items = body.records as ImportItem[];
      let skipped = 0;
      let updated = 0;
      const created: WorkRecord[] = [];
      const ids = new Map<string, string>();
      const batch: DemoBatch = {
        id: crypto.randomUUID(),
        source: String(body.source),
        createdAt: new Date().toISOString(),
        undoneAt: null,
        created: 0,
        updated: 0,
        skipped: 0,
        changes: [],
      };
      for (const item of items)
        ids.set(
          item.sourceId,
          state.records.find(
            (row) =>
              row.data.sourceId === item.sourceId &&
              row.data.source === body.source,
          )?.id ?? crypto.randomUUID(),
        );
      const rewrite = (value: string, attachments: Map<string, string>) =>
        value
          .replace(
            /work-source:\/\/([^\s)\]>]+)/g,
            (_match, source: string) =>
              `/notes?record=${ids.get(decodeURIComponent(source)) ?? ""}`,
          )
          .replace(
            /work-attachment:\/\/([^\s)\]>]+)/g,
            (_match, filename: string) =>
              `/api/attachments/${attachments.get(decodeURIComponent(filename)) ?? ""}`,
          );
      for (const item of items) {
        const existing = state.records.find(
          (row) =>
            row.data.sourceId === item.sourceId &&
            row.data.source === body.source,
        );
        if (
          existing &&
          (body.mode === "keep" || existing.data.sourceHash === item.hash)
        ) {
          skipped++;
          continue;
        }
        const attachments = new Map<string, string>();
        for (const file of item.attachments ?? []) {
          const attachment: Attachment = {
            id: crypto.randomUUID(),
            recordId: ids.get(item.sourceId)!,
            filename: file.filename,
            contentType: file.contentType,
            size: atob(file.base64).length,
            createdAt: new Date().toISOString(),
          };
          state.attachments.push(attachment);
          state.files[attachment.id] = file.base64;
          attachments.set(file.filename, attachment.id);
        }
        const input = {
          ...item.record,
          body: rewrite(item.record.body ?? "", attachments),
          links: (item.record.links ?? []).map((id) => ids.get(id) ?? id),
          data: {
            ...item.record.data,
            sourceId: item.sourceId,
            source: body.source,
            sourceHash: item.hash,
            ...(item.record.kind === "asset" && attachments.size
              ? { primaryAttachmentId: [...attachments.values()][0] }
              : {}),
          },
        };
        if (existing && body.mode === "merge")
          input.body = `${existing.body}\n\n---\n\n${input.body}`;
        const value = existing
          ? {
              ...existing,
              ...input,
              version: existing.version + 1,
              updatedAt: new Date().toISOString(),
            }
          : { ...makeRecord(input), id: ids.get(item.sourceId)! };
        batch.changes.push({
          id: value.id,
          version: value.version,
          before: existing ? structuredClone(existing) : null,
        });
        if (existing) {
          updated++;
          revisions(structuredClone(existing));
          state.records = state.records.map((row) =>
            row.id === existing.id ? value : row,
          );
        } else state.records.push(value);
        created.push(value);
      }
      batch.created = created.length - updated;
      batch.updated = updated;
      batch.skipped = skipped;
      state.batches = [...(state.batches ?? []), batch];
      persist();
      return {
        batchId: batch.id,
        created: batch.created,
        updated,
        skipped,
        warnings: [],
        records: created,
      };
    }
    if (url.pathname === "/api/restore") {
      const fingerprint =
        String(body.exportedAt) +
        JSON.stringify(body.records) +
        JSON.stringify(body.goals ?? []);
      if (state.restored?.[fingerprint]) return state.restored[fingerprint];
      const payload = body.records as WorkRecord[];
      const files = (body.attachments ?? []) as (Attachment & {
        base64?: string;
      })[];
      const ids = new Map(
        payload.map((item) => [item.id, crypto.randomUUID()]),
      );
      const fileIds = new Map(
        files.map((item) => [item.id, crypto.randomUUID()]),
      );
      const stepIds = new Map(
        payload.flatMap((item) =>
          recruitmentSteps(item.data, true).map(
            (step) => [step.id, crypto.randomUUID()] as const,
          ),
        ),
      );
      const warnings: string[] = [];
      const remap = (value: unknown): unknown =>
        typeof value === "string"
          ? (ids.get(value) ??
            fileIds.get(value) ??
            stepIds.get(value) ??
            value.replace(
              /\/api\/attachments\/([^\s)\]>]+)/g,
              (match, id: string) =>
                fileIds.has(id) ? `/api/attachments/${fileIds.get(id)}` : match,
            ))
          : Array.isArray(value)
            ? value.map(remap)
            : value && typeof value === "object"
              ? Object.fromEntries(
                  Object.entries(value).map(([key, item]) => [
                    key,
                    remap(item),
                  ]),
                )
              : value;
      for (const item of payload)
        state.records.push({
          ...item,
          id: ids.get(item.id)!,
          links: item.links.map((id) => ids.get(id) ?? id),
          body: remap(item.body) as string,
          data: remap(item.data) as WorkRecord["data"],
        });
      for (const item of (body.revisions ?? []) as RecordRevision[])
        state.revisions.push({
          ...item,
          id: crypto.randomUUID(),
          recordId: ids.get(item.recordId)!,
          links: item.links.map((id) => ids.get(id) ?? id),
          body: remap(item.body) as string,
          data: remap(item.data) as WorkRecord["data"],
        });
      for (const file of files) {
        const id = fileIds.get(file.id)!;
        state.attachments.push({
          ...file,
          id,
          recordId: ids.get(file.recordId)!,
        });
        if (file.base64) state.files[id] = file.base64;
        else
          warnings.push(
            `${file.filename}: file bytes absent from metadata archive.`,
          );
      }
      state.preferences = {
        ...DEFAULT_PREFERENCES,
        ...(body.preferences as UserPreferences),
      };
      const restoredGoals = goalBackupSchema
        .array()
        .parse(body.goals ?? [])
        .map((goal) => ({
          ...goal,
          id: crypto.randomUUID(),
          directionId: ids.get(goal.directionId) ?? "",
        }));
      state.goals!.push(...restoredGoals);
      const result = {
        restored: payload.length,
        attachments: files.length,
        warnings,
        goals: restoredGoals,
      };
      state.restored = { ...state.restored, [fingerprint]: result };
      persist();
      return result;
    }
    throw new ApiError("This preview operation is unavailable.", 404);
  };
  persist();
  return {
    adapter,
    getRecords: () => state.records.filter((item) => !item.deletedAt),
    getPreferences: () => state.preferences,
    persist,
    fileUrl: async (id: string) => {
      if (urls.has(id)) return urls.get(id)!;
      const item = state.attachments.find((row) => row.id === id);
      if (!item) throw new ApiError("File not found.", 404);
      if (!state.files[id])
        throw new ApiError(
          "File contents are unavailable. Upload a replacement.",
          404,
        );
      const bytes = Uint8Array.from(atob(state.files[id]), (char) =>
        char.charCodeAt(0),
      );
      const url = URL.createObjectURL(
        new Blob([bytes], { type: item.contentType }),
      );
      urls.set(id, url);
      return url;
    },
  };
}
