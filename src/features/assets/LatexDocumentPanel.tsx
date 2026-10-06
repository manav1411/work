import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Download } from "lucide-react";
import type { WorkRecord } from "../../../shared/model";
import { documentPdfFilename } from "../../../shared/documents";
import {
  TEXLIVE_ENVIRONMENT,
  latexSourceSchema,
  type LatexJob as Job,
  type LatexProject as Project,
} from "../../../shared/latex";
import { Button, Select } from "../../components/ui";
import { ApiError, jsonRequest, request } from "../../lib/api";
import { useAutosave } from "../../lib/autosave";
import { mergeLatexProjects } from "../../lib/latex-autosave";
import { useEditMode } from "../../lib/edit-mode";
import { useWorkspace } from "../../lib/workspace";
import { errorMessage } from "../search/domain";
import { downloadDocumentFile } from "./files";

const SourceEditor = lazy(() => import("./LatexSourceEditor"));
const PdfPreview = lazy(() => import("./LatexPdfPreview"));
const signature = (project: Pick<Project, "files" | "mainFile" | "engine">) =>
  JSON.stringify([project.files, project.mainFile, project.engine]);
const hasMainSource = (project: Project | null | undefined) =>
  !!project?.files.find(
    (file) =>
      file.path === project.mainFile &&
      file.encoding === "utf8" &&
      file.content.trim().length > 0,
  );

