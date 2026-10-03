import { z } from "zod";
import { RECORD_KINDS } from "../shared/model";
import { ApiError } from "./env";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 32 * 1024 * 1024;
export const MAX_BODY_CHARS = 500_000;
export const attachmentTypes = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);

const webUrl = z
  .string()
  .max(2048)
  .refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return (
        ["https:", "http:"].includes(url.protocol) &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, "Use an http or https URL without embedded credentials.");
const data = z
  .record(z.string(), z.unknown())
  .refine(
    (value) => JSON.stringify(value).length <= 100_000,
    "Record details are too large.",
  )
  .superRefine((value, context) => {
    // Fields consumed as destinations must not become javascript: links.
    const inspect = (item: unknown, depth: number) => {
      if (depth > 12) {
        context.addIssue({
          code: "custom",
          message: "Record details are nested too deeply.",
        });
        return;
      }
      if (!item || typeof item !== "object") return;
      for (const [key, child] of Object.entries(item)) {
        if (
          /^(url|website|sourceUrl|jobUrl|overleaf|linkedin|github|demoUrl|repoUrl)$/i.test(
            key,
          ) &&
          typeof child === "string" &&
          !webUrl.safeParse(child).success
        ) {
          context.addIssue({
            code: "custom",
            message: `${key} must be an http or https URL.`,
          });
        }
        if (child && typeof child === "object") inspect(child, depth + 1);
      }
    };
    inspect(value, 0);
  });
const fields = {
  title: z.string().trim().min(1).max(240),
  body: z.string().max(MAX_BODY_CHARS).default(""),
  tags: z
    .array(z.string().trim().min(1).max(60))
    .max(40)
    .default([])
    .transform((items) => [...new Set(items)]),
  links: z
    .array(z.string().min(1).max(120))
    .max(100)
    .default([])
    .transform((items) => [...new Set(items)]),
  data: data.default({}),
};
export const recordSchema = z
  .object({ kind: z.enum(RECORD_KINDS), ...fields })
  .strict();
export const patchSchema = z
  .object({
    title: fields.title.optional(),
    body: z.string().max(MAX_BODY_CHARS).optional(),
    // Patch fields intentionally have no defaults: absent fields must be retained.
    tags: z
      .array(z.string().trim().min(1).max(60))
      .max(40)
      .transform((items) => [...new Set(items)])
      .optional(),
    links: z
      .array(z.string().min(1).max(120))
      .max(100)
      .transform((items) => [...new Set(items)])
      .optional(),
    data: data.optional(),
    version: z.number().int().positive(),
  })
  .strict();
export const preferencesSchema = z
  .object({
    timezone: z
      .string()
      .max(80)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Unknown timezone."),
    theme: z.enum(["light", "dark"]),
    displayName: z.string().max(100),
    github: webUrl,
    linkedin: webUrl,
    website: webUrl,
    leetcode: webUrl,
    overleaf: webUrl,
    currentCompany: z.string().max(200),
    stack: z.string().max(1000),
    weeklyHours: z.number().min(0).max(168),
    weeklyApplications: z.number().int().min(0).max(1000),
    weeklyPractice: z.number().int().min(0).max(1000),
    customStages: z
      .array(z.string().trim().min(1).max(80))
      .min(1)
      .max(30)
      .transform((items) => [...new Set(items)]),
    reducedMotion: z.boolean(),
  })
  .strict();
export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(160)
  .regex(/^[a-zA-Z0-9._:-]+$/);
export const importSchema = z
  .object({
    source: z.string().trim().min(1).max(200),
    mode: z.enum(["keep", "replace", "merge"]).default("keep"),
    idempotencyKey: idempotencyKeySchema.optional(),
    records: z
      .array(
        z
          .object({
            sourceId: z.string().min(1).max(1000),
            hash: z.string().min(1).max(200),
            record: recordSchema,
            attachments: z
              .array(
                z
                  .object({
                    filename: z.string().min(1).max(240),
                    contentType: z.string().max(100),
                    base64: z.string().max(14_000_000),
                  })
                  .strict(),
              )
              .max(20)
              .default([]),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export type ImportPayload = z.infer<typeof importSchema>;

export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "Please check the supplied fields.",
      result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  return result.data;
}

export async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new ApiError(
      415,
      "JSON_REQUIRED",
      "Send JSON with Content-Type: application/json.",
    );
  const text = await readLimitedBody(request, MAX_REQUEST_BYTES);
  try {
    return JSON.parse(new TextDecoder().decode(text));
  } catch {
    throw new ApiError(
      400,
      "INVALID_JSON",
      "The request body is not valid JSON.",
    );
  }
}

export async function readLimitedBody(
  request: Pick<Request, "body" | "headers">,
  limit: number,
): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length")) > limit)
    throw new ApiError(413, "REQUEST_TOO_LARGE", "The request is too large.");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new ApiError(
          413,
          "REQUEST_TOO_LARGE",
          "The request is too large.",
        );
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export function filename(value: string): string {
  // eslint-disable-next-line no-control-regex -- Remove controls from a download header filename.
  const clean = value
    .split(/[\\/]/)
    .pop()
    ?.replace(/[\x00-\x1f\x7f"<>:|?*]/g, "_")
    .trim()
    .slice(0, 240);
  return clean || "attachment";
}

export async function hashValue(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function searchExpression(query: string): string {
  return (
    query
      .match(/[\p{L}\p{N}_]+/gu)
      ?.slice(0, 16)
      .map((token) => `"${token.replace(/"/g, '""')}"*`)
      .join(" AND ") || ""
  );
}
