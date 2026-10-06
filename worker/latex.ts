import { Hono } from "hono";
import { z } from "zod";
import {
  TEXLIVE_ENVIRONMENT,
  latexEngineSchema,
  latexInputHash,
  latexJobs,
  latexMetadata,
  latexSaveSchema,
  latexSourceSchema,
  type LatexJob,
  type LatexSource,
} from "../shared/latex";
import type { WorkRecord } from "../shared/model";
import { documentPdfFilename } from "../shared/documents";
import { ApiError, id, now, type Env, type Variables } from "./env";
import { getRecord, writeRecord } from "./db/records";
import { fromBase64, getAttachment, saveAttachment, toBase64 } from "./files";
import { parse, readLimitedBody } from "./validation";

export const latexRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
const encode = new TextEncoder();
const MAX_JOBS = 12;
const sourcePrefix = "latex-source-";

async function input(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new ApiError(415, "JSON_REQUIRED", "Send JSON project data.");
  const bytes = await readLimitedBody(request, 8 * 1024 * 1024);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError(
      400,
      "INVALID_JSON",
      "The project request is not valid JSON.",
    );
  }
}
async function asset(env: Env, owner: string, assetId: string) {
  const record = await getRecord(env.DB, owner, assetId);
  if (record.kind !== "asset")
    throw new ApiError(
      400,
      "INVALID_DOCUMENT",
      "Choose a document for this project.",
    );
  return record;
}
async function sourceRevision(
  env: Env,
  owner: string,
  record: WorkRecord,
  revisionId: string,
): Promise<LatexSource> {
  const row = await getAttachment(env, owner, revisionId, true);
  if (
    row.record_id !== record.id ||
    row.content_type !== "application/json" ||
    !row.filename.startsWith(sourcePrefix)
  )
    throw new ApiError(
      404,
      "NOT_FOUND",
      "This source revision does not belong to the document.",
    );
  const object = await env.FILES.get(row.object_key);
  if (!object)
    throw new ApiError(
      410,
      "MISSING_SOURCE",
      "The source revision is unavailable.",
    );
  return parse(latexSourceSchema, await object.json());
}
function publicJob(job: LatexJob): LatexJob {
  const stored = { ...job };
  delete stored.pdfUrl;
  delete stored.textUrl;
  return {
    ...stored,
    ...(job.pdfAttachmentId
      ? { pdfUrl: `/api/attachments/${job.pdfAttachmentId}` }
      : {}),
    ...(job.textAttachmentId
      ? { textUrl: `/api/attachments/${job.textAttachmentId}` }
      : {}),
  };
}
async function projectResponse(
  env: Env,
  owner: string,
  record: WorkRecord,
  revisionId = latexMetadata(record.data)?.revisionId,
) {
  if (!revisionId) return null;
  const source = await sourceRevision(env, owner, record, revisionId);
  const main = source.files.find((file) => file.path === source.mainFile);
  const latest = main?.content.trim()
    ? [...latexJobs(record.data)]
        .reverse()
        .find((job) => job.revisionId === revisionId)
    : undefined;
  const successful = main?.content.trim()
    ? [...latexJobs(record.data)]
        .reverse()
        .find((job) => job.status === "succeeded")
    : undefined;
  return {
    ...source,
    version: record.version,
    revisionId,
    ...(latest ? { latestJob: publicJob(latest) } : {}),
    ...(successful ? { latestSuccessfulJob: publicJob(successful) } : {}),
  };
}
async function discardAttachment(
  env: Env,
  owner: string,
  attachmentId: string,
) {
  const row = await env.DB.prepare(
    "SELECT object_key FROM attachments WHERE id=? AND owner_id=?",
  )
    .bind(attachmentId, owner)
    .first<{ object_key: string }>();
  if (!row) return;
  await env.DB.prepare("DELETE FROM attachments WHERE id=? AND owner_id=?")
    .bind(attachmentId, owner)
    .run();
  await env.FILES.delete(row.object_key);
}
async function saveSource(
  env: Env,
  owner: string,
  record: WorkRecord,
  source: LatexSource,
) {
  const inputHash = await latexInputHash(source);
  if (latexMetadata(record.data)?.inputHash === inputHash) return record;
  const attachment = await saveAttachment(
    env,
    owner,
    record.id,
    `${sourcePrefix}${id()}.json`,
    "application/json",
    encode.encode(JSON.stringify(source)),
  );
  const next = {
    ...record,
    version: record.version + 1,
    updatedAt: now(),
    data: {
      ...record.data,
      latexProject: {
        revisionId: attachment.id,
        mainFile: source.mainFile,
        engine: source.engine,
        inputHash,
      },
      latexJobs: latexJobs(record.data),
    },
  };
  try {
    await writeRecord(env.DB, owner, next, record.version);
  } catch (error) {
    await discardAttachment(env, owner, attachment.id);
    throw error;
  }
  return next;
}

