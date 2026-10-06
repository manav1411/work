import { z } from "zod";

export const LATEX_MAX_BYTES = 5 * 1024 * 1024;
export const LATEX_MAX_FILES = 100;
export const TEXLIVE_ENVIRONMENT = "texlive-2025-20250308-pdftex-1.40.27";
export const latexEngineSchema = z.enum(["pdflatex", "xelatex", "lualatex"]);
export type LatexEngine = z.infer<typeof latexEngineSchema>;

export function validLatexPath(path: string) {
  return (
    path.length > 0 &&
    path.length <= 240 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    path.split("/")[0].toLowerCase() !== "build" &&
    !/[;&|`$<>'"*?!(){}[\]]/.test(path) &&
    !path
      .split("/")
      .some(
        (part) =>
          !part || part === "." || part === ".." || part.startsWith("."),
      ) &&
    // eslint-disable-next-line no-control-regex -- Reject archive control characters.
    !/[\u0000-\u001f\u007f:]/.test(path) &&
    /\.(tex|cls|sty|bib|bst|png|jpg|jpeg|pdf|eps|otf|ttf|woff2?|txt|csv|json|def|cfg|clo|fd|dat)$/i.test(
      path,
    )
  );
}

export const latexFileSchema = z
  .object({
    path: z
      .string()
      .refine(validLatexPath, "Use a safe relative LaTeX project file path."),
    content: z.string().max(7_000_000),
    encoding: z.enum(["utf8", "base64"]),
  })
  .strict();
export const latexSourceSchema = z
  .object({
    files: z.array(latexFileSchema).min(1).max(LATEX_MAX_FILES),
    mainFile: z.string().refine(validLatexPath),
    engine: latexEngineSchema,
  })
  .strict()
  .superRefine((project, context) => {
    const paths = new Set<string>();
    let bytes = 0;
    for (const file of project.files) {
      if (paths.has(file.path.toLowerCase()))
        context.addIssue({
          code: "custom",
          message: "Project paths must be unique.",
          path: ["files"],
        });
      paths.add(file.path.toLowerCase());
      try {
        bytes +=
          file.encoding === "utf8"
            ? new TextEncoder().encode(file.content).length
            : atob(file.content).length;
      } catch {
        context.addIssue({
          code: "custom",
          message: "Invalid base64 project file.",
          path: ["files"],
        });
      }
    }
    if (bytes > LATEX_MAX_BYTES)
      context.addIssue({
        code: "custom",
        message: "Project files must total at most 5 MB.",
        path: ["files"],
      });
    if (
      !project.files.some(
        (file) => file.path === project.mainFile && file.encoding === "utf8",
      ) ||
      !/\.tex$/i.test(project.mainFile)
    )
      context.addIssue({
        code: "custom",
        message: "Select a text .tex file as the main document.",
        path: ["mainFile"],
      });
  });
export type LatexSource = z.infer<typeof latexSourceSchema>;
export type LatexFile = LatexSource["files"][number];
export const latexSaveSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    files: z.array(latexFileSchema),
    mainFile: z.string(),
    engine: latexEngineSchema,
  })
  .strict();

export interface LatexJob {
  environment?: string;
  id: string;
  revisionId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  createdAt: string;
  finishedAt?: string;
  log: string;
  logAttachmentId?: string;
  pdfAttachmentId?: string;
  textAttachmentId?: string;
  synctexAttachmentId?: string;
  pdfUrl?: string;
  textUrl?: string;
  diagnostics?: {
    file?: string;
    line?: number;
    severity: string;
    message: string;
  }[];
  metadata?: {
    texEnvironment?: string;
    imageDigest?: string;
    compilerFingerprint?: string;
    texLiveRelease?: string;
    engine?: string;
    inputHash?: string;
    configuration?:
      | string
      | {
          latexmkVersion?: string;
          shellEscape?: boolean;
          customLatexmkrc?: boolean;
          synctex?: boolean;
          network?: boolean;
        };
  };
}
export interface LatexProject extends LatexSource {
  version: number;
  revisionId: string;
  /** Most recent build for this exact saved source revision, in any status. */
  latestJob?: LatexJob;
  /** Keeps the last rendered PDF visible in the editor while a new build runs. */
  latestSuccessfulJob?: LatexJob;
}
export interface LatexProjectMetadata {
  revisionId: string;
  mainFile: string;
  engine: LatexEngine;
  inputHash: string;
}

export function latexJobs(data: Record<string, unknown>): LatexJob[] {
  return Array.isArray(data.latexJobs) ? (data.latexJobs as LatexJob[]) : [];
}
export function latexMetadata(
  data: Record<string, unknown>,
): LatexProjectMetadata | undefined {
  const value = data.latexProject as LatexProjectMetadata | undefined;
  return value?.revisionId && latexEngineSchema.safeParse(value.engine).success
    ? value
    : undefined;
}
export async function latexInputHash(source: LatexSource) {
  const stable = {
    ...source,
    files: [...source.files].sort((a, b) => a.path.localeCompare(b.path)),
  };
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(stable)),
  );
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
