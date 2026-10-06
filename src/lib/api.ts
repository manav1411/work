import type { Attachment, RecordRevision } from "../../shared/model";

export class ApiError extends Error {
  status: number;
  details: unknown;
  constructor(message: string, status = 0, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export type ApiAdapter = (path: string, init?: RequestInit) => Promise<unknown>;
let adapter: ApiAdapter | null = null;
let fileResolver: ((id: string) => Promise<string>) | null = null;

export function setApiAdapter(
  next: ApiAdapter | null,
  resolver?: (id: string) => Promise<string>,
): void {
  adapter = next;
  fileResolver = resolver ?? null;
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (adapter) return (await adapter(path, init)) as T;
  const headers = new Headers(init.headers);
  if (
    init.body &&
    !(init.body instanceof FormData) &&
    !headers.has("Content-Type")
  )
    headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(
      "Connection interrupted. Your changes are kept on this device.",
    );
  }
  const data: unknown = response.headers
    .get("content-type")
    ?.includes("application/json")
    ? await response.json()
    : null;
  if (!response.ok) {
    const payload =
      data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const error = payload.error;
    const message =
      typeof error === "string"
        ? error
        : error && typeof error === "object" && "message" in error
          ? String(error.message)
          : typeof payload.message === "string"
            ? payload.message
            : `Request failed (${response.status})`;
    throw new ApiError(message, response.status, data);
  }
  return data as T;
}

export async function getAttachments(recordId: string): Promise<Attachment[]> {
  return (
    await request<{ attachments: Attachment[] }>(
      `/api/records/${encodeURIComponent(recordId)}/attachments`,
    )
  ).attachments;
}

export async function uploadAttachment(
  recordId: string,
  file: File,
): Promise<Attachment> {
  const data = new FormData();
  data.append("file", file);
  return (
    await request<{ attachment: Attachment }>(
      `/api/records/${encodeURIComponent(recordId)}/attachments`,
      { method: "POST", body: data },
    )
  ).attachment;
}

export async function removeAttachment(id: string): Promise<void> {
  await request(`/api/attachments/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function getRevisions(
  recordId: string,
): Promise<RecordRevision[]> {
  return (
    await request<{ revisions: RecordRevision[] }>(
      `/api/records/${encodeURIComponent(recordId)}/revisions`,
    )
  ).revisions;
}

export async function getAttachmentUrl(id: string): Promise<string> {
  return fileResolver
    ? fileResolver(id)
    : `/api/attachments/${encodeURIComponent(id)}`;
}

export function downloadFile(
  content: string | Blob,
  filename: string,
  type = "text/plain;charset=utf-8",
): void {
  const blob =
    content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function jsonRequest(method: string, body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) };
}