/** CAS only the compiler namespace: build progress must not create source-save conflicts. */
async function mutateJobs(
  env: Env,
  owner: string,
  assetId: string,
  mutate: (jobs: LatexJob[], record: WorkRecord) => LatexJob[],
) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const record = await asset(env, owner, assetId);
    const old = latexJobs(record.data);
    const next = mutate(old, record);
    const latest = [...next]
      .reverse()
      .find(
        (job) =>
          job.status === "succeeded" &&
          job.revisionId === latexMetadata(record.data)?.revisionId,
      );
    const result = await env.DB.prepare(
      "UPDATE records SET data=json_set(data,'$.latexJobs',json(?),'$.primaryAttachmentId',COALESCE(?,json_extract(data,'$.primaryAttachmentId'),'')) WHERE id=? AND owner_id=? AND version=? AND COALESCE(json_extract(data,'$.latexJobs'),'[]')=? AND deleted_at IS NULL",
    )
      .bind(
        JSON.stringify(next),
        latest?.pdfAttachmentId ?? null,
        assetId,
        owner,
        record.version,
        JSON.stringify(old),
      )
      .run();
    if (result.meta.changes) {
      return next;
    }
  }
  throw new ApiError(
    409,
    "BUILD_CONFLICT",
    "The document changed while updating compilation. Refresh to see its status.",
  );
}

const reusableCompileJob = (job: LatexJob, revisionId: string) =>
  job.revisionId === revisionId &&
  ((job.status === "succeeded" &&
    job.metadata?.texEnvironment === TEXLIVE_ENVIRONMENT) ||
    (job.environment === TEXLIVE_ENVIRONMENT &&
      ["queued", "running"].includes(job.status) &&
      Date.parse(job.createdAt) > Date.now() - 600_000));

function hasCompileInput(source: LatexSource) {
  return Boolean(
    source.files.find((file) => file.path === source.mainFile)?.content.trim(),
  );
}

/** Add one idempotent job for a source revision, reusing a live or completed build. */
async function enqueueCompile(
  env: Env,
  owner: string,
  assetId: string,
  revisionId: string,
  requireCurrent = false,
): Promise<{ job: LatexJob; created: boolean } | null> {
  if (!env.LATEX_COMPILER_URL || !env.LATEX_COMPILER_TOKEN) return null;
  const record = await asset(env, owner, assetId);
  if (requireCurrent && latexMetadata(record.data)?.revisionId !== revisionId)
    return null;
  const source = await sourceRevision(env, owner, record, revisionId);
  if (!hasCompileInput(source)) return null;
  let selected: LatexJob | undefined;
  let created = false;
  const job: LatexJob = {
    environment: TEXLIVE_ENVIRONMENT,
    id: id(),
    revisionId,
    status: "queued",
    createdAt: now(),
    log: "",
  };
  await mutateJobs(env, owner, assetId, (jobs, current) => {
    created = false;
    if (
      requireCurrent &&
      latexMetadata(current.data)?.revisionId !== revisionId
    )
      return jobs;
    const existing = [...jobs]
      .reverse()
      .find((item) => reusableCompileJob(item, revisionId));
    if (existing) {
      selected = existing;
      return jobs;
    }
    selected = job;
    created = true;
    return [
      ...jobs
        .filter(
          (item) =>
            !["queued", "running"].includes(item.status) ||
            Date.parse(item.createdAt) > Date.now() - 600_000,
        )
        .slice(-(MAX_JOBS - 1)),
      job,
    ];
  });
  return selected ? { job: selected, created } : null;
}