export default function LatexDocumentPanel({ record }: { record: WorkRecord }) {
  const { editing } = useEditMode();
  const { user, refresh } = useWorkspace();
  const [serverProject, setServerProject] = useState<Project | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [path, setPath] = useState("main.tex");
  const [line, setLine] = useState<number>();
  const [error, setError] = useState("");
  const [compileError, setCompileError] = useState("");
  const [job, setJob] = useState<Job>();
  const [successful, setSuccessful] = useState<Job>();
  const [conflictSource, setConflictSource] = useState<Project>();
  const [showConflictReview, setShowConflictReview] = useState(false);
  const conflictDialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(true);
  const compileSequence = useRef(0);
  const sourceLoadSequence = useRef(0);
  const compileRef = useRef<(revisionId: string) => Promise<void>>(
    async () => {},
  );
  const draftKey = `work:latex-draft:${user?.id || "demo"}:${record.id}`;
  const api = `/api/latex/${encodeURIComponent(record.id)}`;
  const loadSource = useCallback(async () => {
    const sequence = ++sourceLoadSequence.current;
    setLoading(true);
    setError("");
    try {
      const { project: next, configured: compilerConfigured } = await request<{
        project: Project | null;
        configured?: boolean;
      }>(api);
      if (!alive.current || sequence !== sourceLoadSequence.current) return;
      setServerProject(next);
      setConfigured(compilerConfigured !== false);
      setLoaded(true);
      if (next) {
        const latestJob = next.latestJob;
        setPath(next.mainFile);
        setJob(latestJob);
        setSuccessful(
          latestJob?.status === "succeeded"
            ? latestJob
            : next.latestSuccessfulJob,
        );
        const alreadyCompiled =
          (next.latestSuccessfulJob?.revisionId === next.revisionId &&
            next.latestSuccessfulJob.metadata?.texEnvironment ===
              TEXLIVE_ENVIRONMENT) ||
          (latestJob?.status === "succeeded" &&
            latestJob.metadata?.texEnvironment === TEXLIVE_ENVIRONMENT &&
            latestJob.revisionId === next.revisionId);
        const compileInProgressOrFailed =
          latestJob?.revisionId === next.revisionId &&
          latestJob.environment === TEXLIVE_ENVIRONMENT &&
          (["queued", "running"].includes(latestJob.status) ||
            (latestJob.status === "failed" &&
              latestJob.metadata?.texEnvironment === TEXLIVE_ENVIRONMENT));
        if (
          compilerConfigured !== false &&
          hasMainSource(next) &&
          !alreadyCompiled &&
          !compileInProgressOrFailed
        )
          void compileRef.current(next.revisionId);
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
    const { project: latest } = await request<{
      project: Project | null;
    }>(api);
    if (!alive.current) return latest;
    setServerProject(latest);
    setLoaded(true);
    const latestJob = latest?.latestJob;
    setJob(latestJob);
    setSuccessful(
      latestJob?.status === "succeeded"
        ? latestJob
        : latest?.latestSuccessfulJob,
    );
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
      const { project: next } = await request<{
        project: Project;
      }>(
        api,
        jsonRequest("PUT", {
          expectedVersion: expectedVersion ?? value.version ?? record.version,
          files: value.files,
          mainFile: value.mainFile,
          engine: "pdflatex",
        }),
      );
      const saved: Project = {
        ...value,
        engine: "pdflatex",
        version: next.version,
        revisionId: next.revisionId,
      };
      if (alive.current) {
        setServerProject(saved);
        const latestJob = next.latestJob;
        setJob(latestJob);
        if (latestJob?.status === "succeeded") setSuccessful(latestJob);
        else if (next.latestSuccessfulJob)
          setSuccessful(next.latestSuccessfulJob);
        void refresh();
      }
      return { version: next.version, value: saved };
    },
  });
  const project = autosave.value || undefined;
  const setProject = autosave.setValue;
  const flushRef = useRef(autosave.flush);
  flushRef.current = autosave.flush;
  useEffect(() => {
    if (loaded && project && project.engine !== "pdflatex")
      setProject({ ...project, engine: "pdflatex" });
  }, [loaded, project?.engine]);
  useEffect(() => {
    alive.current = true;
    void loadSource();
    return () => {
      alive.current = false;
    };
  }, [loadSource]);
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
      files: [{ path: "main.tex", encoding: "utf8", content: "" }],
    });
  }, [
    loaded,
    editing,
    project,
    error,
    record.version,
    record.data.nativeDocument,
  ]);
  useEffect(() => {
    const metadata = record.data.latexProject as
      { revisionId?: string } | undefined;
    setServerProject((current) =>
      current &&
      (metadata?.revisionId || "") === current.revisionId &&
      record.version > current.version
        ? (() => {
            const next = { ...current, version: record.version };
            return next;
          })()
        : current,
    );
  }, [record.version, record.data.latexProject]);

  const compile = useCallback(
    async (revisionId: string) => {
      const sequence = ++compileSequence.current;
      if (alive.current) setCompileError("");
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
  const previousEditing = useRef(editing);
  useEffect(() => {
    const wasEditing = previousEditing.current;
    previousEditing.current = editing;
    if (wasEditing && !editing) void flushRef.current();
  }, [editing]);
  useEffect(() => {
    const flushOnLeave = () => void flushRef.current();
    window.addEventListener("pagehide", flushOnLeave);
    return () => {
      window.removeEventListener("pagehide", flushOnLeave);
      if (editing) flushOnLeave();
    };
  }, [editing, record.id]);
  useEffect(() => {
    const dialog = conflictDialog.current;
    if (!dialog) return;
    if (showConflictReview && !dialog.open) dialog.showModal();
    else if (!showConflictReview && dialog.open) dialog.close();
  }, [showConflictReview, conflictSource]);
  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status)) return;
    let active = true;
    let delay = 1200;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const { job: next } = await request<{ job: Job }>(
          `${api}/jobs/${encodeURIComponent(job.id)}`,
        );
        if (!active) return;
        setJob(next);
        setCompileError(
          next.status === "failed"
            ? "PDF compilation failed. Your source remains saved."
            : "",
        );
        if (next.status === "succeeded") setSuccessful(next);
        if (!["queued", "running"].includes(next.status)) return;
        delay = 1200;
      } catch (failure) {
        if (!active) return;
        setCompileError(errorMessage(failure));
        delay = Math.min(delay * 2, 15_000);
      }
      if (active) timer = setTimeout(() => void poll(), delay);
    };
    timer = setTimeout(() => void poll(), delay);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [job?.id, job?.status, api]);

  const currentFile = project?.files.find((file) => file.path === path);
  const conflictFile = conflictSource?.files.find((file) => file.path === path);
  const savedProject = autosave.savedValue || undefined;
  const dirty =
    !!project &&
    (!savedProject || signature(project) !== signature(savedProject));
  const currentPdf =
    !!project &&
    !dirty &&
    successful?.revisionId === project.revisionId &&
    successful.metadata?.texEnvironment === TEXLIVE_ENVIRONMENT;
  const activeJob =
    !!job &&
    job.revisionId === project?.revisionId &&
    ["queued", "running"].includes(job.status);
  const localCompareText =
    currentFile?.encoding === "utf8"
      ? currentFile.content.slice(0, 60_000)
      : currentFile
        ? "This is a binary project file."
        : "This file is absent from your saved copy.";
  const remoteCompareText =
    conflictFile?.encoding === "utf8"
      ? conflictFile.content.slice(0, 60_000)
      : conflictFile
        ? "This is a binary project file."
        : "This file is absent from the latest saved copy.";
  if (loading) return <p role="status">Loading source…</p>;
  return (
    <div className="latex-document-panel">
      <div className="latex-toolbar">
        {editing && project && (
          <>
            <span className="latex-state" role="status">
              {autosave.state}
            </span>
            <span className="latex-preview-state" role="status">
              {activeJob
                ? "Compiling PDF…"
                : job?.status === "failed"
                  ? "PDF compilation failed"
                  : currentPdf
                    ? "PDF up to date"
                    : successful?.pdfUrl
                      ? "Previous PDF"
                      : "No compiled PDF"}
            </span>
          </>
        )}
        {successful?.pdfUrl && (editing || currentPdf) && (
          <Button
            variant="secondary"
            onClick={() => {
              if (!successful.pdfAttachmentId) return;
              void downloadDocumentFile({
                id: successful.pdfAttachmentId,
                filename: documentPdfFilename(record),
              }).catch((failure) => setError(errorMessage(failure)));
            }}
          >
            <Download size={16} />
            {editing && !currentPdf ? "Download previous PDF" : "Download"}
          </Button>
        )}
      </div>
      {editing && autosave.error && !autosave.conflict && (
        <p className="form-error" role="alert">
          {autosave.error}
        </p>
      )}
      {editing && compileError && (
        <p className="form-error" role="alert">
          {compileError}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {editing && !loaded && !loading && (
        <Button variant="secondary" onClick={() => void loadSource()}>
          Retry loading source
        </Button>
      )}
      {editing && autosave.conflict && (
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
                  setConflictSource(latest);
                  setShowConflictReview(true);
                })
                .catch((failure) => setError(errorMessage(failure)))
            }
          >
            Compare saved source
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setShowConflictReview(false);
              void autosave.keepLocal();
            }}
          >
            Keep my source
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              autosave.useSaved();
              if (serverProject) setPath(serverProject.mainFile);
              setShowConflictReview(false);
              setConflictSource(undefined);
            }}
          >
            Use latest
          </Button>
        </div>
      )}
      {editing && project && (
        <div className="latex-workbench with-source">
          <Suspense fallback={<p role="status">Loading editor…</p>}>
            {currentFile?.encoding === "utf8" ? (
              <div className="latex-source-pane">
                <SourceEditor
                  key={path}
                  line={line}
                  value={currentFile.content}
                  readOnly={false}
                  onChange={(value) =>
                    setProject(
                      (current) =>
                        current && {
                          ...current,
                          files: current.files.map((file) =>
                            file.path === path
                              ? { ...file, content: value }
                              : file,
                          ),
                        },
                    )
                  }
                />
              </div>
            ) : (
              <p>Binary project file · included in your backup</p>
            )}
            {successful?.pdfUrl ? (
              <PdfPreview url={successful.pdfUrl} />
            ) : (
              <div className="latex-empty-preview" role="status">
                {activeJob
                  ? "Compiling the latest saved source…"
                  : compileError ||
                    "The compiled PDF will appear here after the source is saved."}
              </div>
            )}
          </Suspense>
        </div>
      )}
      {!editing && currentPdf && successful?.pdfUrl && (
        <Suspense fallback={<p role="status">Loading PDF…</p>}>
          <PdfPreview url={successful.pdfUrl} />
        </Suspense>
      )}
      {!editing && !currentPdf && (
        <p className="latex-empty-preview" role="status">
          {job?.status === "failed"
            ? "PDF compilation failed. Switch to edit mode to fix the source."
            : activeJob
              ? "The latest PDF is compiling…"
              : !hasMainSource(project)
                ? "This document is empty. Switch to edit mode to add your LaTeX source."
                : !configured
                  ? "The PDF compiler is unavailable. Your source remains saved."
                  : compileError || "The latest PDF is not available yet."}
        </p>
      )}
      {editing && job && (
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
      <dialog
        ref={conflictDialog}
        className="latex-conflict-dialog"
        onCancel={(event) => {
          event.preventDefault();
          setShowConflictReview(false);
        }}
        onClose={() => setShowConflictReview(false)}
      >
        <div className="latex-conflict-dialog-content">
          <h2>Compare saved source</h2>
          <p className="muted">
            Review the local and saved copies for the selected file before
            choosing which to keep.
          </p>
          <label>
            File to compare
            <Select
              aria-label="File to compare"
              value={path}
              onChange={(event) => setPath(event.target.value)}
            >
              {[
                ...new Set([
                  ...(project?.files.map((file) => file.path) || []),
                  ...(conflictSource?.files.map((file) => file.path) || []),
                ]),
              ].map((filePath) => (
                <option key={filePath} value={filePath}>
                  {filePath}
                </option>
              ))}
            </Select>
          </label>
          <div className="latex-conflict-files">
            <section>
              <h3>Your source</h3>
              <pre className="latex-conflict-file">{localCompareText}</pre>
            </section>
            <section>
              <h3>Latest saved source</h3>
              <pre className="latex-conflict-file">{remoteCompareText}</pre>
            </section>
          </div>
          {(currentFile?.content.length || 0) > 60_000 ||
          (conflictFile?.content.length || 0) > 60_000 ? (
            <p className="muted">
              Long files show their first 60,000 characters here.
            </p>
          ) : null}
          <div className="inline-actions">
            <Button
              variant="ghost"
              onClick={() => setShowConflictReview(false)}
            >
              Close comparison
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setShowConflictReview(false);
                void autosave.keepLocal();
              }}
            >
              Keep my source
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                autosave.useSaved();
                if (serverProject) setPath(serverProject.mainFile);
                setShowConflictReview(false);
                setConflictSource(undefined);
              }}
            >
              Use latest
            </Button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
