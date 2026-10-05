import { Hono } from "hono";
import { z } from "zod";
import {
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
import { ApiError, id, now, type Env, type Variables } from "./env";
import { getRecord, writeRecord, type AttachmentRow } from "./db/records";
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
async function asset(
  env: Env,
  owner: string,
  assetId: string,
  includeDeleted = false,
) {
  const record = await getRecord(env.DB, owner, assetId, includeDeleted);
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
  const latest = [...latexJobs(record.data)]
    .reverse()
    .find((job) => job.status === "succeeded");
  return {
    ...source,
    version: record.version,
    revisionId,
    ...(latest ? { latestSuccessfulJob: publicJob(latest) } : {}),
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
  extra: Record<string, unknown> = {},
) {
  const inputHash = await latexInputHash(source);
  if (
    latexMetadata(record.data)?.inputHash === inputHash &&
    !Object.keys(extra).length
  )
    return record;
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
      ...extra,
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
  mutate: (jobs: LatexJob[]) => LatexJob[],
) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const record = await asset(env, owner, assetId);
    const old = latexJobs(record.data);
    const next = mutate(old);
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
const metadataSchema = z
  .object({
    imageDigest: z.string().max(200).optional(),
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

async function runCompile(
  env: Env,
  owner: string,
  assetId: string,
  job: LatexJob,
  source: LatexSource,
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
    const url = new URL("/compile", env.LATEX_COMPILER_URL);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.LATEX_COMPILER_TOKEN}`,
      },
      body: JSON.stringify({
        jobId: job.id,
        mainFile: source.mainFile,
        engine: source.engine,
        files: source.files.map((file) => ({
          path: file.path,
          contentBase64:
            file.encoding === "base64"
              ? file.content
              : toBase64(encode.encode(file.content)),
        })),
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) throw new Error(`Compiler returned ${response.status}.`);
    const bytes = await readLimitedBody(response, 24 * 1024 * 1024);
    const result = compilerResultSchema.parse(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
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
        `document-${job.id}.pdf`,
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
    await mutateJobs(env, owner, assetId, (jobs) =>
      jobs.map((item) =>
        item.id === job.id && item.status !== "cancelled"
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
  const source = parse(latexSourceSchema, rawSource);
  const next = await saveSource(context.env, owner, record, source);
  return context.json({
    project: await projectResponse(context.env, owner, next),
    record: next,
  });
});
latexRoutes.get("/:assetId/revisions", async (context) => {
  const owner = context.get("user").id;
  const record = await asset(context.env, owner, context.req.param("assetId"));
  const rows = await context.env.DB.prepare(
    "SELECT * FROM attachments WHERE owner_id=? AND record_id=? AND filename LIKE 'latex-source-%.json' ORDER BY created_at DESC LIMIT 100",
  )
    .bind(owner, record.id)
    .all<AttachmentRow>();
  return context.json({
    revisions: rows.results.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
    })),
  });
});
latexRoutes.get("/:assetId/revisions/:revisionId", async (context) => {
  const owner = context.get("user").id;
  const record = await asset(
    context.env,
    owner,
    context.req.param("assetId"),
    true,
  );
  return context.json({
    project: await projectResponse(
      context.env,
      owner,
      record,
      context.req.param("revisionId"),
    ),
  });
});
latexRoutes.post("/:assetId/fork", async (context) => {
  const owner = context.get("user").id;
  const record = await asset(context.env, owner, context.req.param("assetId"));
  const { targetAssetId } = parse(
    z.object({ targetAssetId: z.string().min(1) }).strict(),
    await input(context.req.raw),
  );
  if (targetAssetId === record.id)
    throw new ApiError(
      400,
      "INVALID_FORK",
      "Choose an independent document for a fork.",
    );
  const target = await asset(context.env, owner, targetAssetId);
  if (latexMetadata(target.data))
    throw new ApiError(
      409,
      "PROJECT_EXISTS",
      "The target document already contains a project.",
    );
  const revisionId = latexMetadata(record.data)?.revisionId;
  if (!revisionId)
    throw new ApiError(
      400,
      "NO_SOURCE",
      "Import or create the source before forking this document.",
    );
  const next = await saveSource(
    context.env,
    owner,
    target,
    await sourceRevision(context.env, owner, record, revisionId),
    { parentVariantId: record.id, forkRevisionId: revisionId },
  );
  return context.json({
    project: await projectResponse(context.env, owner, next),
    record: next,
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
  const reusable = (job: LatexJob) =>
    job.revisionId === revisionId &&
    (job.status === "succeeded" ||
      (["queued", "running"].includes(job.status) &&
        Date.parse(job.createdAt) > Date.now() - 60_000));
  const existing = [...latexJobs(record.data)].reverse().find(reusable);
  if (existing) return context.json({ job: publicJob(existing) });
  if (!context.env.LATEX_COMPILER_URL || !context.env.LATEX_COMPILER_TOKEN)
    throw new ApiError(
      503,
      "COMPILER_UNCONFIGURED",
      "The native TeX compiler has not been connected. Your LaTeX source is saved; compilation becomes available when the service is configured.",
    );
  const job: LatexJob = {
    id: id(),
    revisionId,
    status: "queued",
    createdAt: now(),
    log: "",
  };
  let selected = job;
  await mutateJobs(context.env, owner, record.id, (jobs) => {
    const duplicate = [...jobs].reverse().find(reusable);
    if (duplicate) {
      selected = duplicate;
      return jobs;
    }
    selected = job;
    return [
      ...jobs
        .filter(
          (item) =>
            !["queued", "running"].includes(item.status) ||
            Date.parse(item.createdAt) > Date.now() - 60_000,
        )
        .slice(-(MAX_JOBS - 1)),
      job,
    ];
  });
  if (selected.id !== job.id)
    return context.json(
      { job: publicJob(selected) },
      selected.status === "succeeded" ? 200 : 202,
    );
  context.executionCtx.waitUntil(
    runCompile(context.env, owner, record.id, job, source),
  );
  return context.json({ job: publicJob(job) }, 202);
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
    Date.parse(job.createdAt) < Date.now() - 60_000
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
