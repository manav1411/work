import { createHash } from "node:crypto";
import { posix } from "node:path";
export const LIMITS = {
  files: 100,
  bytes: 5 * 1024 * 1024,
  body: 8 * 1024 * 1024,
  pdf: 10 * 1024 * 1024,
  log: 150000,
};
export function validateJob(input) {
  if (!input || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.jobId))
    throw new Error("Invalid job ID");
  if (input.engine !== "pdflatex") throw new Error("Unsupported engine");
  if (
    !Array.isArray(input.files) ||
    !input.files.length ||
    input.files.length > LIMITS.files
  )
    throw new Error("Invalid project files");
  const paths = new Set();
  let bytes = 0;
  const files = input.files.map((file) => {
    if (
      typeof file.path !== "string" ||
      file.path.length > 240 ||
      // eslint-disable-next-line no-control-regex
      /[\u0000-\u001f\u007f:\\`$'";|<>&*?!(){}[\]]/.test(file.path) ||
      file.path.startsWith("/") ||
      file.path.split("/").some((part) => !part || part.startsWith(".")) ||
      file.path.toLowerCase().split("/")[0] === "build" ||
      !/\.(tex|cls|sty|bib|bst|png|jpg|jpeg|pdf|eps|otf|ttf|woff2?|txt|csv|json|def|cfg|clo|fd|dat)$/i.test(
        file.path,
      )
    )
      throw new Error("Unsafe or unsupported source path");
    if (paths.has(file.path.toLowerCase()))
      throw new Error("Duplicate source path");
    if (
      typeof file.contentBase64 !== "string" ||
      file.contentBase64.length > LIMITS.body ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        file.contentBase64,
      )
    )
      throw new Error("Invalid source encoding");
    const content = Buffer.from(file.contentBase64, "base64");
    bytes += content.length;
    if (bytes > LIMITS.bytes) throw new Error("Project too large");
    paths.add(file.path.toLowerCase());
    return { path: file.path, content };
  });
  if (
    typeof input.mainFile !== "string" ||
    !files.some((f) => f.path === input.mainFile) ||
    !/\.tex$/i.test(input.mainFile)
  )
    throw new Error("Main file must be a project .tex file");
  for (const path of paths) {
    let parent = posix.dirname(path);
    while (parent !== ".") {
      if (paths.has(parent))
        throw new Error("Source path collides with a directory");
      parent = posix.dirname(parent);
    }
  }
  return { ...input, files };
}
export function inputHash(job) {
  const hash = createHash("sha256").update(
    JSON.stringify({ engine: job.engine, mainFile: job.mainFile }),
  );
  for (const f of [...job.files].sort((a, b) => a.path.localeCompare(b.path)))
    hash
      .update("\0")
      .update(f.path)
      .update("\0")
      .update(String(f.content.length))
      .update("\0")
      .update(f.content);
  return hash.digest("hex");
}
export function diagnostics(log) {
  return log
    .split("\n")
    .flatMap((line) => {
      const match = /^(.+?\.\w+):(\d+):\s*(.+)$/.exec(line);
      if (match)
        return [
          {
            file: match[1].replace(/^\.\//, ""),
            line: Number(match[2]),
            severity: "error",
            message: match[3].slice(0, 1000),
          },
        ];
      return /^(?:LaTeX|Package .+?) Warning:|^(?:Overfull|Underfull) \\[hv]box/.test(
        line,
      )
        ? [{ severity: "warning", message: line.slice(0, 1000) }]
        : [];
    })
    .slice(0, 100);
}