async function cancelQueuedJob(
  env: Env,
  owner: string,
  assetId: string,
  jobId: string,
) {
  await mutateJobs(env, owner, assetId, (jobs) =>
    jobs.map((job) =>
      job.id === jobId && ["queued", "running"].includes(job.status)
        ? { ...job, status: "cancelled", finishedAt: now() }
        : job,
    ),
  ).catch(() => {});
}

async function autoCompileAfterSave(
  env: Env,
  owner: string,
  assetId: string,
  revisionId: string,
  jobId: string,
) {
  await new Promise((resolve) => setTimeout(resolve, 650));
  try {
    const current = await asset(env, owner, assetId);
    if (latexMetadata(current.data)?.revisionId !== revisionId) {
      await cancelQueuedJob(env, owner, assetId, jobId);
      return;
    }
    const job = latexJobs(current.data).find((item) => item.id === jobId);
    if (!job || job.status !== "queued") return;
    const source = await sourceRevision(env, owner, current, revisionId);
    await runCompile(env, owner, assetId, job, source, false, true);
  } catch {
    // The scheduled worker sweep resumes queued jobs if the request lifetime ends.
  }
}

async function cancelRemoteJob(env: Env, jobId: string) {
  if (!env.LATEX_COMPILER_URL || !env.LATEX_COMPILER_TOKEN) return;
  await fetch(new URL(`/jobs/${jobId}`, env.LATEX_COMPILER_URL), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${env.LATEX_COMPILER_TOKEN}`,
      ...(env.LATEX_ACCESS_CLIENT_ID && env.LATEX_ACCESS_CLIENT_SECRET
        ? {
            "CF-Access-Client-Id": env.LATEX_ACCESS_CLIENT_ID,
            "CF-Access-Client-Secret": env.LATEX_ACCESS_CLIENT_SECRET,
          }
        : {}),
    },
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}

/** Scheduled safety net for builds that outlive the request's waitUntil window. */
export async function resumePendingLatexJobs(env: Env): Promise<void> {
  if (!env.LATEX_COMPILER_URL || !env.LATEX_COMPILER_TOKEN) return;
  const staleBefore = new Date(Date.now() - 20_000).toISOString();
  const rows = await env.DB.prepare(
    "SELECT owner_id,id,data FROM records WHERE kind='asset' AND deleted_at IS NULL AND json_type(data,'$.latexJobs')='array' AND EXISTS (SELECT 1 FROM json_each(json_extract(records.data,'$.latexJobs')) job WHERE json_extract(job.value,'$.status') IN ('queued','running') AND json_extract(job.value,'$.createdAt')<=?) ORDER BY updated_at LIMIT 20",
  )
    .bind(staleBefore)
    .all<{ owner_id: string; id: string; data: string }>();

  const work: { owner: string; assetId: string; job: LatexJob }[] = [];
  for (const row of rows.results) {
    try {
      const data = JSON.parse(row.data) as Record<string, unknown>;
      for (const job of latexJobs(data)) {
        if (
          work.length >= 20 ||
          !["queued", "running"].includes(job.status) ||
          Date.parse(job.createdAt) > Date.now() - 20_000
        )
          continue;
        work.push({ owner: row.owner_id, assetId: row.id, job });
      }
    } catch {
      // Ignore malformed historical job data and continue with valid records.
    }
    if (work.length >= 20) break;
  }

  for (let index = 0; index < work.length; index += 4) {
    await Promise.allSettled(
      work.slice(index, index + 4).map(async ({ owner, assetId, job }) => {
        const age = Date.now() - Date.parse(job.createdAt);
        if (age > 600_000) {
          await mutateJobs(env, owner, assetId, (jobs) =>
            jobs.map((item) =>
              item.id === job.id && ["queued", "running"].includes(item.status)
                ? {
                    ...item,
                    status: "failed",
                    finishedAt: now(),
                    log: "The compile job expired before its result was collected.",
                  }
                : item,
            ),
          ).catch(() => {});
          if (job.status === "running") await cancelRemoteJob(env, job.id);
          return;
        }

        const current = await asset(env, owner, assetId);
        if (latexMetadata(current.data)?.revisionId !== job.revisionId) {
          await cancelQueuedJob(env, owner, assetId, job.id);
          if (job.status === "running") await cancelRemoteJob(env, job.id);
          return;
        }
        const active = latexJobs(current.data).find(
          (item) => item.id === job.id,
        );
        if (!active || !["queued", "running"].includes(active.status)) return;
        const source = await sourceRevision(
          env,
          owner,
          current,
          active.revisionId,
        );
        await runCompile(
          env,
          owner,
          assetId,
          active,
          source,
          active.status === "running",
          true,
        );
      }),
    );
  }
}
const metadataSchema = z
  .object({
    texEnvironment: z.string().max(120).optional(),
    imageDigest: z.string().max(200).optional(),
    compilerFingerprint: z.string().max(128).optional(),
    texLiveRelease: z.string().max(80).optional(),
    engine: latexEngineSchema.optional(),
    inputHash: z.string().max(128).optional(),
    configuration: z
      .union([
        z.string().max(1000),
        z
          .object({
            latexmkVersion: z.string().max(200),
            shellEscape: z.boolean(),
            customLatexmkrc: z.boolean(),
            synctex: z.boolean(),
            network: z.boolean(),
          })
          .strict(),
      ])
      .optional(),
  })
  .passthrough();
const compilerResultSchema = z.object({
  success: z.boolean(),
  pdfBase64: z.string().max(14_000_000).optional(),
  synctexBase64: z.string().max(7_000_000).optional(),
  log: z.string().max(150_000),
  text: z.string().max(500_000).default(""),
  fonts: z.string().max(20_000).default(""),
  diagnostics: z
    .array(
      z.object({
        file: z.string().max(240).optional(),
        line: z.number().int().positive().optional(),
        severity: z.string().max(20),
        message: z.string().max(1000),
      }),
    )
    .max(100)
    .default([]),
  metadata: metadataSchema,
});

function compilerStatus(error: unknown) {
  return (error as { status?: number } | null)?.status;
}

function retryableCompilerFailure(error: unknown) {
  const status = compilerStatus(error);
  return (
    status === 408 ||
    status === 429 ||
    (typeof status === "number" && status >= 500) ||
    error instanceof TypeError ||
    ["AbortError", "TimeoutError"].includes(
      (error as { name?: string } | null)?.name ?? "",
    )
  );
}

async function runCompile(
  env: Env,
  owner: string,
  assetId: string,
  job: LatexJob,
  source: LatexSource,
  retrieveOnly = false,
  requireCurrent = false,
) {
  const attachments: string[] = [];
  try {
    await mutateJobs(env, owner, assetId, (jobs) =>
      jobs.map((item) =>
        item.id === job.id && item.status === "queued"
          ? { ...item, status: "running" }
          : item,
      ),
    );
    const started = await asset(env, owner, assetId);
    if (
      latexJobs(started.data).find((item) => item.id === job.id)?.status !==
      "running"
    )
      return;
    if (
      requireCurrent &&
      latexMetadata(started.data)?.revisionId !== job.revisionId
    ) {
      await cancelQueuedJob(env, owner, assetId, job.id);
      return;
    }
    const deadline = Date.now() + 22_000;
    const compilerHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.LATEX_COMPILER_TOKEN}`,
      ...(env.LATEX_ACCESS_CLIENT_ID && env.LATEX_ACCESS_CLIENT_SECRET
        ? {
            "CF-Access-Client-Id": env.LATEX_ACCESS_CLIENT_ID,
            "CF-Access-Client-Secret": env.LATEX_ACCESS_CLIENT_SECRET,
          }
        : {}),
    };
    const requestJob = async (method: "GET" | "POST") => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      const response = await fetch(
        new URL(
          method === "GET" ? `/jobs/${job.id}` : "/jobs",
          env.LATEX_COMPILER_URL,
        ),
        {
          method,
          headers: compilerHeaders,
          body:
            method === "GET"
              ? undefined
              : JSON.stringify({
                  jobId: job.id,
                  mainFile: source.mainFile,
                  engine: "pdflatex",
                  files: source.files.map((file) => ({
                    path: file.path,
                    contentBase64:
                      file.encoding === "base64"
                        ? file.content
                        : toBase64(encode.encode(file.content)),
                  })),
                }),
          signal: AbortSignal.timeout(
            Math.min(method === "POST" ? 8_000 : 4_000, remaining),
          ),
        },
      );
      if (!response.ok) {
        const failure = new Error(`Compiler returned ${response.status}.`);
        Object.assign(failure, { status: response.status });
        throw failure;
      }
      const bytes = await readLimitedBody(response, 24 * 1024 * 1024);
      return z
        .object({
          status: z.enum([
            "queued",
            "running",
            "succeeded",
            "failed",
            "cancelled",
          ]),
          result: compilerResultSchema.optional(),
        })
        .parse(JSON.parse(new TextDecoder().decode(bytes)));
    };
    let remote;
    try {
      remote = await requestJob(retrieveOnly ? "GET" : "POST");
    } catch (failure) {
      if (retrieveOnly && compilerStatus(failure) === 404)
        remote = await requestJob("POST");
      else throw failure;
    }
    while (
      remote &&
      !retrieveOnly &&
      ["queued", "running"].includes(remote.status) &&
      Date.now() + 1000 < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        remote = await requestJob("GET");
      } catch (failure) {
        if (compilerStatus(failure) === 404) remote = await requestJob("POST");
        else throw failure;
      }
    }
    if (!remote) return;
    if (["queued", "running"].includes(remote.status)) return;
    if (remote.status === "cancelled") {
      await mutateJobs(env, owner, assetId, (jobs) =>
        jobs.map((item) =>
          item.id === job.id
            ? { ...item, status: "cancelled", finishedAt: now() }
            : item,
        ),
      );
      return;
    }
    if (!remote.result)
      throw new Error(
        "Compiler returned no result. Recompile the saved source.",
      );
    const result = remote.result;
    const latest = await asset(env, owner, assetId);
    if (
      latexJobs(latest.data).find((item) => item.id === job.id)?.status ===
      "cancelled"
    )
      return;
    const jobResult: LatexJob = {
      ...job,
      status: result.success ? "succeeded" : "failed",
      finishedAt: now(),
      log: result.log.slice(-1800),
      metadata: result.metadata,
      diagnostics: result.diagnostics
        .slice(0, 8)
        .map((value) => ({ ...value, message: value.message.slice(0, 200) })),
    };
    const save = async (name: string, type: string, content: Uint8Array) => {
      const file = await saveAttachment(
        env,
        owner,
        assetId,
        name,
        type,
        content,
      );
      attachments.push(file.id);
      return file.id;
    };
    jobResult.logAttachmentId = await save(
      `latex-build-${job.id}.json`,
      "application/json",
      encode.encode(
        JSON.stringify({
          log: result.log,
          diagnostics: result.diagnostics,
          metadata: result.metadata,
          fonts: result.fonts,
        }),
      ),
    );
    if (result.success) {
      if (!result.pdfBase64) throw new Error("Compiler did not return a PDF.");
      jobResult.pdfAttachmentId = await save(
        documentPdfFilename(started, `document-${job.id}.pdf`),
        "application/pdf",
        fromBase64(result.pdfBase64),
      );
      jobResult.textAttachmentId = await save(
        `document-${job.id}.txt`,
        "text/plain",
        encode.encode(result.text || "No extractable text was found."),
      );
      if (result.synctexBase64)
        jobResult.synctexAttachmentId = await save(
          `synctex-${job.id}.json`,
          "application/json",
          encode.encode(JSON.stringify({ base64: result.synctexBase64 })),
        );
    }
    let published = false;
    await mutateJobs(env, owner, assetId, (jobs) => {
      published = false;
      return jobs.map((item) => {
        if (item.id !== job.id || item.status !== "running") return item;
        published = true;
        return jobResult;
      });
    });
    if (!published)
      for (const attachmentId of attachments)
        await discardAttachment(env, owner, attachmentId);
  } catch (error) {
    for (const attachmentId of attachments)
      await discardAttachment(env, owner, attachmentId).catch(() => {});
    if (retryableCompilerFailure(error)) return;
    await mutateJobs(env, owner, assetId, (jobs) =>
      jobs.map((item) =>
        item.id === job.id && ["queued", "running"].includes(item.status)
          ? {
              ...item,
              status: "failed",
              finishedAt: now(),
              log:
                error instanceof Error ? error.message : "Compilation failed.",
            }
          : item,
      ),
    ).catch(() => {});
  }
}

