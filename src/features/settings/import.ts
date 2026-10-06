import type { RecordInput } from "../../../shared/model";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const MAX_NOTE_CHARS = 500_000;
const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  pdf: "application/pdf",
};
export interface ImportAttachment {
  filename: string;
  contentType: string;
  base64: string;
}
export interface ParsedImportRecord {
  sourceId: string;
  hash: string;
  record: RecordInput;
  attachments: ImportAttachment[];
}
export interface ImportPreview {
  records: ParsedImportRecord[];
  warnings: string[];
  errors: string[];
  stats: {
    markdownFiles: number;
    records: number;
    attachments: number;
    bytes: number;
    unresolvedLinks: number;
  };
}
interface SelectedFile {
  file: File;
  path: string;
  sourceId: string;
}

export function cleanNotionTitle(value: string): string {
  return (
    value
      .replace(/\.(?:md|markdown|pdf)$/i, "")
      .replace(/\s+[a-f0-9]{32}$/i, "")
      .replace(/[_*`]/g, "")
      .trim() || "Imported note"
  );
}
function extension(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}
function basename(path: string): string {
  return path.split("/").pop() ?? path;
}
function normalisePath(value: string): string | null {
  const parts: string[] = [];
  for (const part of value.replace(/\\/g, "/").normalize("NFC").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}
function resolveRelative(path: string, fromPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (
    /^[a-z][a-z0-9+.-]*:/i.test(decoded) ||
    decoded.startsWith("//") ||
    decoded.startsWith("/")
  )
    return null;
  const directory = fromPath.includes("/")
    ? fromPath.slice(0, fromPath.lastIndexOf("/") + 1)
    : "";
  return normalisePath(directory + decoded);
}
async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function toBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8192)
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  return btoa(chunks.join(""));
}
function signatureMatches(type: string, bytes: Uint8Array): boolean {
  const starts = (...signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);
  return type === "image/png"
    ? starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    : type === "image/jpeg"
      ? starts(0xff, 0xd8, 0xff)
      : type === "application/pdf"
        ? starts(0x25, 0x50, 0x44, 0x46, 0x2d)
        : false;
}
function historicalDate(body: string): string {
  const value =
    /^(?:created(?: time|_time| at|_at)?|date|original date):\s*(\d{4}-\d{2}-\d{2}(?:T[^\n]+)?)/im.exec(
      body,
    )?.[1] ?? "";
  return value && !Number.isNaN(new Date(value).getTime()) ? value : "";
}
function protectCode(markdown: string): {
  text: string;
  restore: (value: string) => string;
} {
  const preserved: string[] = [];
  const prefix = `WORK_IMPORT_CODE_${crypto.randomUUID()}_`;
  const token = (value: string) => {
    const key = `${prefix}${preserved.length}__`;
    preserved.push(value);
    return key;
  };
  const lines = markdown.split(/(?<=\n)/);
  let text = "";
  let fence = "";
  let code = "";
  for (const line of lines) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (!fence && marker) {
      fence = marker;
      code = line;
      continue;
    }
    if (fence) {
      code += line;
      if (
        marker &&
        marker[0] === fence[0] &&
        marker.length >= fence.length &&
        line.trim() === marker
      ) {
        text += token(code);
        fence = "";
        code = "";
      }
      continue;
    }
    text += line;
  }
  if (code) text += token(code);
  text = text.replace(/(`+)([\s\S]*?)\1(?!`)/g, (value) => token(value));
  return {
    text,
    restore: (value) =>
      value.replace(
        new RegExp(`${prefix}(\\d+)__`, "g"),
        (_match, index: string) => preserved[Number(index)] ?? "",
      ),
  };
}

/** Parse only files selected by the user. No filesystem access or remote fetches. */
export async function parseMarkdownFiles(
  files: File[],
): Promise<ImportPreview> {
  const preview: ImportPreview = {
    records: [],
    warnings: [],
    errors: [],
    stats: {
      markdownFiles: 0,
      records: 0,
      attachments: 0,
      bytes: 0,
      unresolvedLinks: 0,
    },
  };
  const warn = (message: string) => {
    if (!preview.warnings.includes(message)) preview.warnings.push(message);
  };
  if (!files.length) {
    preview.errors.push(
      "Select Markdown notes, a Notion export folder, or a resume PDF.",
    );
    return preview;
  }
  const supported = files.filter((file) =>
    /\.(?:md|markdown|png|jpe?g|pdf)$/i.test(file.name),
  );
  const totalBytes = supported.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_IMPORT_BYTES) {
    preview.errors.push(
      "This selection is larger than 20 MB. Split the export into smaller folders or batches.",
    );
    return preview;
  }
  for (const file of files.filter((file) => !supported.includes(file)))
    warn(
      `${file.name}: unsupported export file. CSV databases, HTML, archives and other formats were not imported; export pages as Markdown or add the content manually.`,
    );
  const relativePaths = supported.map(
    (file) => file.webkitRelativePath || file.name,
  );
  const directorySelection =
    supported.length > 0 &&
    supported.every((file) => !!file.webkitRelativePath);
  const commonRoot =
    directorySelection &&
    relativePaths.every(
      (path) => path.split("/")[0] === relativePaths[0].split("/")[0],
    )
      ? relativePaths[0].split("/")[0] + "/"
      : "";
  const selected: SelectedFile[] = [];
  for (let index = 0; index < supported.length; index++) {
    const file = supported[index];
    const rawPath = relativePaths[index];
    const path = normalisePath(
      commonRoot ? rawPath.slice(commonRoot.length) : rawPath,
    );
    if (!path || path.length > 1000) {
      preview.errors.push(
        `${file.name}: the relative path is invalid or too long. Rename it and select again.`,
      );
      continue;
    }
    selected.push({
      file,
      path,
      sourceId: `${/\.pdf$/i.test(path) ? "pdf" : "markdown"}:${await sha256(path)}`,
    });
  }
  const byPath = new Map<string, SelectedFile[]>();
  const byName = new Map<string, SelectedFile[]>();
  for (const item of selected) {
    byPath.set(item.path, [...(byPath.get(item.path) ?? []), item]);
    byName.set(basename(item.path), [
      ...(byName.get(basename(item.path)) ?? []),
      item,
    ]);
  }
  const unique = selected.filter((item) => byPath.get(item.path)?.length === 1);
  for (const [path, group] of byPath)
    if (group.length > 1)
      preview.errors.push(
        `${path}: ${group.length} selected files share this path. Select a folder to preserve the directory structure; none of these ambiguous copies were chosen.`,
      );
  const markdown = unique.filter((item) =>
    /\.(?:md|markdown)$/i.test(item.path),
  );
  preview.stats.markdownFiles = markdown.length;
  if (markdown.length > 100) {
    preview.errors.push(
      "There are more than 100 Markdown pages. Import smaller groups of up to 100 notes.",
    );
    return preview;
  }
  const binaryCache = new Map<
    string,
    { bytes: Uint8Array; hash: string; contentType: string }
  >();
  const usedAttachments = new Set<string>();
  let includedBytes = markdown.reduce((sum, item) => sum + item.file.size, 0);
  async function loadBinary(item: SelectedFile) {
    const cached = binaryCache.get(item.path);
    if (cached) return cached;
    if (!item.file.size || item.file.size > MAX_FILE_BYTES) {
      preview.errors.push(
        `${item.path}: attachments must contain data and be no larger than 10 MB.`,
      );
      return null;
    }
    const contentType = MIME[extension(item.path)];
    if (!contentType) return null;
    const bytes = new Uint8Array(await item.file.arrayBuffer());
    if (!signatureMatches(contentType, bytes)) {
      preview.errors.push(
        `${item.path}: contents do not match the ${contentType} format. Re-export or choose the original file.`,
      );
      return null;
    }
    const result = { bytes, hash: await sha256(bytes), contentType };
    binaryCache.set(item.path, result);
    return result;
  }
  for (const item of markdown) {
    let raw: string;
    try {
      raw = await item.file.text();
    } catch {
      preview.errors.push(
        `${item.path}: could not read this note. Select the file again.`,
      );
      continue;
    }
    if (raw.length > MAX_NOTE_CHARS) {
      preview.errors.push(
        `${item.path}: the note exceeds 500,000 characters. Split it into smaller pages.`,
      );
      continue;
    }
    const protectedMarkdown = protectCode(raw);
    const heading = /^#\s+(.+?)\s*#*\s*$/m.exec(protectedMarkdown.text)?.[1];
    const title = cleanNotionTitle(
      heading ? protectedMarkdown.restore(heading) : basename(item.path),
    ).slice(0, 240);
    const attachments: ImportAttachment[] = [];
    const fingerprints: string[] = [];
    const links: string[] = [];
    const localReplacements = new Map<string, string>();
    const names = new Set<string>();
    const nameByPath = new Map<string, string>();
    const candidates = [
      ...protectedMarkdown.text.matchAll(
        /(!?\[[^\]\n]*\])\((<[^>\n]+>|[^\s()]+(?:\([^\n)]*\)[^\s()]*)*)(?:\s+(?:"[^"]*"|'[^']*'))?\)/g,
      ),
    ].map((match) => ({ target: match[2].replace(/^<|>$/g, "") }));
    for (const match of protectedMarkdown.text.matchAll(
      /^\s*\[[^\]\n]+\]:\s*(<[^>\n]+>|\S+)/gm,
    ))
      candidates.push({ target: match[1].replace(/^<|>$/g, "") });
    for (const { target } of candidates) {
      if (
        !target ||
        target.startsWith("#") ||
        /^(?:https?:|mailto:|tel:)/i.test(target) ||
        localReplacements.has(target)
      )
        continue;
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) {
        warn(
          `${item.path}: the link “${target}” uses an unsupported local or custom scheme. It remains as reference text.`,
        );
        continue;
      }
      const hashIndex = target.indexOf("#");
      const fragment = hashIndex >= 0 ? target.slice(hashIndex) : "";
      const pathTarget = (
        hashIndex >= 0 ? target.slice(0, hashIndex) : target
      ).split("?")[0];
      const resolved = resolveRelative(pathTarget, item.path);
      let targetFile: SelectedFile | undefined;
      if (resolved) {
        const exact = byPath.get(resolved);
        if (exact?.length === 1) targetFile = exact[0];
        else if (!exact) {
          let decodedName = "";
          try {
            decodedName = basename(decodeURIComponent(pathTarget));
          } catch {
            /* Malformed percent encoding remains unresolved. */
          }
          const matches = byName.get(decodedName);
          if (matches?.length === 1) targetFile = matches[0];
          else if (matches && matches.length > 1)
            warn(
              `${item.path}: “${target}” matches ${matches.length} files named ${decodedName}. Select the original folder or correct the relative link; no arbitrary match was used.`,
            );
        }
      }
      if (!targetFile) {
        preview.stats.unresolvedLinks++;
        warn(
          `${item.path}: could not resolve “${target}”. Include the linked file in the selection or fix its relative path. The original link is retained.`,
        );
        continue;
      }
      if (/\.(?:md|markdown)$/i.test(targetFile.path)) {
        localReplacements.set(
          target,
          `work-source://${encodeURIComponent(targetFile.sourceId)}${fragment}`,
        );
        if (
          !links.includes(targetFile.sourceId) &&
          targetFile.sourceId !== item.sourceId
        )
          links.push(targetFile.sourceId);
        continue;
      }
      const binary = await loadBinary(targetFile);
      if (!binary) continue;
      const existingName = nameByPath.get(targetFile.path);
      if (existingName) {
        localReplacements.set(
          target,
          `work-attachment://${encodeURIComponent(existingName)}${fragment}`,
        );
        continue;
      }
      let attachmentName = basename(targetFile.path).slice(0, 220);
      if (names.has(attachmentName))
        attachmentName = attachmentName.replace(
          /(\.[^.]+)$/,
          `-${binary.hash.slice(0, 8)}$1`,
        );
      const existing = attachments.find(
        (attachment) => attachment.filename === attachmentName,
      );
      if (!existing) {
        if (attachments.length >= 20) {
          preview.errors.push(
            `${item.path}: this note links more than 20 attachments. Split it into smaller notes.`,
          );
          continue;
        }
        attachments.push({
          filename: attachmentName,
          contentType: binary.contentType,
          base64: toBase64(binary.bytes),
        });
        fingerprints.push(`${targetFile.path}:${binary.hash}`);
        names.add(attachmentName);
        nameByPath.set(targetFile.path, attachmentName);
        includedBytes += binary.bytes.length;
        usedAttachments.add(targetFile.path);
      }
      localReplacements.set(
        target,
        `work-attachment://${encodeURIComponent(attachmentName)}${fragment}`,
      );
    }
    const replaceTarget = (target: string) =>
      localReplacements.get(target.replace(/^<|>$/g, "")) ?? target;
    let body = protectedMarkdown.text.replace(
      /(!?\[[^\]\n]*\])\((<[^>\n]+>|[^\s()]+(?:\([^\n)]*\)[^\s()]*)*)(\s+(?:"[^"]*"|'[^']*'))?\)/g,
      (_match, label: string, target: string, caption: string | undefined) =>
        `${label}(${replaceTarget(target)}${caption ?? ""})`,
    );
    body = body.replace(
      /^(\s*\[[^\]\n]+\]:\s*)(<[^>\n]+>|\S+)/gm,
      (_match, prefix: string, target: string) =>
        prefix + replaceTarget(target),
    );
    body = protectedMarkdown.restore(body);
    const data = {
      collection: "Imported notes",
      originalPath: item.path,
      sourceFiles: [item.path],
      source: "Markdown / Notion export",
      sourceDate: historicalDate(raw),
      historical: true,
      exportedFileModifiedAt: new Date(item.file.lastModified).toISOString(),
      originalContentHash: await sha256(raw),
      ...(raw.length <= 70_000 ? { originalMarkdown: raw } : {}),
    };
    if (raw.length > 70_000)
      warn(
        `${item.path}: full note content is retained in the body. To stay within metadata limits, its provenance stores a fingerprint instead of a second copy of the source text.`,
      );
    preview.records.push({
      sourceId: item.sourceId,
      hash: await sha256(
        JSON.stringify({ raw, attachments: fingerprints.sort() }),
      ),
      record: {
        kind: "note",
        title,
        body,
        tags: ["imported", "historical reference"],
        links,
        data,
      },
      attachments,
    });
  }
  // A separately selected PDF remains useful even without a Markdown wrapper.
  const standalonePdfs = unique.filter(
    (item) => extension(item.path) === "pdf" && !usedAttachments.has(item.path),
  );
  for (const item of standalonePdfs) {
    const binary = await loadBinary(item);
    if (!binary) continue;
    const resume =
      /(?:r[eé]sum[eé]|\bcv\b)/i.test(basename(item.path)) ||
      (markdown.length === 0 && standalonePdfs.length === 1);
    includedBytes += binary.bytes.length;
    usedAttachments.add(item.path);
    const filename = basename(item.path).slice(0, 240);
    preview.records.push({
      sourceId: item.sourceId,
      hash: binary.hash,
      record: {
        kind: "asset",
        title: cleanNotionTitle(filename),
        body: `Imported ${resume ? "resume" : "document"} PDF. Review the content and label this version before linking it to an application.\n\n[Open PDF](work-attachment://${encodeURIComponent(filename)})`,
        tags: ["imported"],
        links: [],
        data: {
          subtype: resume ? "resume" : "document",
          type: resume ? "Resume" : "Document",
          originalPath: item.path,
          sourceFiles: [item.path],
          source: "PDF upload",
          versionLabel: "Imported PDF",
          exportedFileModifiedAt: new Date(
            item.file.lastModified,
          ).toISOString(),
          verified: false,
        },
      },
      attachments: [
        {
          filename,
          contentType: binary.contentType,
          base64: toBase64(binary.bytes),
        },
      ],
    });
  }
  const missingSourceIds = new Set(
    preview.records.map((record) => record.sourceId),
  );
  for (const item of preview.records) {
    const invalid =
      item.record.links?.filter((id) => !missingSourceIds.has(id)) ?? [];
    if (invalid.length) {
      preview.errors.push(
        `${item.record.title}: a linked note could not be imported. Fix the file errors before proceeding so relationships remain intact.`,
      );
      item.record.links = item.record.links?.filter((id) =>
        missingSourceIds.has(id),
      );
    }
  }
  for (const item of unique.filter(
    (item) => MIME[extension(item.path)] && !usedAttachments.has(item.path),
  ))
    warn(
      `${item.path}: not linked from an imported Markdown note. Add a Markdown image/link reference or upload it to a note after import.`,
    );
  preview.stats.records = preview.records.length;
  preview.stats.attachments = preview.records.reduce(
    (sum, item) => sum + item.attachments.length,
    0,
  );
  preview.stats.bytes = includedBytes;
  if (preview.records.length > 100)
    preview.errors.push(
      "This batch contains more than 100 records including PDFs. Select a smaller group.",
    );
  if (preview.stats.attachments > 40)
    preview.errors.push(
      "This batch contains more than 40 linked attachments. Select a smaller group.",
    );
  if (includedBytes > MAX_IMPORT_BYTES)
    preview.errors.push(
      "Shared attachments are copied to each connected note, making this batch larger than 20 MB. Split the import into smaller groups.",
    );
  if (
    new TextEncoder().encode(JSON.stringify(preview.records)).length >
    31 * 1024 * 1024
  )
    preview.errors.push(
      "The encoded import is too large for one request. Split it into smaller batches.",
    );
  if (!preview.records.length && !preview.errors.length)
    preview.errors.push(
      "No importable Markdown notes or PDF assets were found. Select the export folder containing .md pages and their attachments.",
    );
  return preview;
}
