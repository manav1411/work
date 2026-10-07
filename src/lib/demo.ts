import {
  demoShowcaseRecords,
  DEMO_SHOWCASE_FILES,
} from "../content/demo-showcase";
import { markdownDocument } from "../features/content/markdownDocument";
import { demoDocument } from "../content/demo-documents";
import type { LatexProject } from "../../shared/latex";
import {
  DEFAULT_PREFERENCES,
  type Attachment,
  type RecordInput,
  type WorkRecord,
} from "../../shared/model";
import { newGoal, goalInputSchema, type Goal } from "../../shared/goals";
import { recordDataError } from "../../shared/record-contract";
import { dependentRecordIds } from "../../shared/deletion";
import { detachDataReferences } from "../../shared/references";
import { demoGoals } from "./demo-goals";
import { ApiError, type ApiAdapter } from "./api";
export function makeRecord(input: RecordInput): WorkRecord {
  const at = new Date().toISOString();
  return {
    ...input,
    id: crypto.randomUUID(),
    body: input.body ?? "",
    tags: input.tags ?? [],
    links: input.links ?? [],
    data: input.data ?? {},
    version: 1,
    createdAt: at,
    updatedAt: at,
  };
}
export function createDemoStore() {
  const key = "work-demo-current";
  const initial = {
    records: [] as WorkRecord[],
    preferences: {
      ...DEFAULT_PREFERENCES,
      displayName: "Alex Morgan",
      leetcode: "demo-handle",
    },
    goals: demoGoals(),
    attachments: [] as Attachment[],
    files: {} as Record<string, string>,
    projects: {} as Record<string, LatexProject>,
    seedVersion: 2,
  };
  const seeds = demoShowcaseRecords(),
    byKey = new Map<string, WorkRecord>();
  for (const input of seeds)
    byKey.set(String(input.data?.demoSeedKey), makeRecord(input));
  for (const [seedKey, record] of byKey) {
    const data = { ...record.data };
    const application = byKey.get(String(data.demoApplicationSeedKey)),
      interview = byKey.get(String(data.demoInterviewSeedKey));
    if (application) {
      data.applicationId = application.id;
      if (record.kind === "interview") record.links = [application.id];
    }
    if (interview) data.interviewId = interview.id;
    if (Array.isArray(data.storySeedKeys))
      data.storyIds = data.storySeedKeys.flatMap(
        (key) => byKey.get(String(key))?.id ?? [],
      );
    for (const name of Object.keys(data))
      if (name.startsWith("demo") || name === "storySeedKeys")
        delete data[name];
    if (["note", "path", "decision", "rotation"].includes(record.kind))
      data.richContent = {
        version: 1,
        document: markdownDocument(record.body),
      };
    record.data = data;
    const document = demoDocument(seedKey);
    if (document) {
      const file: Attachment = {
        id: crypto.randomUUID(),
        recordId: record.id,
        filename: `${record.title.toLowerCase().replaceAll(" ", "-")}.pdf`,
        contentType: "application/pdf",
        size: document.pdf.length,
        createdAt: record.createdAt,
      };
      initial.attachments.push(file);
      initial.files[file.id] = btoa(document.pdf);
      const job = { ...document.project.latestJob!, pdfAttachmentId: file.id };
      initial.projects[record.id] = {
        ...document.project,
        latestJob: job,
        latestSuccessfulJob: job,
      };
      record.data.latexProject = {
        sourceId: document.project.sourceId,
        mainFile: "main.tex",
        engine: "pdflatex",
        inputHash: document.project.sourceId,
      };
      record.data.latexJobs = [job];
    }
    const error = recordDataError(record.kind, data);
    if (error) throw new Error(error);
    initial.records.push(record);
  }
  const platform = byKey.get("direction-platform-engineering");
  if (platform)
    initial.goals = initial.goals.map((goal) => ({
      ...goal,
      directionId: platform.id,
    }));
  for (const item of DEMO_SHOWCASE_FILES) {
    const record = byKey.get(item.recordKey);
    if (!record) continue;
    const file: Attachment = {
      id: crypto.randomUUID(),
      recordId: record.id,
      filename: item.filename,
      contentType: item.contentType,
      size: new TextEncoder().encode(item.content).length,
      createdAt: new Date().toISOString(),
    };
    initial.attachments.push(file);
    initial.files[file.id] = btoa(
      String.fromCharCode(...new TextEncoder().encode(item.content)),
    );
    record.data.primaryAttachmentId = file.id;
  }
  let state = initial;
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) {
      const saved = JSON.parse(raw) as typeof initial;
      if (saved.seedVersion === initial.seedVersion) state = saved;
    }
  } catch {
    /* Start a fresh demo. */
  }
  const persist = () => {
    try {
      sessionStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* Preview remains usable in memory. */
    }
  };
  const validate = (record: WorkRecord) => {
    const error = recordDataError(record.kind, record.data);
    if (error) throw new ApiError(error, 400);
  };
  const remove = (recordIds: Set<string>, fileIds: Set<string>) => {
    state.records = state.records
      .filter((record) => !recordIds.has(record.id))
      .map((record) => ({
        ...record,
        links: record.links.filter((id) => !recordIds.has(id)),
        data: detachDataReferences(record.data, recordIds, fileIds),
      }));
    state.goals = state.goals.map((goal) =>
      recordIds.has(goal.directionId) ? { ...goal, directionId: "" } : goal,
    );
    state.attachments = state.attachments.filter(
      (file) => !fileIds.has(file.id),
    );
    for (const id of fileIds) delete state.files[id];
    for (const id of recordIds) delete state.projects[id];
    persist();
  };
  const adapter: ApiAdapter = async (path, init = {}) => {
    const url = new URL(path, "https://demo.invalid"),
      method = init.method ?? "GET",
      body = typeof init.body === "string" ? JSON.parse(init.body) : {};
    if (url.pathname === "/api/preferences") {
      if (method === "PUT") {
        state.preferences = { ...state.preferences, ...body };
        persist();
      }
      return { preferences: state.preferences };
    }
    if (url.pathname === "/api/records/batch") {
      const records = (body.records as RecordInput[]).map(makeRecord);
      records.forEach(validate);
      state.records.push(...records);
      persist();
      return { records };
    }
    if (url.pathname === "/api/records/reorder") {
      for (const item of body.items) {
        const record = state.records.find((record) => record.id === item.id);
        if (record) {
          record.data[item.field ?? "order"] = item.order;
          record.version++;
        }
      }
      persist();
      return { records: state.records };
    }
    if (url.pathname === "/api/records") {
      if (method === "POST") {
        const record = makeRecord(body);
        validate(record);
        state.records.push(record);
        persist();
        return { record };
      }
      return { records: structuredClone(state.records), epoch: "demo-current" };
    }
    if (url.pathname === "/api/search")
      return {
        records: state.records.filter((record) =>
          (record.title + record.body)
            .toLowerCase()
            .includes((url.searchParams.get("q") ?? "").toLowerCase()),
        ),
      };
    if (url.pathname === "/api/goals") {
      if (method === "POST") {
        const goal = newGoal(goalInputSchema.parse(body));
        state.goals.push(goal);
        persist();
        return { goal };
      }
      return { goals: structuredClone(state.goals) };
    }
    const goalRoute = /^\/api\/goals\/([^/]+)$/.exec(url.pathname);
    if (goalRoute) {
      const goal = state.goals.find((goal) => goal.id === goalRoute[1]);
      if (!goal) throw new ApiError("Goal not found.", 404);
      if (method === "DELETE") {
        state.goals = state.goals.filter((item) => item.id !== goal.id);
        persist();
        return { success: true };
      }
      if (body.version !== goal.version)
        throw new ApiError("This goal changed. Reload and try again.", 409);
      const { version, ...fields } = body;
      const next: Goal = {
        ...goal,
        ...goalInputSchema.parse(fields),
        version: version + 1,
        updatedAt: new Date().toISOString(),
      };
      state.goals = state.goals.map((item) =>
        item.id === goal.id ? next : item,
      );
      persist();
      return { goal: next };
    }
    const route = /^\/api\/records\/([^/]+)(?:\/(attachments|related))?$/.exec(
      url.pathname,
    );
    if (route) {
      const record = state.records.find((item) => item.id === route[1]);
      if (!record) throw new ApiError("Record not found.", 404);
      if (route[2] === "related")
        return {
          records: state.records.filter(
            (item) =>
              item.links.includes(record.id) || record.links.includes(item.id),
          ),
        };
      if (route[2] === "attachments") {
        if (method === "POST" && init.body instanceof FormData) {
          const file = init.body.get("file");
          if (
            !(file instanceof File) ||
            !file.size ||
            file.size > 10 * 1024 * 1024
          )
            throw new ApiError("Choose a file no larger than 10 MB.", 400);
          const attachment: Attachment = {
            id: crypto.randomUUID(),
            recordId: record.id,
            filename: file.name,
            contentType: file.type,
            size: file.size,
            createdAt: new Date().toISOString(),
          };
          const bytes = new Uint8Array(await file.arrayBuffer());
          let binary = "";
          for (const byte of bytes) binary += String.fromCharCode(byte);
          state.files[attachment.id] = btoa(binary);
          state.attachments.push(attachment);
          persist();
          return { attachment };
        }
        return {
          attachments: state.attachments.filter(
            (file) => file.recordId === record.id,
          ),
        };
      }
      if (method === "DELETE") {
        const ids = dependentRecordIds(state.records, [record.id]),
          files = new Set(
            state.attachments
              .filter((file) => ids.has(file.recordId))
              .map((file) => file.id),
          );
        remove(ids, files);
        return { success: true };
      }
      if (method === "PATCH") {
        if (body.version !== record.version)
          throw new ApiError("This record changed. Reload and try again.", 409);
        const next = {
          ...record,
          ...body,
          version: record.version + 1,
          updatedAt: new Date().toISOString(),
        };
        validate(next);
        state.records = state.records.map((item) =>
          item.id === record.id ? next : item,
        );
        persist();
        return { record: next };
      }
      return { record: structuredClone(record) };
    }
    const fileRoute = /^\/api\/attachments\/([^/]+)$/.exec(url.pathname);
    if (fileRoute && method === "DELETE") {
      remove(new Set(), new Set([fileRoute[1]]));
      return { success: true };
    }
    const latexRoute = /^\/api\/latex\/([^/]+)$/.exec(url.pathname);
    if (latexRoute && method === "GET") {
      const stored = state.projects[latexRoute[1]];
      const record = state.records.find((item) => item.id === latexRoute[1]);
      const withUrl = (job: LatexProject["latestJob"]) =>
        job
          ? {
              ...job,
              pdfUrl:
                job.pdfAttachmentId && state.files[job.pdfAttachmentId]
                  ? `data:application/pdf;base64,${state.files[job.pdfAttachmentId]}`
                  : undefined,
            }
          : undefined;
      return {
        configured: false,
        project: stored
          ? {
              ...structuredClone(stored),
              version: record?.version ?? stored.version,
              latestJob: withUrl(stored.latestJob),
              latestSuccessfulJob: withUrl(stored.latestSuccessfulJob),
            }
          : null,
      };
    }
    if (url.pathname.startsWith("/api/latex/"))
      throw new ApiError(
        "Native document compilation is available in your signed-in workspace.",
        503,
      );
    throw new ApiError("This action is unavailable in the demo.", 404);
  };
  persist();
  return {
    adapter,
    getRecords: () => structuredClone(state.records),
    getPreferences: () => ({ ...state.preferences }),
    fileUrl: async (id: string) => {
      const file = state.attachments.find((file) => file.id === id);
      if (!file || !state.files[id]) throw new ApiError("File not found.", 404);
      return `data:${file.contentType};base64,${state.files[id]}`;
    },
  };
}
