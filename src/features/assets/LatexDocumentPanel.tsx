import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { FileCode2, Play, Plus, X } from "lucide-react";
import { unzipSync, strFromU8 } from "fflate";
import { field, type WorkRecord } from "../../../shared/model";
import {
  validLatexPath,
  latexSourceSchema,
  type LatexFile as ProjectFile,
  type LatexJob as Job,
  type LatexProject as Project,
} from "../../../shared/latex";
import { Button, Input, Select } from "../../components/ui";
import { ApiError, jsonRequest, request } from "../../lib/api";
import { useAutosave } from "../../lib/autosave";
import { mergeLatexProjects } from "../../lib/latex-autosave";
import { useEditMode } from "../../lib/edit-mode";
import { useWorkspace } from "../../lib/workspace";
import { errorMessage } from "../search/domain";

const SourceEditor = lazy(() => import("./LatexSourceEditor"));
const PdfPreview = lazy(() => import("./LatexPdfPreview"));
const safePath = validLatexPath;
const signature = (project: Pick<Project, "files" | "mainFile" | "engine">) =>
  JSON.stringify([project.files, project.mainFile, project.engine]);
const template = (letter: boolean) =>
  `\\documentclass[11pt]{article}\n\\usepackage[margin=0.75in]{geometry}\n\\usepackage[T1]{fontenc}\n\\usepackage{lmodern}\n\\usepackage[hidelinks]{hyperref}\n\\pagestyle{empty}\n\\begin{document}\n{\\Large\\bfseries Your Name}\\par\n\\href{mailto:you@example.com}{you@example.com} $\\vert$ Your location\\par\n\n${letter ? "\\bigskip\nDear Hiring Team,\n\nYour cover letter goes here.\n\n\\bigskip\nKind regards,\\par\nYour Name" : "\\section*{Experience}\n\\textbf{Role --- Company} \\hfill Dates\\par\n\\begin{itemize}\n\\item Describe your contribution and its impact.\n\\end{itemize}\n\\section*{Education}\nYour qualification --- Institution\\par\n\\section*{Skills}\nYour relevant skills"}\n\\end{document}\n`;

