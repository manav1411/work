import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  ArrowRight,
  Check,
  Cloud,
  Download,
  FileText,
  LogOut,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { GitHubIcon as Github } from "../../components/GitHubIcon";
import {
  KIND_LABELS,
  localDate,
  type UserPreferences,
  type WorkRecord,
} from "../../../shared/model";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Textarea,
} from "../../components/ui";
import { downloadFile, jsonRequest, request } from "../../lib/api";
import { useWorkspace } from "../../lib/workspace";
import { parseMarkdownFiles, type ImportPreview } from "./import";

interface ImportBatch {
  id: string;
  source: string;
  createdAt: string;
  undoneAt: string | null;
  created: number;
  updated: number;
  skipped: number;
}
interface DeviceDraft {
  id: string;
  recordId: string;
  method: string;
  input?: Record<string, unknown>;
  patch?: Record<string, unknown>;
}
type Confirmation = {
  title: string;
  description: string;
  action: () => Promise<void>;
  permanent?: boolean;
} | null;
const humanBytes = (value: number) =>
  `${(value / (1024 * 1024)).toFixed(2)} MB`;

export function SettingsPage() {
  const workspace = useWorkspace();
  const {
    preferences,
    mode,
    user,
    pending,
    records,
    notify,
    refresh,
    restore,
    savePreferences,
    signOut,
    syncOutbox,
    recoverDraft,
    discardDraft,
  } = workspace;
  const location = useLocation();
  const dataTab = location.pathname.endsWith("import-export");
  const [form, setForm] = useState<UserPreferences>({ ...preferences });
  const [stageText, setStageText] = useState(
    preferences.customStages.join("\n"),
  );
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [source, setSource] = useState("Notion Markdown export");
  const [importMode, setImportMode] = useState("keep");
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [trash, setTrash] = useState<WorkRecord[]>([]);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [deleteText, setDeleteText] = useState("");
  const [backup, setBackup] = useState<Record<string, unknown> | null>(null);
  const [backupName, setBackupName] = useState("");
  const [metadataOnly, setMetadataOnly] = useState(false);
  const [drafts, setDrafts] = useState<DeviceDraft[]>([]);
  const folderInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    folderInput.current?.setAttribute("webkitdirectory", "");
  }, [dataTab]);
  useEffect(() => {
    setForm({ ...preferences });
    setStageText(preferences.customStages.join("\n"));
  }, [preferences]);
  useEffect(() => {
    if (!user) return;
    try {
      setDrafts(
        JSON.parse(localStorage.getItem(`work-outbox:${user.id}`) ?? "[]"),
      );
    } catch {
      setDrafts([]);
    }
  }, [pending, user, records]);
  const loadData = async () => {
    const [history, rows] = await Promise.all([
      request<{ batches: ImportBatch[] }>("/api/import"),
      request<{ records: WorkRecord[] }>("/api/records?includeDeleted=true"),
    ]);
    setBatches(history.batches);
    setTrash(rows.records.filter((record) => record.deletedAt));
  };
  useEffect(() => {
    if (dataTab)
      void loadData().catch((error) => notify(String(error), "error"));
  }, [dataTab, mode]);
  const run = async (name: string, operation: () => Promise<void>) => {
    setBusy(name);
    try {
      await operation();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "This operation could not finish. Please retry.",
        "error",
      );
    } finally {
      setBusy("");
    }
  };
  const save = () =>
    run("preferences", async () => {
      const stages = [
        ...new Set(
          stageText
            .split("\n")
            .map((stage) => stage.trim())
            .filter(Boolean),
        ),
      ];
      if (
        stages.length < 2 ||
        stages.length > 20 ||
        stages.some((stage) => stage.length > 50)
      )
        throw new Error(
          "Use 2–20 unique application stages, at most 50 characters each.",
        );
      try {
        new Intl.DateTimeFormat("en", { timeZone: form.timezone }).format();
      } catch {
        throw new Error(
          "Enter a valid IANA timezone, such as Australia/Melbourne.",
        );
      }
      await savePreferences({ ...form, customStages: stages });
      notify("Your workspace, a little more you.");
    });
  const selectFiles = (files: File[]) =>
    run("preview", async () => {
      setPreview(await parseMarkdownFiles(files));
      setBackup(null);
    });
  const importFiles = () =>
    run("import", async () => {
      if (!preview || preview.errors.length || !preview.records.length) return;
      const response = await request<{
        created: number;
        updated: number;
        skipped: number;
        warnings: string[];
      }>(
        "/api/import",
        jsonRequest("POST", {
          source: source.trim() || "Markdown import",
          mode: importMode,
          records: preview.records,
          idempotencyKey: `import-${crypto.randomUUID()}`,
        }),
      );
      notify(
        `${response.created} created · ${response.updated} updated · ${response.skipped} skipped.`,
      );
      response.warnings.forEach((warning) => notify(warning, "info"));
      setPreview(null);
      await refresh();
      await loadData();
    });
  const exportWorkspace = () =>
    run("export", async () => {
      const archive = await request<Record<string, unknown>>(
        `/api/export${metadataOnly ? "?files=false" : ""}`,
      );
      downloadFile(
        JSON.stringify(archive, null, 2),
        `work-${metadataOnly ? "metadata-" : ""}backup-${localDate(new Date(), preferences.timezone)}.json`,
        "application/json",
      );
      notify(
        metadataOnly
          ? "Metadata archive downloaded. File contents are not included."
          : "Full backup downloaded. Keep it somewhere private.",
      );
    });
  const readBackup = (file?: File) =>
    run("backup-preview", async () => {
      if (!file) return;
      if (file.size > 30 * 1024 * 1024)
        throw new Error(
          "Select an archive smaller than 30 MB. Larger workspaces need smaller archives.",
        );
      const value: unknown = JSON.parse(await file.text());
      if (
        !value ||
        typeof value !== "object" ||
        !("format" in value) ||
        value.format !== "work-export" ||
        !("version" in value) ||
        value.version !== 1 ||
        !("records" in value) ||
        !Array.isArray(value.records)
      )
        throw new Error("This is not a supported Work backup (version 1).");
      setBackup(value as Record<string, unknown>);
      setBackupName(file.name);
      setPreview(null);
    });
  const restoreBackup = () =>
    run("restore", async () => {
      if (!backup) return;
      const response = await request<{
        restored: number;
        attachments: number;
        warnings: string[];
      }>("/api/restore", jsonRequest("POST", backup));
      notify(
        `${response.restored} records restored as a separate archive, with ${response.attachments} attachments.`,
      );
      response.warnings.forEach((warning) => notify(warning, "info"));
      setBackup(null);
      await refresh();
      await loadData();
    });
  const downloadDrafts = () =>
    downloadFile(
      JSON.stringify(
        {
          format: "work-device-drafts",
          exportedAt: new Date().toISOString(),
          ownerId: user?.id,
          drafts,
        },
        null,
        2,
      ),
      `work-device-drafts-${localDate()}.json`,
      "application/json",
    );
  const confirm = (value: Confirmation) => {
    setDeleteText("");
    setConfirmation(value);
  };
  const confirmRun = () =>
    run("confirmation", async () => {
      await confirmation?.action();
      setConfirmation(null);
    });
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="A PLACE THAT FITS YOU"
        title="Make it yours"
        description="Your profile, your pace, your notes. Keep the important things safe."
        action={
          <Button
            variant="secondary"
            disabled={!!busy}
            onClick={() => void run("signout", signOut)}
          >
            <LogOut size={16} />
            {mode === "demo" ? "Leave preview" : "Sign out"}
          </Button>
        }
      />
      <nav className="settings-tabs" aria-label="Settings sections">
        <NavLink end to="/settings">
          Profile & preferences
        </NavLink>
        <NavLink to="/settings/import-export">
          Import, export & recovery
        </NavLink>
      </nav>
      {mode === "demo" && (
        <div className="notice">
          <ShieldCheck size={17} />
          This is an isolated preview. Imports and edits stay in this browser
          tab; they do not affect a private account.
        </div>
      )}
      {pending > 0 && (
        <Card className="stack">
          <div className="section-heading">
            <h2>
              Your device drafts<Badge tone="orange">{pending} unsynced</Badge>
            </h2>
            <Cloud size={19} />
          </div>
          <p className="muted">
            These changes are stored on this device. Download them before
            clearing browser data. If a newer cloud edit conflicts, save your
            draft as a separate record; the original stays unchanged.
          </p>
          <div className="inline-actions">
            <Button
              onClick={() => void run("sync", syncOutbox)}
              disabled={!!busy}
            >
              Try syncing
              <RotateCcw size={16} />
            </Button>
            <Button variant="secondary" onClick={downloadDrafts}>
              <Download size={16} />
              Download device drafts
            </Button>
          </div>
          {drafts.map((draft) => (
            <div key={draft.id} className="draft-conflict">
              <strong>
                {records.find((record) => record.id === draft.recordId)
                  ?.title ?? String(draft.input?.title ?? draft.recordId)}
              </strong>
              <pre>{JSON.stringify(draft.patch ?? draft.input, null, 2)}</pre>
              <div className="inline-actions">
                <Button
                  variant="secondary"
                  disabled={!!busy}
                  onClick={() =>
                    void run("recover", () => recoverDraft(draft.id))
                  }
                >
                  Save a separate copy
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    confirm({
                      title: "Discard this device draft?",
                      description:
                        "The cloud record stays as it is. This unsynced device change will be removed. Download the drafts first if you want a copy.",
                      action: () => discardDraft(draft.id),
                    })
                  }
                >
                  Discard device change
                </Button>
              </div>
            </div>
          ))}
        </Card>
      )}
      {!dataTab ? (
        <div className="settings-grid">
          <Card className="stack">
            <div className="settings-toolbar">
              <h2>A little about you</h2>
              <Badge tone="lime">Private profile</Badge>
            </div>
            <form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <div className="form-grid">
                <Field label="What should we call you?">
                  <Input
                    value={form.displayName}
                    maxLength={120}
                    onChange={(event) =>
                      setForm({ ...form, displayName: event.target.value })
                    }
                  />
                </Field>
                <Field
                  label="Timezone"
                  hint="Dates and interview times use this IANA timezone."
                >
                  <Input
                    value={form.timezone}
                    onChange={(event) =>
                      setForm({ ...form, timezone: event.target.value })
                    }
                    list="timezones"
                  />
                  <datalist id="timezones">
                    <option value="Australia/Melbourne" />
                    <option value="Australia/Sydney" />
                    <option value="America/Los_Angeles" />
                    <option value="UTC" />
                  </datalist>
                </Field>
                <Field label="Current company">
                  <Input
                    value={form.currentCompany}
                    onChange={(event) =>
                      setForm({ ...form, currentCompany: event.target.value })
                    }
                  />
                </Field>
                <Field label="Current engineering stack">
                  <Input
                    value={form.stack}
                    onChange={(event) =>
                      setForm({ ...form, stack: event.target.value })
                    }
                    placeholder="Languages, frameworks, tools"
                  />
                </Field>
              </div>
              <h3>Your profile destinations</h3>
              {(
                [
                  "website",
                  "github",
                  "linkedin",
                  "leetcode",
                  "overleaf",
                ] as const
              ).map((key) => (
                <Field
                  label={
                    {
                      website: "Personal website",
                      github: "GitHub",
                      linkedin: "LinkedIn",
                      leetcode: "LeetCode profile",
                      overleaf: "Overleaf project",
                    }[key]
                  }
                  key={key}
                >
                  <Input
                    type="url"
                    value={form[key]}
                    onChange={(event) =>
                      setForm({ ...form, [key]: event.target.value })
                    }
                    placeholder="https://…"
                  />
                </Field>
              ))}
              <h3>A sustainable week</h3>
              <div className="form-grid">
                <Field label="Career preparation hours">
                  <Input
                    type="number"
                    min="0"
                    max="60"
                    step=".5"
                    value={form.weeklyHours}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        weeklyHours: Number(event.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Application target">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={form.weeklyApplications}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        weeklyApplications: Number(event.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Practice attempt target">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={form.weeklyPractice}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        weeklyPractice: Number(event.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Theme">
                  <Select
                    value={form.theme}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        theme: event.target.value as "light" | "dark",
                      })
                    }
                  >
                    <option value="light">Paper & punch</option>
                    <option value="dark">After hours</option>
                  </Select>
                </Field>
              </div>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.reducedMotion}
                  onChange={(event) =>
                    setForm({ ...form, reducedMotion: event.target.checked })
                  }
                />
                Reduce motion and animated interactions
              </label>
              <Field
                label="Application stages"
                hint="One per line, in order. Renaming does not rewrite historical application stages."
              >
                <Textarea
                  value={stageText}
                  onChange={(event) => setStageText(event.target.value)}
                  rows={6}
                />
              </Field>
              <div className="modal-actions">
                <Button type="submit" disabled={!!busy}>
                  {busy === "preferences" ? "Saving…" : "Save my preferences"}
                  <Check size={16} />
                </Button>
              </div>
            </form>
          </Card>
          <div className="stack">
            <Card className="stack">
              <ShieldCheck size={30} />
              <h2>Your work stays yours.</h2>
              <p className="muted">
                {mode === "cloud"
                  ? "GitHub sign-in protects your cloud workspace. Records, files and search results are checked against your account on the server."
                  : mode === "local"
                    ? "Local development runs against an isolated database. Its fixture sign-in is disabled on all deployed environments."
                    : "This preview uses synthetic examples in this tab. It does not fetch private cloud records."}
              </p>
              <div className="settings-data-row">
                <div>
                  <strong>{user?.name}</strong>
                  <p>{user?.email}</p>
                </div>
                <Badge>
                  {mode === "cloud"
                    ? "Cloud workspace"
                    : mode === "local"
                      ? "Local development"
                      : "Preview only"}
                </Badge>
              </div>
            </Card>
            <Card className="stack">
              <Github size={27} />
              <h3>Useful connections, kept simple.</h3>
              <p className="settings-source">
                LeetCode attempts are recorded manually; your public profile
                opens in a new tab. Overleaf remains your LaTeX editor—upload
                its PDF here. LinkedIn and email outreach are drafts you choose
                to send externally. No automated job applications, messages, or
                inferred achievements.
              </p>
              <NavLink className="text-link" to="/settings/import-export">
                Bring your notes along
                <ArrowRight size={16} />
              </NavLink>
            </Card>
          </div>
        </div>
      ) : (
        <div className="page-stack">
          <div className="settings-grid">
            <Card className="stack">
              <div className="section-heading">
                <h2>Bring your notes along</h2>
                <Upload size={20} />
              </div>
              <p className="muted">
                Choose your unzipped Notion Markdown export folder to keep page
                links and screenshots together. You can also select Markdown
                files or a résumé PDF. Originals stay untouched.
              </p>
              <div
                className="dropzone"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void selectFiles([...event.dataTransfer.files]);
                }}
              >
                <Upload size={29} />
                <p>
                  Select a folder for nested exports. Drag-and-drop supports
                  individual files, not folder contents.
                </p>
                <div className="inline-actions">
                  <label className="button button-primary file-input-label">
                    Choose export folder
                    <input
                      ref={folderInput}
                      type="file"
                      multiple
                      aria-label="Choose export folder"
                      onChange={(event) =>
                        void selectFiles([...(event.target.files ?? [])])
                      }
                    />
                  </label>
                  <label className="button button-secondary file-input-label">
                    Choose files
                    <input
                      type="file"
                      multiple
                      accept=".md,.markdown,.png,.jpg,.jpeg,.pdf"
                      aria-label="Choose import files"
                      onChange={(event) =>
                        void selectFiles([...(event.target.files ?? [])])
                      }
                    />
                  </label>
                </div>
                {busy === "preview" && (
                  <p aria-live="polite">Checking pages, links and files…</p>
                )}
              </div>
              {preview && (
                <div className="stack">
                  <div className="inline-actions">
                    <Badge tone="blue">{preview.stats.records} records</Badge>
                    <Badge tone="pink">{preview.stats.attachments} files</Badge>
                    <Badge>{humanBytes(preview.stats.bytes)}</Badge>
                  </div>
                  {preview.errors.map((message) => (
                    <div className="notice notice-warning" key={message}>
                      {message}
                    </div>
                  ))}
                  {preview.warnings.length > 0 && (
                    <details>
                      <summary>
                        {preview.warnings.length} warnings to review
                      </summary>
                      <ul className="settings-source">
                        {preview.warnings.map((message) => (
                          <li key={message}>{message}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <div className="import-preview-list">
                    {preview.records.map((item) => (
                      <div className="import-preview-row" key={item.sourceId}>
                        <FileText size={17} />
                        <span>
                          <strong>{item.record.title}</strong>
                          <small>
                            {String(
                              item.record.data?.originalPath ??
                                item.record.data?.sourcePath ??
                                "",
                            )}{" "}
                            · {item.record.body?.slice(0, 100)}
                          </small>
                        </span>
                        <Badge>{KIND_LABELS[item.record.kind]}</Badge>
                      </div>
                    ))}
                  </div>
                  <Field label="Source label">
                    <Input
                      value={source}
                      maxLength={200}
                      onChange={(event) => setSource(event.target.value)}
                    />
                  </Field>
                  <Field
                    label="If this source was imported before"
                    hint="Duplicate detection uses source paths and content hashes. Merge appends changed source content without losing your edits; replace creates a revision you can restore."
                  >
                    <Select
                      value={importMode}
                      onChange={(event) => setImportMode(event.target.value)}
                    >
                      <option value="keep">
                        Keep my existing notes; skip duplicates
                      </option>
                      <option value="merge">
                        Merge changed source content into existing notes
                      </option>
                      <option value="replace">
                        Replace changed notes with this source version
                      </option>
                    </Select>
                  </Field>
                  <Button
                    disabled={
                      !!busy ||
                      !!preview.errors.length ||
                      !preview.records.length ||
                      !source.trim()
                    }
                    onClick={() => void importFiles()}
                  >
                    Import {preview.records.length} records
                    <ArrowRight size={16} />
                  </Button>
                </div>
              )}
            </Card>
            <div className="stack">
              <Card className="stack">
                <div className="section-heading">
                  <h2>A copy you control</h2>
                  <Download size={20} />
                </div>
                <p className="muted">
                  Download all records, revisions, preferences, trash and file
                  contents in a versioned JSON archive. It contains private
                  information—store it safely.
                </p>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={metadataOnly}
                    onChange={(event) => setMetadataOnly(event.target.checked)}
                  />
                  Metadata only (no file contents; for larger workspaces)
                </label>
                <Button
                  variant="secondary"
                  disabled={!!busy}
                  onClick={() => void exportWorkspace()}
                >
                  <Download size={16} />
                  {metadataOnly
                    ? "Download metadata archive"
                    : "Download full backup"}
                </Button>
                <p className="field-hint">
                  A metadata-only archive cannot recover lost file contents.
                  Full exports are limited to 20 MB of embedded files; download
                  important documents separately for larger workspaces.
                </p>
              </Card>
              <Card className="stack">
                <h2>Recover a backup</h2>
                <p className="muted">
                  Restore records as a separate archive with new IDs. Existing
                  records are not overwritten. Preferences from the backup will
                  be restored; related links and revisions are preserved.
                </p>
                <label className="button button-secondary file-input-label">
                  <Upload size={16} />
                  Choose a Work backup
                  <input
                    type="file"
                    accept=".json,application/json"
                    aria-label="Choose Work backup"
                    onChange={(event) =>
                      void readBackup(event.target.files?.[0])
                    }
                  />
                </label>
                {backup && (
                  <>
                    <div className="notice">
                      <FileText size={17} />
                      {backupName} · {(backup.records as unknown[]).length}{" "}
                      records
                    </div>
                    <Button
                      disabled={!!busy}
                      onClick={() =>
                        confirm({
                          title: "Restore this archive?",
                          description:
                            "Records will be copied into your workspace. Your current records stay unchanged, but profile preferences will be restored from the backup. Download a current backup first if you want to preserve those settings.",
                          action: restoreBackup,
                        })
                      }
                    >
                      Restore as separate archive
                      <RotateCcw size={16} />
                    </Button>
                  </>
                )}
              </Card>
            </div>
          </div>
          <Card className="stack">
            <div className="section-heading">
              <h2>Import history</h2>
              <RotateCcw size={20} />
            </div>
            {batches.length ? (
              batches.map((batch) => (
                <div className="settings-data-row" key={batch.id}>
                  <div>
                    <strong>{batch.source}</strong>
                    <p>
                      {new Date(batch.createdAt).toLocaleString("en-AU", {
                        timeZone: preferences.timezone,
                      })}{" "}
                      · {batch.created} created · {batch.updated} updated ·{" "}
                      {batch.skipped} skipped
                    </p>
                  </div>
                  {batch.undoneAt ? (
                    <Badge>Undone</Badge>
                  ) : (
                    <Button
                      variant="secondary"
                      disabled={!!busy}
                      onClick={() =>
                        confirm({
                          title: "Undo this import?",
                          description:
                            "New records will move to trash, and changed records will recover their pre-import versions. Undo is refused if you edited affected records after this import. Uploaded files remain recoverable in trash until permanent deletion.",
                          action: async () => {
                            await request(`/api/import/${batch.id}/undo`, {
                              method: "POST",
                            });
                            await refresh();
                            await loadData();
                            notify("Import undone. Originals are safe.");
                          },
                        })
                      }
                    >
                      Undo import
                    </Button>
                  )}
                </div>
              ))
            ) : (
              <p className="muted">
                Your imports will appear here.
                {mode === "demo" &&
                  " Import undo is verified in the private cloud workspace, not this tab-only preview."}
              </p>
            )}
          </Card>
          <Card className="stack">
            <div className="section-heading">
              <h2>Nothing lost in a hurry</h2>
              <Trash2 size={20} />
            </div>
            {trash.length ? (
              trash.map((record) => (
                <div className="settings-data-row" key={record.id}>
                  <div>
                    <strong>{record.title}</strong>
                    <p>
                      {KIND_LABELS[record.kind]} · moved to trash{" "}
                      {record.deletedAt?.slice(0, 10)}
                    </p>
                  </div>
                  <div className="inline-actions">
                    <Button
                      variant="secondary"
                      disabled={!!busy}
                      onClick={() =>
                        void run("trash-restore", async () => {
                          await restore(record.id);
                          await loadData();
                          notify("Restored.");
                        })
                      }
                    >
                      <RotateCcw size={14} />
                      Restore
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        confirm({
                          title: "Permanently delete this record?",
                          description:
                            "This deletes its record, revisions and attached files from the server. A previously downloaded backup is the only recovery option.",
                          permanent: true,
                          action: async () => {
                            await request(
                              `/api/records/${record.id}/permanent`,
                              { method: "DELETE" },
                            );
                            await loadData();
                            notify(
                              "Record and its attachments permanently removed. A downloaded backup can still recover them.",
                            );
                          },
                        })
                      }
                    >
                      <Trash2 size={15} />
                      Delete forever
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState
                title="Your trash is empty"
                description="Deleted records stay recoverable here until you explicitly remove them forever."
              />
            )}
          </Card>
          {mode === "cloud" && (
            <Card className="settings-danger stack">
              <h2>Delete my private workspace</h2>
              <p className="muted">
                This permanently deletes your account, saved records, revisions,
                preferences, private files and sessions. It cannot be undone
                without a downloaded backup. It does not delete your GitHub
                account or OAuth app.
              </p>
              <Button
                variant="danger"
                disabled={!!busy || pending > 0}
                onClick={() =>
                  confirm({
                    title: "Delete your entire workspace?",
                    description:
                      "Download a complete backup first. This removes all private server data and signs you out. Type DELETE MY WORKSPACE to confirm.",
                    permanent: true,
                    action: async () => {
                      await request(
                        "/api/account/delete",
                        jsonRequest("POST", {
                          confirmation: "DELETE MY WORKSPACE",
                        }),
                      );
                      localStorage.removeItem(`work-outbox:${user?.id}`);
                      window.location.assign("/");
                    },
                  })
                }
              >
                <Trash2 size={16} />
                Delete workspace
              </Button>
            </Card>
          )}
        </div>
      )}
      <Modal
        open={!!confirmation}
        onClose={() => setConfirmation(null)}
        title={confirmation?.title ?? ""}
        description={confirmation?.description}
      >
        {confirmation?.permanent && (
          <Field label="Type DELETE MY WORKSPACE to confirm">
            <Input
              value={deleteText}
              onChange={(event) => setDeleteText(event.target.value)}
              autoComplete="off"
            />
          </Field>
        )}
        <div className="modal-actions">
          <Button variant="secondary" onClick={() => setConfirmation(null)}>
            Keep it as it is
          </Button>
          <Button
            variant={confirmation?.permanent ? "danger" : "primary"}
            disabled={
              !!busy ||
              (!!confirmation?.permanent &&
                deleteText !== "DELETE MY WORKSPACE")
            }
            onClick={() => void confirmRun()}
          >
            {busy ? "Working…" : "Confirm"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
