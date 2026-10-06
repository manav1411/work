import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Download,
  FileText,
  LogOut,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { localDate, type UserPreferences } from "../../../shared/model";
import {
  Button,
  Card,
  Field,
  Input,
  Modal,
  PageHeader,
} from "../../components/ui";
import { downloadFile, jsonRequest, request } from "../../lib/api";
import { useWorkspace } from "../../lib/workspace";
import { useAutosave } from "../../lib/autosave";
import { displayName } from "../../lib/display-name";
import { editorDraftsFor, type EditorDraft } from "../../lib/device-drafts";
import {
  downloadWorkBackup,
  previewWorkBackup,
  restoreWorkBackup,
  type WorkBackupPreview,
} from "../../lib/backup";
import "./settings.css";

interface DeviceDraft {
  id: string;
  recordId: string;
  method: string;
  input?: Record<string, unknown>;
  patch?: Record<string, unknown>;
  issue?: string;
}
type Confirmation = {
  title: string;
  description: string;
  action: () => Promise<void>;
  phrase?: string;
} | null;

const LEGACY_LABELS: Record<string, string> = {
  note: "Notes",
  notes: "Notes",
  resource: "Resources",
  resources: "Resources",
  company: "Companies",
  companies: "Companies",
  contact: "Contacts",
  network: "Contacts",
  path: "Career direction",
  decision: "Career decisions",
  rotation: "Rotations",
  action: "Actions",
  focus: "Focus sessions",
  progress: "Learning journals",
  topic: "Learning journals",
  career: "Career direction",
  achievement: "Work evidence",
  evidence: "Work evidence",
  project: "Projects",
  projects: "Projects",
  review: "Weekly reviews",
  assets: "Career assets",
  asset: "Career assets",
  connectors: "Connectors",
  practice: "Practice journals",
  story: "Interview stories",
  stories: "Interview stories",
};

function leetCodeHandle(value: string): string {
  const text = value.trim().replace(/^@/, "");
  if (!text) return "";
  if (!text.includes("://")) return text;
  try {
    const url = new URL(text);
    const parts = url.pathname.split("/").filter(Boolean);
    if (
      url.protocol !== "https:" ||
      !["leetcode.com", "www.leetcode.com"].includes(url.hostname) ||
      url.username ||
      url.password ||
      !(parts.length === 1 || (parts.length === 2 && parts[0] === "u"))
    )
      return text;
    return parts.at(-1)!;
  } catch {
    return text;
  }
}