export default function LatexDocumentPanel({
  record,
  primary,
  onSourceReady,
}: {
  record: WorkRecord;
  primary?: WorkRecord;
  onSourceReady?: () => void;
}) {
  const { editing } = useEditMode();
  const { user, refresh, records, update } = useWorkspace();
  const [serverProject, setServerProject] = useState<Project | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState(false);
  const [split, setSplit] = useState(50);
  const [path, setPath] = useState("main.tex");
  const [line, setLine] = useState<number>();
  const [error, setError] = useState("");
  const [compileError, setCompileError] = useState("");
  const [job, setJob] = useState<Job>();
  const [successful, setSuccessful] = useState<Job>();
  const [comparison, setComparison] = useState<Project>();
  const [comparisonLabel, setComparisonLabel] = useState("");
  const [revisions, setRevisions] =
    useState<{ id: string; createdAt: string }[]>();
  const [text, setText] = useState<string>();
  const compileTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const alive = useRef(true);
  const compileSequence = useRef(0);
  const sourceLoadSequence = useRef(0);
  const latestSavedProject = useRef<Project | null>(null);
  const compileRef = useRef<(revisionId: string) => Promise<void>>(
    async () => {},
  );
  const extractedUrl = useRef(successful?.textUrl);
  const readyCallback = useRef(onSourceReady);
  readyCallback.current = onSourceReady;
  extractedUrl.current = successful?.textUrl;
  const draftKey = `work:latex-draft:${user?.id || "demo"}:${record.id}`;
  const api = `/api/latex/${encodeURIComponent(record.id)}`;
  const loadSource = useCallback(async () => {
    const sequence = ++sourceLoadSequence.current;
    setLoading(true);
    setError("");
    try {
      const { project: next } = await request<{ project: Project | null }>(api);
      if (!alive.current || sequence !== sourceLoadSequence.current) return;
      setServerProject(next);
      latestSavedProject.current = next;
      setLoaded(true);
      if (next) {
        setPath(next.mainFile);
        setSuccessful(next.latestSuccessfulJob);
      }
    } catch (failure) {
      if (!alive.current || sequence !== sourceLoadSequence.current) return;
      if (failure instanceof ApiError && failure.status === 404) {
        setLoaded(true);
      } else {
        setError(errorMessage(failure));
      }
    } finally {
      if (alive.current && sequence === sourceLoadSequence.current)
        setLoading(false);
    }
  }, [api]);
  const refreshSource = async () => {
    const { project: latest } = await request<{ project: Project | null }>(api);
    setServerProject(latest);
    latestSavedProject.current = latest;
    setLoaded(true);
    if (latest?.latestSuccessfulJob) setSuccessful(latest.latestSuccessfulJob);
    return latest;
  };
  const autosave = useAutosave<Project | null>({
    initial: serverProject,
    version: loaded ? (serverProject?.version ?? record.version) : undefined,
    storageKey: draftKey,
    enabled: loaded,
    pending: !loaded,
    decodeLegacy: (raw) => {
      if (!raw || typeof raw !== "object") return undefined;
      const candidate = raw as Project;
      const parsed = latexSourceSchema.safeParse({
        files: candidate.files,
        mainFile: candidate.mainFile,
        engine: candidate.engine,
      });
      if (
        !parsed.success ||
        typeof candidate.version !== "number" ||
        typeof candidate.revisionId !== "string"
      )
        return undefined;
      return { value: candidate, version: candidate.version };
    },
    validate: (value) => {
      if (!value) return null;
      const parsed = latexSourceSchema.safeParse({
        files: value.files,
        mainFile: value.mainFile,
        engine: value.engine,
      });
      return parsed.success
        ? null
        : parsed.error.issues[0]?.message || "Check the LaTeX source project.";
    },
    merge: mergeLatexProjects,
    refresh: async () => {
      await refreshSource();
    },
    persist: async (value, expectedVersion) => {
      if (!value) return;
      if (alive.current) setCompileError("");
      const { project: next } = await request<{ project: Project }>(
        api,
        jsonRequest("PUT", {
          expectedVersion: expectedVersion ?? value.version ?? record.version,
          files: value.files,
          mainFile: value.mainFile,
          engine: value.engine,
        }),
      );
      const saved: Project = {
        ...value,
        version: next.version,
        revisionId: next.revisionId,
      };
      latestSavedProject.current = saved;
      if (alive.current) {
        setServerProject(saved);
        void refresh();
        clearTimeout(compileTimer.current);
        compileTimer.current = setTimeout(
          () => void compileRef.current(next.revisionId),
          1000,
        );
      }
      return { version: next.version, value: saved };
    },
  });
  const project = autosave.value || undefined;
  const setProject = autosave.setValue;
  const liveProject = useRef(project);
  liveProject.current = project;
  const flushRef = useRef(autosave.flush);
  flushRef.current = autosave.flush;
  useEffect(() => {
    if (project) readyCallback.current?.();
  }, [!!project]);
  useEffect(() => {
    alive.current = true;
    void loadSource();
    return () => {
      alive.current = false;
      clearTimeout(compileTimer.current);
    };
  }, [loadSource]);
  useEffect(() => {
    const flushOnLeave = () => void flushRef.current();
    window.addEventListener("pagehide", flushOnLeave);
    return () => {
      window.removeEventListener("pagehide", flushOnLeave);
      if (editing) flushOnLeave();
    };
  }, [editing, record.id]);
  useEffect(() => {
    if (
      !loaded ||
      !editing ||
      project ||
      error ||
      record.data.nativeDocument !== true
    )
      return;
    setProject({
      version: record.version,
      revisionId: "",
      mainFile: "main.tex",
      engine: "pdflatex",
      files: [
        {
          path: "main.tex",
          encoding: "utf8",
          content: template(field(record, "type") === "letter"),
        },
      ],
    });
    setSource(true);
  }, [
    loaded,
    editing,
    project,
    error,
    record.version,
    record.data.nativeDocument,
    record.data.type,
  ]);
  useEffect(() => {
    setText(undefined);
  }, [successful?.textUrl]);
  useEffect(() => {
    const metadata = record.data.latexProject as
      { revisionId?: string } | undefined;
    setServerProject((current) =>
      current &&
      (metadata?.revisionId || "") === current.revisionId &&
      record.version > current.version
        ? (() => {
            const next = { ...current, version: record.version };
            latestSavedProject.current = next;
            return next;
          })()
        : current,
    );
  }, [record.version, record.data.latexProject]);

  const compile = useCallback(
    async (revisionId: string) => {
      const sequence = ++compileSequence.current;
      setCompileError("");
      try {
        const result = await request<{ job: Job }>(
          `${api}/compile`,
          jsonRequest("POST", { revisionId }),
        );
        if (alive.current && sequence === compileSequence.current) {
          setJob(result.job);
          if (result.job.status === "succeeded") setSuccessful(result.job);
          setCompileError(
            result.job.status === "failed"
              ? "PDF compilation failed. Your source remains saved."
              : "",
          );
        }
      } catch (failure) {
        if (alive.current && sequence === compileSequence.current)
          setCompileError(errorMessage(failure));
      }
    },
    [api],
  );
  compileRef.current = compile;
  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status)) return;
    let active = true;
    const timer = setTimeout(
      () =>
        void request<{ job: Job }>(`${api}/jobs/${encodeURIComponent(job.id)}`)
          .then(({ job: next }) => {
            if (active) {
              setJob(next);
              if (next.status === "succeeded") setSuccessful(next);
              if (next.status === "failed")
                setCompileError(
                  "PDF compilation failed. Your source remains saved.",
                );
            }
          })
          .catch((failure) => {
            if (active) setCompileError(errorMessage(failure));
          }),
      1200,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [job, api]);

  async function importFiles(file: File) {
    try {
      if (file.size > 5 * 1024 * 1024)
        throw new Error("Source imports are limited to 5 MB.");
      const files: ProjectFile[] = [];
      if (/\.zip$/i.test(file.name)) {
        const zipped = new Uint8Array(await file.arrayBuffer());
        let total = 0;
        let count = 0;
        const paths = new Set<string>();
        // Inspect the complete central directory before allocating inflated files.
        unzipSync(zipped, {
          filter: (item) => {
            if (item.name.endsWith("/")) return false;
            if (++count > 100)
              throw new Error(
                "A source project can contain at most 100 files.",
              );
            if (!safePath(item.name))
              throw new Error(
                `Unsupported source file: ${item.name}. Custom executable build rules are not supported.`,
              );
            if (paths.has(item.name.toLowerCase()))
              throw new Error("Source ZIP paths must be unique.");
            paths.add(item.name.toLowerCase());
            if (item.compression === 0 && item.size !== item.originalSize)
              throw new Error("The source ZIP has inconsistent file sizes.");
            if (
              item.originalSize > 5 * 1024 * 1024 ||
              (total += item.originalSize) > 5 * 1024 * 1024
            )
              throw new Error("Unsafe path or oversized source ZIP.");
            return false;
          },
        });
        const archive = unzipSync(zipped, {
          filter: (item) => !item.name.endsWith("/"),
        });
        if (Object.keys(archive).length > 100)
          throw new Error("A source project can contain at most 100 files.");
        for (const [path, bytes] of Object.entries(archive)) {
          const utf8 =
            /\.(tex|sty|cls|bib|bst|txt|md|csv|json|cfg|def|clo|fd)$/i.test(
              path,
            );
          let binary = "";
          if (!utf8)
            for (let start = 0; start < bytes.length; start += 8192)
              binary += String.fromCharCode(
                ...bytes.subarray(start, start + 8192),
              );
          files.push({
            path,
            content: utf8 ? strFromU8(bytes) : btoa(binary),
            encoding: utf8 ? "utf8" : "base64",
          });
        }
      } else {
        if (!safePath(file.name) || !/\.tex$/i.test(file.name))
          throw new Error("Choose a .tex file or source ZIP.");
        files.push({
          path: file.name,
          content: await file.text(),
          encoding: "utf8",
        });
      }
      if (!files.some((item) => /\.tex$/i.test(item.path)))
        throw new Error("The project needs at least one .tex file.");
      const mainFile =
        files.find((item) => item.path === "main.tex")?.path ||
        files.find((item) => /\.tex$/i.test(item.path))!.path;
      setProject({
        ...project,
        version: project?.version || record.version,
        revisionId: project?.revisionId || "",
        files,
        mainFile,
        engine: project?.engine || "pdflatex",
      });
      setPath(mainFile);
      setSource(true);
      setError("");
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }
  async function compare(mode: "fork" | "primary" | "parent") {
    const parent = field(record, "parentVariantId");
    const fork = field(record, "forkRevisionId");
    const destination = mode === "primary" ? primary?.id : parent;
    if (!destination || (mode === "fork" && !fork)) return;
    try {
      const result = await request<{ project: Project }>(
        `/api/latex/${encodeURIComponent(destination)}${mode === "fork" ? `/revisions/${encodeURIComponent(fork)}` : ""}`,
      );
      setComparison(result.project);
      setComparisonLabel(
        mode === "fork"
          ? `Fork baseline · ${field(record, "forkedFromTitle", records.find((item) => item.id === parent)?.title || "historical parent")}`
          : mode === "parent"
            ? `Current parent · ${records.find((item) => item.id === parent)?.title || "parent"}`
            : `Primary · ${primary?.title || "main document"}`,
      );
      setSource(true);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }
  const currentFile = project?.files.find((file) => file.path === path);
  const comparedFile = comparison?.files.find((file) => file.path === path);
  const selectableFiles = [
    ...new Set([
      ...(project?.files.map((file) => file.path) || []),
      ...(comparison?.files.map((file) => file.path) || []),
    ]),
  ];
  const savedProject = autosave.savedValue || undefined;
  const dirty =
    !!project &&
    (!savedProject || signature(project) !== signature(savedProject));
  const matching =
    !!project &&
    !dirty &&
    autosave.state === "Saved" &&
    successful?.revisionId === project.revisionId;
  const applications = records.filter((item) => item.kind === "application");
  const linked = Array.isArray(record.data.applicationIds)
    ? (record.data.applicationIds as string[])
    : [];
  if (loading) return <p role="status">Loading source…</p>;
  return (
    <div className="latex-document-panel">
      <div className="latex-toolbar">
        {project && (
          <>
            {!editing && (
              <Button
                variant={source ? "secondary" : "ghost"}
                onClick={() => setSource((value) => !value)}
              >
                <FileCode2 size={16} /> Source
              </Button>
            )}
            <span className="latex-state" role="status">
              {autosave.state}
            </span>
            <span className="latex-preview-state" role="status">
              {job && ["queued", "running"].includes(job.status)
                ? "Compiling PDF…"
                : compileError
                  ? "PDF compilation failed"
                  : successful
                    ? matching
                      ? "PDF up to date"
                      : "Previous PDF"
                    : "No compiled PDF"}
            </span>
            <Button
              variant="secondary"
              disabled={!!job && ["queued", "running"].includes(job.status)}
              onClick={() =>
                void (async () => {
                  clearTimeout(compileTimer.current);
                  if (dirty) await autosave.flush();
                  clearTimeout(compileTimer.current);
                  const current = liveProject.current;
                  const saved =
                    latestSavedProject.current ||
                    (autosave.savedValue as Project | null);
                  if (
                    current &&
                    saved &&
                    signature(current) === signature(saved)
                  )
                    await compile(current.revisionId || saved.revisionId);
                })()
              }
            >
              <Play size={15} /> Recompile
            </Button>
          </>
        )}
        {successful?.pdfUrl && (
          <a
            className="button button-secondary"
            href={successful.pdfUrl}
            download
          >
            {matching ? "Download PDF" : "Download previous PDF"}
          </a>
        )}
      </div>
      {autosave.error && !autosave.conflict && (
        <p className="form-error" role="alert">
          {autosave.error}
        </p>
      )}
      {compileError && (
        <p className="form-error" role="alert">
          {compileError}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!loaded && !loading && (
        <Button variant="secondary" onClick={() => void loadSource()}>
          Retry loading source
        </Button>
      )}
      {autosave.conflict && (
        <div className="latex-conflict" role="alert">
          <span>
            {autosave.error ||
              "This source changed in another session. Compare the saved copy and choose which to keep."}
          </span>
          <Button
            variant="secondary"
            onClick={() =>
              void refreshSource()
                .then((latest) => {
                  if (!latest) return;
                  setComparison(latest);
                  setComparisonLabel("Latest saved source");
                  setSource(true);
                })
                .catch((failure) => setError(errorMessage(failure)))
            }
          >
            Compare latest
          </Button>
          <Button variant="secondary" onClick={() => void autosave.keepLocal()}>
            Keep my source
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              autosave.useSaved();
              setComparison(undefined);
              setComparisonLabel("");
              if (serverProject) setPath(serverProject.mainFile);
            }}
          >
            Use latest
          </Button>
        </div>
      )}
      {!project && loaded && editing && (
        <div className="latex-start">
          <Button
            onClick={() => {
              setProject({
                version: record.version,
                revisionId: "",
                mainFile: "main.tex",
                engine: "pdflatex",
                files: [
                  {
                    path: "main.tex",
                    encoding: "utf8",
                    content: template(field(record, "type") === "letter"),
                  },
                ],
              });
              setSource(true);
            }}
          >
            Create LaTeX source
          </Button>
          <label className="button button-secondary">
            Import source
            <Input
              type="file"
              accept=".zip,.tex"
              className="latex-file-input"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importFiles(file);
                event.target.value = "";
              }}
            />
          </label>
        </div>
      )}
      {project && (source || editing) && (
        <details className="latex-settings">
          <summary>Files & settings</summary>
          <div className="inline-actions">
            <Select
              aria-label="Project file"
              value={path}
              onChange={(event) => setPath(event.target.value)}
            >
              {selectableFiles.map((filePath) => (
                <option key={filePath} value={filePath}>
                  {filePath}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Main LaTeX file"
              disabled={!editing}
              value={project.mainFile}
              onChange={(event) =>
                setProject({ ...project, mainFile: event.target.value })
              }
            >
              {project.files
                .filter((file) => /\.tex$/i.test(file.path))
                .map((file) => (
                  <option key={file.path} value={file.path}>
                    {file.path}
                  </option>
                ))}
            </Select>
            <Select
              aria-label="LaTeX engine"
              disabled={!editing}
              value={project.engine}
              onChange={(event) =>
                setProject({
                  ...project,
                  engine: event.target.value as Project["engine"],
                })
              }
            >
              <option value="pdflatex">pdfLaTeX</option>
              <option value="xelatex">XeLaTeX</option>
              <option value="lualatex">LuaLaTeX</option>
            </Select>
            {editing && (
              <>
                <label className="button button-secondary">
                  Import source
                  <Input
                    type="file"
                    accept=".zip,.tex"
                    className="latex-file-input"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (
                        file &&
                        window.confirm(
                          "Replace this project's working source files?",
                        )
                      )
                        void importFiles(file);
                      event.target.value = "";
                    }}
                  />
                </label>
                <Button
                  variant="ghost"
                  onClick={() => {
                    const filename = window.prompt(
                      "New source file name",
                      "section.tex",
                    );
                    if (
                      filename &&
                      safePath(filename) &&
                      !project.files.some((file) => file.path === filename)
                    ) {
                      setProject({
                        ...project,
                        files: [
                          ...project.files,
                          { path: filename, encoding: "utf8", content: "" },
                        ],
                      });
                      setPath(filename);
                    }
                  }}
                >
                  <Plus size={15} /> File
                </Button>
                {path !== project.mainFile && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setProject({
                        ...project,
                        files: project.files.filter(
                          (file) => file.path !== path,
                        ),
                      });
                      setPath(project.mainFile);
                    }}
                  >
                    Delete file
                  </Button>
                )}
              </>
            )}
          </div>
        </details>
      )}
      {project && (
        <div className="inline-actions">
          {field(record, "forkRevisionId") && (
            <Button variant="ghost" onClick={() => void compare("fork")}>
              Changes since fork
            </Button>
          )}
          {primary && primary.id !== record.id && (
            <Button variant="ghost" onClick={() => void compare("primary")}>
              Changes from primary
            </Button>
          )}
          {field(record, "parentVariantId") !== primary?.id &&
            records.some(
              (item) => item.id === field(record, "parentVariantId"),
            ) && (
              <Button variant="ghost" onClick={() => void compare("parent")}>
                Changes from current parent
              </Button>
            )}
          {comparison && (
            <Button variant="ghost" onClick={() => setComparison(undefined)}>
              <X size={15} /> Close differences
            </Button>
          )}
          {comparison && comparisonLabel && (
            <small className="muted">{comparisonLabel}</small>
          )}
        </div>
      )}
      {(project || successful?.pdfUrl) && (
        <div
          className={`latex-workbench ${source || editing ? "with-source" : ""}`}
          style={{ "--latex-split": `${split}%` } as React.CSSProperties}
        >
          <Suspense fallback={<p role="status">Loading editor…</p>}>
            {project &&
              (source || editing) &&
              ((currentFile || comparedFile)?.encoding === "utf8" ? (
                <div className="latex-source-pane">
                  <SourceEditor
                    key={path}
                    line={line}
                    value={currentFile?.content || ""}
                    readOnly={!editing}
                    original={
                      comparison ? comparedFile?.content || "" : undefined
                    }
                    onChange={(value) =>
                      setProject(
                        (current) =>
                          current && {
                            ...current,
                            files: !current.files.some(
                              (file) => file.path === path,
                            )
                              ? [
                                  ...current.files,
                                  { path, content: value, encoding: "utf8" },
                                ]
                              : current.files.map((file) =>
                                  file.path === path
                                    ? { ...file, content: value }
                                    : file,
                                ),
                          },
                      )
                    }
                  />
                  {comparison && editing && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        const original = comparison.files.find(
                          (file) => file.path === path,
                        );
                        if (
                          original &&
                          window.confirm(
                            "Copy this comparison file into your working source?",
                          )
                        )
                          setProject({
                            ...project,
                            files: !project.files.some(
                              (file) => file.path === path,
                            )
                              ? [...project.files, original]
                              : project.files.map((file) =>
                                  file.path === path ? original : file,
                                ),
                          });
                      }}
                    >
                      Copy comparison file
                    </Button>
                  )}
                </div>
              ) : (
                <p>Binary project file · included in your backup</p>
              ))}
            {(source || editing) && project && (
              <input
                className="latex-resize"
                type="range"
                min="25"
                max="75"
                value={split}
                aria-label="Source pane width"
                onChange={(event) => setSplit(Number(event.target.value))}
              />
            )}
            {successful?.pdfUrl ? (
              <PdfPreview url={successful.pdfUrl} />
            ) : (
              project && (
                <div className="latex-empty-preview">
                  {job?.status === "failed"
                    ? "Compilation failed. Open the log below."
                    : "Your compiled PDF will appear here."}
                </div>
              )
            )}
          </Suspense>
        </div>
      )}
      {project && (
        <details
          onToggle={(event) => {
            if (event.currentTarget.open && !revisions)
              void request<{ revisions: { id: string; createdAt: string }[] }>(
                `${api}/revisions`,
              )
                .then((result) => setRevisions(result.revisions))
                .catch((failure) => setError(errorMessage(failure)));
          }}
        >
          <summary>Earlier source versions</summary>
          {revisions ? (
            revisions.map((revision) => (
              <div className="document-version" key={revision.id}>
                <span>
                  {new Date(revision.createdAt).toLocaleString()}
                  {revision.id === project.revisionId ? " · Current" : ""}
                </span>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void request<{ project: Project }>(
                      `${api}/revisions/${encodeURIComponent(revision.id)}`,
                    )
                      .then((result) => {
                        setComparison(result.project);
                        setSource(true);
                      })
                      .catch((failure) => setError(errorMessage(failure)))
                  }
                >
                  Review
                </Button>
                {editing && revision.id !== project.revisionId && (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void request<{ project: Project }>(
                        `${api}/revisions/${encodeURIComponent(revision.id)}`,
                      )
                        .then(({ project: earlier }) => {
                          setProject((current) =>
                            current
                              ? {
                                  ...earlier,
                                  version: current.version,
                                  revisionId: current.revisionId,
                                }
                              : earlier,
                          );
                          setPath(earlier.mainFile);
                          setComparison(undefined);
                          setComparisonLabel("");
                          setSource(true);
                        })
                        .catch((failure) => setError(errorMessage(failure)))
                    }
                  >
                    Restore
                  </Button>
                )}
              </div>
            ))
          ) : (
            <p role="status">Loading source history…</p>
          )}
        </details>
      )}
      {job && (
        <details className="latex-build-log" open={job.status === "failed"}>
          <summary>Compile log · {job.status}</summary>
          {job.diagnostics?.map((diagnostic, index) => (
            <div key={index}>
              {diagnostic.file &&
              diagnostic.line &&
              project?.files.some((file) => file.path === diagnostic.file) ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setPath(diagnostic.file!);
                    setLine(diagnostic.line);
                    setSource(true);
                  }}
                >
                  {diagnostic.file}:{diagnostic.line} · {diagnostic.message}
                </Button>
              ) : (
                <span>{diagnostic.message}</span>
              )}
            </div>
          ))}
          <pre>{job.log || "Waiting for compiler output…"}</pre>
          {["queued", "running"].includes(job.status) && (
            <Button
              variant="ghost"
              onClick={() =>
                void request(`${api}/jobs/${encodeURIComponent(job.id)}`, {
                  method: "DELETE",
                })
                  .then(() => setJob({ ...job, status: "cancelled" }))
                  .catch((failure) => setError(errorMessage(failure)))
              }
            >
              Cancel compile
            </Button>
          )}
        </details>
      )}
      {successful?.textUrl && (
        <details
          onToggle={(event) => {
            if (event.currentTarget.open && text === undefined)
              void fetch(successful.textUrl!, { credentials: "same-origin" })
                .then((response) => {
                  if (!response.ok)
                    throw new Error("Text extraction unavailable");
                  return response.text();
                })
                .then((value) => {
                  if (extractedUrl.current === successful.textUrl)
                    setText(value);
                })
                .catch((failure) => setError(errorMessage(failure)));
          }}
        >
          <summary>Extracted PDF text</summary>
          <pre className="document-preview-text">
            {text ?? "Loading extracted text…"}
          </pre>
        </details>
      )}
      {editing && (
        <details className="latex-application-links">
          <summary>
            Application links{linked.length ? ` (${linked.length})` : ""}
          </summary>
          {applications.map((application) => (
            <label key={application.id}>
              <input
                type="checkbox"
                checked={linked.includes(application.id)}
                onChange={(event) =>
                  void update(record.id, {
                    data: {
                      ...record.data,
                      applicationIds: event.target.checked
                        ? [...linked, application.id]
                        : linked.filter((id) => id !== application.id),
                    },
                  }).catch((failure) => setError(errorMessage(failure)))
                }
              />
              {application.title}
            </label>
          ))}
          {!applications.length && (
            <p className="muted">Create an application to link this variant.</p>
          )}
          {matching &&
            successful?.pdfUrl &&
            linked.map((applicationId) => (
              <Button
                key={applicationId}
                variant="ghost"
                onClick={() =>
                  void request(
                    `${api}/submissions`,
                    jsonRequest("POST", {
                      applicationId,
                      jobId: successful.id,
                    }),
                  )
                    .then(() => refresh())
                    .catch((failure) => setError(errorMessage(failure)))
                }
              >
                Record submitted version ·{" "}
                {applications.find((item) => item.id === applicationId)?.title}
              </Button>
            ))}
        </details>
      )}
      {Array.isArray(record.data.submissions) &&
        record.data.submissions.length > 0 && (
          <details>
            <summary>
              Submitted versions ({record.data.submissions.length})
            </summary>
            {(
              record.data.submissions as {
                applicationId?: string;
                pdfAttachmentId: string;
                submittedAt: string;
              }[]
            ).map((submission, index) => (
              <div
                className="document-version"
                key={`${submission.pdfAttachmentId}-${index}`}
              >
                <span>
                  {applications.find(
                    (item) => item.id === submission.applicationId,
                  )?.title || "Previous application"}{" "}
                  · {new Date(submission.submittedAt).toLocaleDateString()}
                </span>
                <a
                  className="button button-ghost"
                  href={`/api/attachments/${encodeURIComponent(submission.pdfAttachmentId)}`}
                  download
                >
                  Download submitted PDF
                </a>
              </div>
            ))}
          </details>
        )}
    </div>
  );
}