latexRoutes.get("/:assetId", async (context) => {
  const owner = context.get("user").id;
  const record = await asset(context.env, owner, context.req.param("assetId"));
  return context.json({
    project: await projectResponse(context.env, owner, record),
    configured: Boolean(
      context.env.LATEX_COMPILER_URL && context.env.LATEX_COMPILER_TOKEN,
    ),
  });
});
latexRoutes.put("/:assetId", async (context) => {
  const owner = context.get("user").id;
  const record = await asset(context.env, owner, context.req.param("assetId"));
  const { expectedVersion, ...rawSource } = parse(
    latexSaveSchema,
    await input(context.req.raw),
  );
  if (expectedVersion !== record.version)
    throw new ApiError(
      409,
      "VERSION_CONFLICT",
      "This document changed in another session. Keep your draft and reload before saving.",
    );
  const source = {
    ...parse(latexSourceSchema, rawSource),
    engine: "pdflatex" as const,
  };
  const next = await saveSource(context.env, owner, record, source);
  const revisionId = latexMetadata(next.data)?.revisionId;
  const queued = revisionId
    ? await enqueueCompile(context.env, owner, next.id, revisionId, true)
    : null;
  const saved = queued ? await asset(context.env, owner, next.id) : next;
  if (queued?.created)
    context.executionCtx.waitUntil(
      autoCompileAfterSave(
        context.env,
        owner,
        next.id,
        revisionId!,
        queued.job.id,
      ),
    );
  return context.json({
    project: await projectResponse(context.env, owner, saved),
    record: saved,
  });
});
latexRoutes.post("/:assetId/copy", async (context) => {
  const owner = context.get("user").id;
  const sourceRecord = await asset(
    context.env,
    owner,
    context.req.param("assetId"),
  );
  const { targetAssetId } = parse(
    z.object({ targetAssetId: z.string().min(1) }).strict(),
    await input(context.req.raw),
  );
  if (targetAssetId === sourceRecord.id)
    throw new ApiError(400, "INVALID_COPY", "Choose a different document.");
  const target = await asset(context.env, owner, targetAssetId);
  const revisionId = latexMetadata(sourceRecord.data)?.revisionId;
  if (!revisionId)
    throw new ApiError(
      400,
      "NO_SOURCE",
      "Save the source before copying this document.",
    );
  const originalSource = await sourceRevision(
    context.env,
    owner,
    sourceRecord,
    revisionId,
  );
  const source = { ...originalSource, engine: "pdflatex" as const };
  // A retry after a lost response may already have saved the independent copy.
  if (
    latexMetadata(target.data) &&
    latexMetadata(target.data)?.inputHash !== (await latexInputHash(source))
  )
    throw new ApiError(
      409,
      "PROJECT_EXISTS",
      "The target document already contains a different project.",
    );
  const next = await saveSource(context.env, owner, target, source);
  const targetRevisionId = latexMetadata(next.data)?.revisionId;
  const queued = targetRevisionId
    ? await enqueueCompile(context.env, owner, next.id, targetRevisionId, true)
    : null;
  const saved = queued ? await asset(context.env, owner, next.id) : next;
  if (queued?.created)
    context.executionCtx.waitUntil(
      autoCompileAfterSave(
        context.env,
        owner,
        next.id,
        targetRevisionId!,
        queued.job.id,
      ),
    );
  return context.json({
    project: await projectResponse(context.env, owner, saved),
    record: saved,
  });
});
latexRoutes.post("/:assetId/compile", async (context) => {
  const owner = context.get("user").id;
  const record = await asset(context.env, owner, context.req.param("assetId"));
  const { revisionId } = parse(
    z.object({ revisionId: z.string().min(1) }).strict(),
    await input(context.req.raw),
  );
  const source = await sourceRevision(context.env, owner, record, revisionId);
  if (!hasCompileInput(source))
    throw new ApiError(
      400,
      "EMPTY_SOURCE",
      "Add content to the main .tex file before compiling.",
    );
  if (!context.env.LATEX_COMPILER_URL || !context.env.LATEX_COMPILER_TOKEN)
    throw new ApiError(
      503,
      "COMPILER_UNCONFIGURED",
      "The native TeX compiler has not been connected. Your LaTeX source is saved; compilation becomes available when the service is configured.",
    );
  const selected = await enqueueCompile(
    context.env,
    owner,
    record.id,
    revisionId,
  );
  if (!selected)
    throw new ApiError(
      404,
      "NOT_FOUND",
      "This source revision is unavailable.",
    );
  if (!selected.created)
    return context.json(
      { job: publicJob(selected.job) },
      selected.job.status === "succeeded" ? 200 : 202,
    );
  context.executionCtx.waitUntil(
    runCompile(context.env, owner, record.id, selected.job, source),
  );
  return context.json({ job: publicJob(selected.job) }, 202);
});
latexRoutes.get("/:assetId/jobs/:jobId", async (context) => {
  const record = await asset(
    context.env,
    context.get("user").id,
    context.req.param("assetId"),
  );
  let job = latexJobs(record.data).find(
    (item) => item.id === context.req.param("jobId"),
  );
  if (!job)
    throw new ApiError(404, "NOT_FOUND", "This compilation was not found.");
  if (
    ["queued", "running"].includes(job.status) &&
    context.env.LATEX_COMPILER_URL &&
    context.env.LATEX_COMPILER_TOKEN
  ) {
    const revision = await sourceRevision(
      context.env,
      context.get("user").id,
      record,
      job.revisionId,
    );
    await runCompile(
      context.env,
      context.get("user").id,
      record.id,
      job,
      revision,
      true,
    );
    job = latexJobs(
      (await asset(context.env, context.get("user").id, record.id)).data,
    ).find((item) => item.id === job!.id)!;
  }
  if (
    ["queued", "running"].includes(job.status) &&
    Date.parse(job.createdAt) < Date.now() - 600_000
  ) {
    const jobs = await mutateJobs(
      context.env,
      context.get("user").id,
      record.id,
      (jobs) =>
        jobs.map((item) =>
          item.id === job!.id
            ? {
                ...item,
                status: "failed",
                finishedAt: now(),
                log: "The compile job was interrupted. Recompile the saved source.",
              }
            : item,
        ),
    );
    job = jobs.find((item) => item.id === job!.id)!;
  }
  return context.json({ job: publicJob(job) });
});
latexRoutes.delete("/:assetId/jobs/:jobId", async (context) => {
  const owner = context.get("user").id;
  const record = await asset(context.env, owner, context.req.param("assetId"));
  const job = latexJobs(record.data).find(
    (item) => item.id === context.req.param("jobId"),
  );
  if (!job)
    throw new ApiError(404, "NOT_FOUND", "This compilation was not found.");
  if (!["queued", "running"].includes(job.status))
    return context.json({ job: publicJob(job) });
  const jobs = await mutateJobs(context.env, owner, record.id, (jobs) =>
    jobs.map((item) =>
      item.id === job.id
        ? { ...item, status: "cancelled", finishedAt: now() }
        : item,
    ),
  );
  if (context.env.LATEX_COMPILER_URL && context.env.LATEX_COMPILER_TOKEN)
    context.executionCtx.waitUntil(
      fetch(new URL(`/jobs/${job.id}`, context.env.LATEX_COMPILER_URL), {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${context.env.LATEX_COMPILER_TOKEN}`,
          ...(context.env.LATEX_ACCESS_CLIENT_ID &&
          context.env.LATEX_ACCESS_CLIENT_SECRET
            ? {
                "CF-Access-Client-Id": context.env.LATEX_ACCESS_CLIENT_ID,
                "CF-Access-Client-Secret":
                  context.env.LATEX_ACCESS_CLIENT_SECRET,
              }
            : {}),
        },
        signal: AbortSignal.timeout(5000),
      }).catch(() => {}),
    );
  return context.json({
    job: publicJob(jobs.find((item) => item.id === job.id)!),
  });
});
latexRoutes.post("/:assetId/submissions", async (context) => {
  const owner = context.get("user").id;
  const record = await asset(context.env, owner, context.req.param("assetId"));
  const { applicationId, jobId } = parse(
    z
      .object({
        applicationId: z.string().min(1),
        jobId: z.string().min(1),
        revisionId: z.string().optional(),
      })
      .strict(),
    await input(context.req.raw),
  );
  const application = await getRecord(context.env.DB, owner, applicationId);
  if (application.kind !== "application")
    throw new ApiError(
      400,
      "INVALID_APPLICATION",
      "Choose an application from your workspace.",
    );
  const job = latexJobs(record.data).find(
    (item) => item.id === jobId && item.status === "succeeded",
  );
  if (!job?.pdfAttachmentId)
    throw new ApiError(
      400,
      "NO_COMPILED_PDF",
      "Choose a successful compiled version to record as submitted.",
    );
  const previous = Array.isArray(record.data.submissions)
    ? (record.data.submissions as Record<string, unknown>[])
    : [];
  if (
    previous.some(
      (item) =>
        item.applicationId === applicationId &&
        item.revisionId === job.revisionId,
    )
  )
    return context.json({ record });
  if (previous.length >= 200)
    throw new ApiError(
      400,
      "SUBMISSION_LIMIT",
      "Create a new document variant before recording more submitted versions.",
    );
  const next = {
    ...record,
    version: record.version + 1,
    updatedAt: now(),
    data: {
      ...record.data,
      submissions: [
        ...previous,
        {
          applicationId,
          revisionId: job.revisionId,
          pdfAttachmentId: job.pdfAttachmentId,
          submittedAt: now(),
        },
      ],
    },
  };
  await writeRecord(context.env.DB, owner, next, record.version);
  return context.json({ record: next });
});