export function SettingsPage() {
  const {
    preferences,
    mode,
    user,
    pending,
    syncIssues,
    records,
    notify,
    refresh,
    savePreferences,
    signOut,
    syncOutbox,
    recoverDraft,
    discardDraft,
  } = useWorkspace();
  const location = useLocation();
  const preferenceSave = useAutosave<UserPreferences>({
    initial: preferences,
    storageKey: `work:preferences-draft:${user?.id || "anonymous"}:settings`,
    validate: (value) => {
      const handle = leetCodeHandle(value.leetcode);
      if (handle && !/^[A-Za-z0-9_-]{1,40}$/.test(handle))
        return "Check the LeetCode username.";
      try {
        new Intl.DateTimeFormat("en", {
          timeZone: value.timezone.trim(),
        }).format();
      } catch {
        return "Check the timezone.";
      }
      return null;
    },
    persist: async (value) => {
      const handle = leetCodeHandle(value.leetcode);
      const normalized = {
        ...value,
        displayName: value.displayName.trim(),
        timezone: value.timezone.trim(),
        leetcode: handle
          ? `https://leetcode.com/u/${encodeURIComponent(handle)}/`
          : "",
      };
      const saved = await savePreferences(normalized);
      return { value: saved };
    },
  });
  const { value: form, setValue: setForm, state: saveStatus } = preferenceSave;
  const username = leetCodeHandle(form.leetcode);
  const setUsername = (value: string) =>
    setForm((current) => ({ ...current, leetcode: value }));
  const [busy, setBusy] = useState("");
  const [drafts, setDrafts] = useState<DeviceDraft[]>([]);
  const [editorDrafts, setEditorDrafts] = useState<EditorDraft[]>([]);
  const [saveRecoveryOpen, setSaveRecoveryOpen] = useState(false);
  const [backup, setBackup] = useState<WorkBackupPreview | null>(null);
  const [backupName, setBackupName] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [confirmText, setConfirmText] = useState("");
  const legacy = new URLSearchParams(location.search).get("legacy");
  const requestedId = new URLSearchParams(location.search).get("record");
  const requestedRecord = records.find((record) => record.id === requestedId);

  useEffect(() => {
    document.documentElement.dataset.theme = form.theme;
  }, [form.theme]);
  useEffect(() => {
    if (!user) return;
    setEditorDrafts(editorDraftsFor(user.id, records, true));
    try {
      const value: unknown = JSON.parse(
        localStorage.getItem(`work-outbox:${user.id}`) ?? "[]",
      );
      setDrafts(Array.isArray(value) ? value : []);
    } catch {
      setDrafts([]);
    }
  }, [pending, user, records]);
  useEffect(() => {
    if (
      location.pathname.endsWith("import-export") ||
      location.hash === "#recovery"
    )
      document.getElementById("recovery")?.scrollIntoView({ block: "start" });
    if (location.hash === "#device-drafts") {
      setSaveRecoveryOpen(true);
      document
        .getElementById("device-drafts")
        ?.scrollIntoView({ block: "start" });
    }
  }, [location.pathname, location.hash]);

  const run = async (name: string, operation: () => Promise<void>) => {
    setBusy(name);
    try {
      await operation();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Could not finish this operation.",
        "error",
      );
    } finally {
      setBusy("");
    }
  };
  const exportBackup = () =>
    run("export", async () => {
      await downloadWorkBackup(mode);
      notify("Backup download started.");
    });
  const readBackup = (file?: File) =>
    run("backup-preview", async () => {
      if (!file) return;
      setBackup(null);
      setBackup(await previewWorkBackup(file));
      setBackupName(file.name);
    });
  const restoreBackup = async () => {
    if (!backup) return;
    const result = await restoreWorkBackup(backup, mode);
    notify(
      `Restored ${result.restored} records and ${result.attachments} files.`,
    );
    result.warnings.forEach((warning) => notify(warning, "info"));
    setBackup(null);
    await refresh();
  };
  const downloadDrafts = () =>
    downloadFile(
      JSON.stringify(
        {
          format: "work-device-drafts",
          exportedAt: new Date().toISOString(),
          ownerId: user?.id,
          drafts,
          editorDrafts,
        },
        null,
        2,
      ),
      `work-device-drafts-${localDate(new Date(), preferences.timezone)}.json`,
      "application/json",
    );
  const confirm = (value: Confirmation) => {
    setConfirmText("");
    setConfirmation(value);
  };
  return (
    <div className="page-stack simple-settings">
      <PageHeader title="Settings" />
      {legacy && (
        <Card className="legacy-recovery-note stack">
          <h2>{LEGACY_LABELS[legacy] || "This page"} has been retired</h2>
          <p>
            {requestedRecord
              ? `“${requestedRecord.title}” remains in your saved data.`
              : "Existing records, revisions, and files remain in your saved data."}{" "}
            Download a backup below to recover their contents.
          </p>
          <Button
            variant="secondary"
            disabled={!!busy}
            onClick={() => void exportBackup()}
          >
            <Download size={16} />
            Download backup
          </Button>
        </Card>
      )}
      {(pending > 0 || editorDrafts.length > 0) && (
        <details
          id="device-drafts"
          open={saveRecoveryOpen}
          onToggle={(event) => setSaveRecoveryOpen(event.currentTarget.open)}
        >
          <summary>
            Save recovery
            {syncIssues.length > 0 ? ` · ${syncIssues.length} need review` : ""}
          </summary>
          <Card className="stack">
            <h2>
              Pending changes{" "}
              <span className="settings-count">
                {pending +
                  editorDrafts.filter((draft) => !draft.archived).length}
              </span>
            </h2>
            <p className="muted">
              Changes resume saving automatically. These tools are available if
              a change needs review or you want to download a local copy.
            </p>
            <div className="inline-actions">
              {pending > 0 && (
                <Button
                  disabled={!!busy}
                  onClick={() => void run("sync", syncOutbox)}
                >
                  <RotateCcw size={16} />
                  Retry sync
                </Button>
              )}
              <Button
                variant="secondary"
                disabled={!!busy}
                onClick={downloadDrafts}
              >
                <Download size={16} />
                Download local changes
              </Button>
            </div>
            {drafts.map((draft) => (
              <details className="draft-conflict" key={draft.id}>
                <summary>
                  {records.find((record) => record.id === draft.recordId)
                    ?.title ?? String(draft.input?.title ?? draft.recordId)}
                </summary>
                {draft.issue && <p role="alert">{draft.issue}</p>}
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
                    disabled={!!busy}
                    onClick={() =>
                      confirm({
                        title: "Discard this device change?",
                        description:
                          "Only this unsynced change will be removed. Download local changes first if you need a copy.",
                        action: () => discardDraft(draft.id),
                      })
                    }
                  >
                    Discard change
                  </Button>
                </div>
              </details>
            ))}
            {editorDrafts.map((draft) => (
              <details className="draft-conflict" key={draft.key}>
                <summary>{draft.title}</summary>
                <pre>{draft.value}</pre>
                <div className="inline-actions">
                  <Link className="button button-secondary" to={draft.url}>
                    Open editor
                  </Link>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      confirm({
                        title: "Discard this local change?",
                        description:
                          "Download local changes first if you need a copy. Saved records remain available.",
                        action: async () => {
                          localStorage.removeItem(draft.key);
                          setEditorDrafts(
                            editorDraftsFor(user?.id ?? "", records, true),
                          );
                        },
                      })
                    }
                  >
                    Discard local change
                  </Button>
                </div>
              </details>
            ))}
          </Card>
        </details>
      )}
      <div className="simple-settings-grid">
        <Card className="stack">
          <h2>Account</h2>
          <div className="settings-account-row">
            <span className="settings-account-avatar" aria-hidden="true">
              {(mode === "demo" ? "D" : displayName(preferences, user))
                .slice(0, 1)
                .toUpperCase()}
            </span>
            <div>
              <strong>
                {mode === "demo" ? "Demo" : displayName(preferences, user)}
              </strong>
              <p>{mode === "demo" ? "Sample data in this tab" : user?.email}</p>
            </div>
            <Button
              variant="ghost"
              disabled={!!busy}
              onClick={() => void run("signout", signOut)}
            >
              <LogOut size={16} />
              {mode === "demo" ? "Leave demo" : "Sign out"}
            </Button>
          </div>
          <div
            className="stack settings-preferences"
            onBlur={() => void preferenceSave.flush()}
          >
            <Field label="Display name">
              <Input
                value={form.displayName}
                maxLength={100}
                placeholder={user?.name || "Your name"}
                onChange={(event) => {
                  setForm({ ...form, displayName: event.target.value });
                }}
              />
            </Field>
            <Field label="Timezone">
              <Input
                value={form.timezone}
                onChange={(event) => {
                  setForm({ ...form, timezone: event.target.value });
                }}
                list="settings-timezones"
              />
              <datalist id="settings-timezones">
                <option value="Australia/Melbourne" />
                <option value="Australia/Sydney" />
                <option value="America/Los_Angeles" />
                <option value="UTC" />
              </datalist>
            </Field>
            <Field label="Appearance">
              <div
                className="theme-switch"
                role="group"
                aria-label="Appearance"
              >
                {(["light", "dark"] as const).map((theme) => (
                  <button
                    type="button"
                    key={theme}
                    aria-pressed={form.theme === theme}
                    onClick={() => {
                      document.documentElement.dataset.theme = theme;
                      setForm({ ...form, theme });
                    }}
                  >
                    {theme === "light" ? "Light" : "Dark"}
                  </button>
                ))}
              </div>
            </Field>
            <Field
              label="LeetCode username"
              hint="Learn uses your public solve history."
            >
              <Input
                value={username}
                autoComplete="off"
                maxLength={200}
                onChange={(event) => {
                  setUsername(event.target.value);
                }}
                placeholder="Username or profile URL"
              />
            </Field>
            <span className="settings-save-status" role="status">
              {saveStatus}
            </span>
            {preferenceSave.error && <p role="alert">{preferenceSave.error}</p>}
            {preferenceSave.conflict && (
              <div className="inline-actions">
                <Button onClick={() => void preferenceSave.keepLocal()}>
                  Keep my changes
                </Button>
                <Button variant="secondary" onClick={preferenceSave.useSaved}>
                  Use saved settings
                </Button>
              </div>
            )}
          </div>
        </Card>
        <Card className="stack" id="recovery">
          <h2>Backup & recovery</h2>
          <p className="muted">
            Backups include records, revisions, goals, settings, and saved
            files, including retired sections.
          </p>
          {(pending > 0 || editorDrafts.length > 0) && (
            <p className="field-hint">
              Changes still waiting to sync are stored on this device. Save
              recovery above includes an optional download of these changes.
            </p>
          )}
          <Button disabled={!!busy} onClick={() => void exportBackup()}>
            <Download size={16} />
            {busy === "export" ? "Downloading…" : "Download backup"}
          </Button>
          <label
            className={`button button-secondary file-input-label ${busy ? "backup-input-disabled" : ""}`}
          >
            <Upload size={16} />
            Restore backup
            <input
              type="file"
              disabled={!!busy}
              accept=".tar,.json,application/x-tar,application/json"
              aria-label="Choose Work backup"
              onChange={(event) => {
                void readBackup(event.target.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
          </label>
          {backup && (
            <div className="backup-preview stack">
              <p>
                <FileText size={16} />
                {backupName}
                <span>
                  {backup.manifest.records.length} records
                  {Array.isArray(backup.manifest.goals)
                    ? ` · ${backup.manifest.goals.length} goals`
                    : ""}
                </span>
              </p>
              {backup.manifest.attachments.some((file) => file.missing) && (
                <p role="alert" className="notice notice-warning">
                  This backup is missing contents for{" "}
                  {
                    backup.manifest.attachments.filter((file) => file.missing)
                      .length
                  }{" "}
                  file(s). Their metadata will be retained; the missing bytes
                  cannot be recovered from this backup.
                </p>
              )}
              <div className="inline-actions">
                <Button
                  disabled={!!busy || pending > 0}
                  onClick={() =>
                    confirm({
                      title: "Restore this backup?",
                      description:
                        "Records and files will be restored as separate copies. Your current records remain; settings will use the backup values. Download a current backup first to preserve your settings.",
                      action: restoreBackup,
                    })
                  }
                >
                  Restore backup
                </Button>
                <Button
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() => setBackup(null)}
                >
                  Cancel
                </Button>
              </div>
              {pending > 0 && (
                <p className="field-hint">
                  Sync or recover device changes before restoring a backup.
                </p>
              )}
            </div>
          )}
        </Card>
      </div>
      {mode === "cloud" && (
        <details className="settings-account-security">
          <summary>Account deletion</summary>
          <Card className="settings-danger stack">
            <p className="muted">
              Deleting your account permanently removes private records, files,
              settings, and sessions. Your GitHub account is unaffected.
            </p>
            <Button
              variant="danger"
              disabled={!!busy || pending > 0}
              onClick={() =>
                confirm({
                  title: "Delete your account?",
                  description:
                    "Download a full backup first. This permanently removes your private data and signs you out. Type DELETE MY ACCOUNT to confirm.",
                  phrase: "DELETE MY ACCOUNT",
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
              Delete account
            </Button>
          </Card>
        </details>
      )}
      <Modal
        open={!!confirmation}
        onClose={() => {
          if (!busy) setConfirmation(null);
        }}
        title={confirmation?.title || ""}
        description={confirmation?.description}
      >
        {confirmation?.phrase && (
          <Field label={`Type ${confirmation.phrase} to confirm`}>
            <Input
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              autoComplete="off"
            />
          </Field>
        )}
        <div className="modal-actions">
          <Button
            variant="secondary"
            disabled={!!busy}
            onClick={() => setConfirmation(null)}
          >
            Cancel
          </Button>
          <Button
            variant={confirmation?.phrase ? "danger" : "primary"}
            disabled={
              !!busy ||
              (!!confirmation?.phrase && confirmText !== confirmation.phrase)
            }
            onClick={() =>
              void run("confirmation", async () => {
                await confirmation?.action();
                setConfirmation(null);
              })
            }
          >
            {busy ? "Working…" : "Confirm"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
