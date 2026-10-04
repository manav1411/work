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
  Select,
} from "../../components/ui";
import { downloadFile, jsonRequest, request } from "../../lib/api";
import { useWorkspace } from "../../lib/workspace";
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
  const [form, setForm] = useState<UserPreferences>({ ...preferences });
  const [username, setUsername] = useState(
    leetCodeHandle(preferences.leetcode),
  );
  const [busy, setBusy] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [drafts, setDrafts] = useState<DeviceDraft[]>([]);
  const [editorDrafts, setEditorDrafts] = useState<EditorDraft[]>([]);
  const [backup, setBackup] = useState<WorkBackupPreview | null>(null);
  const [backupName, setBackupName] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [confirmText, setConfirmText] = useState("");
  const legacy = new URLSearchParams(location.search).get("legacy");
  const requestedId = new URLSearchParams(location.search).get("record");
  const requestedRecord = records.find((record) => record.id === requestedId);

  useEffect(() => {
    setForm({ ...preferences });
    setUsername(leetCodeHandle(preferences.leetcode));
  }, [preferences]);
  useEffect(() => {
    if (!user) return;
    setEditorDrafts(editorDraftsFor(user.id, records));
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
    if (location.hash === "#device-drafts")
      document
        .getElementById("device-drafts")
        ?.scrollIntoView({ block: "start" });
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
  const save = () =>
    run("preferences", async () => {
      try {
        new Intl.DateTimeFormat("en", {
          timeZone: form.timezone.trim(),
        }).format();
      } catch {
        throw new Error("Enter a valid timezone, such as Australia/Melbourne.");
      }
      const handle = leetCodeHandle(username);
      if (handle && !/^[A-Za-z0-9_-]{1,40}$/.test(handle))
        throw new Error("Enter a valid LeetCode username or profile URL.");
      await savePreferences({
        timezone: form.timezone.trim(),
        reducedMotion: form.reducedMotion,
        theme: form.theme,
        leetcode: handle
          ? `https://leetcode.com/u/${encodeURIComponent(handle)}/`
          : "",
      });
      setSaveStatus("Saved");
    });
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
        <Card id="device-drafts" className="stack">
          <h2>
            Device drafts{" "}
            <span className="settings-count">
              {pending + editorDrafts.length}
            </span>
          </h2>
          <p className="muted">
            These changes are stored on this device. Download them before
            clearing browser data or leaving your account.
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
              Download device drafts
            </Button>
          </div>
          {drafts.map((draft) => (
            <details className="draft-conflict" key={draft.id}>
              <summary>
                {records.find((record) => record.id === draft.recordId)
                  ?.title ?? String(draft.input?.title ?? draft.recordId)}
              </summary>
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
                        "Only this unsynced change will be removed. Download your device drafts first if you need a copy.",
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
                  Review draft
                </Link>
                <Button
                  variant="ghost"
                  onClick={() =>
                    confirm({
                      title: "Discard this editor draft?",
                      description:
                        "Download device drafts first if you need a copy. Saved records remain available.",
                      action: async () => {
                        localStorage.removeItem(draft.key);
                        setEditorDrafts(
                          editorDraftsFor(user?.id ?? "", records),
                        );
                      },
                    })
                  }
                >
                  Discard draft
                </Button>
              </div>
            </details>
          ))}
        </Card>
      )}
      <div className="simple-settings-grid">
        <Card className="stack">
          <h2>Account</h2>
          <div className="settings-account-row">
            <span className="settings-account-avatar" aria-hidden="true">
              {(mode === "demo" ? "D" : user?.name || "A")
                .slice(0, 1)
                .toUpperCase()}
            </span>
            <div>
              <strong>{mode === "demo" ? "Demo" : user?.name}</strong>
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
          <form
            className="stack settings-preferences"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
            onChange={() => setSaveStatus("")}
          >
            <Field label="Timezone">
              <Input
                value={form.timezone}
                onChange={(event) =>
                  setForm({ ...form, timezone: event.target.value })
                }
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
              <Select
                value={form.theme}
                onChange={(event) =>
                  setForm({
                    ...form,
                    theme: event.target.value as UserPreferences["theme"],
                  })
                }
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </Select>
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
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.reducedMotion}
                onChange={(event) =>
                  setForm({ ...form, reducedMotion: event.target.checked })
                }
              />
              Reduce motion
            </label>
            <div className="inline-actions">
              <Button type="submit" disabled={!!busy}>
                {busy === "preferences" ? "Saving…" : "Save"}
              </Button>
              <span className="settings-save-status" role="status">
                {saveStatus}
              </span>
            </div>
          </form>
        </Card>
        <Card className="stack" id="recovery">
          <h2>Backup & recovery</h2>
          <p className="muted">
            Backups include records, revisions, goals, settings, and saved
            files, including retired sections.
          </p>
          {(pending > 0 || editorDrafts.length > 0) && (
            <p className="field-hint">
              Device drafts are separate from the saved backup. Download them
              above before clearing browser data.
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
