import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Download,
  FileText,
  LogOut,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import {
  connectorName,
  type ConnectorConnection,
  type ConnectorsResponse,
} from "../../../shared/connectors";
import {
  KIND_LABELS,
  localDate,
  type Attachment,
  type UserPreferences,
  type WorkRecord,
} from "../../../shared/model";
import {
  Button,
  Card,
  Field,
  Input,
  Modal,
  PageHeader,
} from "../../components/ui";
import {
  downloadFile,
  getAttachmentUrl,
  jsonRequest,
  request,
} from "../../lib/api";
import { useWorkspace } from "../../lib/workspace";
import type { LegacyMappingReport } from "../../../shared/simplification";
import "./settings.css";

interface DeviceDraft {
  id: string;
  recordId: string;
  method: string;
  input?: Record<string, unknown>;
  patch?: Record<string, unknown>;
}
interface ArchiveInventory {
  records: WorkRecord[];
  attachments: Attachment[];
  goals?: unknown[];
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
    restore,
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
  const profileTouched = useRef(false);
  const [busy, setBusy] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [drafts, setDrafts] = useState<DeviceDraft[]>([]);
  const [backup, setBackup] = useState<Record<string, unknown> | null>(null);
  const [backupName, setBackupName] = useState("");
  const [inventory, setInventory] = useState<ArchiveInventory | null>(null);
  const [inventoryError, setInventoryError] = useState("");
  const [migration, setMigration] = useState<LegacyMappingReport | null>(null);
  const [migrationSelection, setMigrationSelection] = useState<string[]>([]);
  const [connections, setConnections] = useState<ConnectorConnection[]>([]);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [confirmText, setConfirmText] = useState("");
  const legacy = new URLSearchParams(location.search).get("legacy");
  const requestedId = new URLSearchParams(location.search).get("record");
  const requestedRecord =
    inventory?.records.find((record) => record.id === requestedId) ||
    records.find((record) => record.id === requestedId);

  useEffect(() => {
    setForm({ ...preferences });
    setUsername(leetCodeHandle(preferences.leetcode));
  }, [preferences]);
  useEffect(() => {
    if (!user) return;
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
    let active = true;
    void request<ConnectorsResponse>("/api/connectors")
      .then((response) => {
        if (active)
          setConnections(
            response.connections.filter(
              (connection) => connection.status !== "disconnected",
            ),
          );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [mode]);
  useEffect(() => {
    if (preferences.leetcode || profileTouched.current) return;
    const connection = connections.find((item) => item.provider === "leetcode");
    if (connection)
      setUsername(
        leetCodeHandle(connection.config.username || connection.label),
      );
  }, [connections, preferences.leetcode]);
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
      if (handle && !/^[A-Za-z0-9_-]{1,30}$/.test(handle))
        throw new Error("Enter a valid LeetCode username or profile URL.");
      await savePreferences({
        timezone: form.timezone.trim(),
        reducedMotion: form.reducedMotion,
        leetcode: handle
          ? `https://leetcode.com/u/${encodeURIComponent(handle)}/`
          : "",
      });
      if (
        !handle &&
        connections.some((connection) => connection.provider === "leetcode")
      ) {
        await request(
          "/api/connectors/leetcode",
          jsonRequest("DELETE", { retention: "keep" }),
        );
        setConnections((rows) =>
          rows.filter((row) => row.provider !== "leetcode"),
        );
      }
      setSaveStatus("Saved");
    });
  const exportBackup = (metadataOnly = false) =>
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
          ? "Metadata downloaded. File contents are not included."
          : "Backup downloaded.",
      );
    });
  const readBackup = (file?: File) =>
    run("backup-preview", async () => {
      if (!file) return;
      if (file.size > 30 * 1024 * 1024)
        throw new Error("Select a backup smaller than 30 MB.");
      const value: unknown = JSON.parse(await file.text());
      if (
        !value ||
        typeof value !== "object" ||
        !("format" in value) ||
        value.format !== "work-export" ||
        !("version" in value) ||
        ![1, 2].includes(Number(value.version)) ||
        !("records" in value) ||
        !Array.isArray(value.records)
      )
        throw new Error("Choose a supported Work backup (version 1 or 2).");
      setBackup(value as Record<string, unknown>);
      setBackupName(file.name);
    });
  const loadInventory = async () => {
    setInventoryError("");
    try {
      setInventory(await request<ArchiveInventory>("/api/export?files=false"));
    } catch (error) {
      setInventoryError(
        error instanceof Error ? error.message : "Could not load saved data.",
      );
    }
  };
  const loadMigration = async () => {
    try {
      setMigration(await request<LegacyMappingReport>("/api/goals/legacy"));
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Could not load the migration report.",
        "error",
      );
    }
  };
  const migrateProjects = async () => {
    if (!migrationSelection.length || !migration) return;
    await run("migrate-projects", async () => {
      const selected = migration.entries
        .filter(
          (entry) =>
            migrationSelection.includes(entry.record.id) && entry.goalInput,
        )
        .map((entry) => ({
          recordId: entry.record.id,
          version: entry.record.version,
        }));
      if (!selected.length) return;
      const result = await request<{
        report: LegacyMappingReport;
        created: number;
      }>("/api/goals/legacy", jsonRequest("POST", { selected }));
      setMigration(result.report);
      setMigrationSelection([]);
      await refresh();
      notify(
        `Moved ${result.created} project${result.created === 1 ? "" : "s"} into goals.`,
      );
    });
  };
  const restoreBackup = async () => {
    if (!backup) return;
    const result = await request<{
      restored: number;
      attachments: number;
      warnings: string[];
    }>("/api/restore", jsonRequest("POST", backup));
    notify(
      `Restored ${result.restored} records and ${result.attachments} files.`,
    );
    result.warnings.forEach((warning) => notify(warning, "info"));
    setBackup(null);
    await refresh();
    if (inventory) await loadInventory();
  };
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
      `work-device-drafts-${localDate(new Date(), preferences.timezone)}.json`,
      "application/json",
    );
  const confirm = (value: Confirmation) => {
    setConfirmText("");
    setConfirmation(value);
  };
  const recordCounts = inventory?.records.reduce<Record<string, number>>(
    (counts, record) => {
      counts[KIND_LABELS[record.kind]] =
        (counts[KIND_LABELS[record.kind]] || 0) + 1;
      return counts;
    },
    {},
  );
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
      {pending > 0 && (
        <Card id="device-drafts" className="stack">
          <h2>
            Unsynced changes <span className="settings-count">{pending}</span>
          </h2>
          <p className="muted">
            These changes are stored on this device. Download them before
            clearing browser data or leaving your account.
          </p>
          <div className="inline-actions">
            <Button
              disabled={!!busy}
              onClick={() => void run("sync", syncOutbox)}
            >
              <RotateCcw size={16} />
              Retry sync
            </Button>
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
            <Field
              label="LeetCode username"
              hint="Learn uses your public solve history."
            >
              <Input
                value={username}
                autoComplete="off"
                maxLength={200}
                onChange={(event) => {
                  profileTouched.current = true;
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
          <div className="settings-destinations">
            <Link to="/learn">Learn</Link>
            <Link to="/documents">Overleaf documents</Link>
          </div>
        </Card>
        <Card className="stack" id="recovery">
          <h2>Backup & recovery</h2>
          <p className="muted">
            Backups include records, revisions, goals, settings, and saved
            files, including retired sections.
          </p>
          <Button disabled={!!busy} onClick={() => void exportBackup()}>
            <Download size={16} />
            {busy === "export" ? "Downloading…" : "Download full backup"}
          </Button>
          <label
            className={`button button-secondary file-input-label ${busy ? "backup-input-disabled" : ""}`}
          >
            <Upload size={16} />
            Choose a backup to restore
            <input
              type="file"
              disabled={!!busy}
              accept=".json,application/json"
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
                  {(backup.records as unknown[]).length} records
                  {Array.isArray(backup.goals)
                    ? ` · ${backup.goals.length} goals`
                    : ""}
                </span>
              </p>
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
          <details
            className="settings-recovery-details"
            onToggle={(event) => {
              if (event.currentTarget.open && !inventory) void loadInventory();
            }}
          >
            <summary>Saved records and files</summary>
            <div className="stack">
              <p className="field-hint">
                Full backups embed up to 20 MB of files. For larger collections,
                download metadata and the original files below.
              </p>
              <Button
                variant="secondary"
                disabled={!!busy}
                onClick={() => void exportBackup(true)}
              >
                <Download size={16} />
                Download metadata
              </Button>
              {inventoryError && (
                <div className="notice notice-warning">
                  {inventoryError}
                  <Button variant="ghost" onClick={() => void loadInventory()}>
                    Retry
                  </Button>
                </div>
              )}
              {inventory ? (
                <>
                  <p className="settings-record-summary">
                    {Object.entries(recordCounts || {})
                      .map(
                        ([kind, count]) =>
                          `${count} ${kind.toLowerCase()}${count === 1 ? "" : "s"}`,
                      )
                      .join(" · ") || "No saved records"}
                    {inventory.goals?.length
                      ? ` · ${inventory.goals.length} goals`
                      : ""}
                  </p>
                  {inventory.attachments.length > 0 && (
                    <div className="settings-file-list">
                      {inventory.attachments.map((attachment) => (
                        <div key={attachment.id}>
                          <span>
                            <strong>{attachment.filename}</strong>
                            <small>
                              {
                                inventory.records.find(
                                  (record) => record.id === attachment.recordId,
                                )?.title
                              }{" "}
                              · {(attachment.size / 1024).toFixed(0)} KB
                            </small>
                          </span>
                          <Button
                            variant="ghost"
                            disabled={!!busy}
                            onClick={() =>
                              void run("download-file", async () => {
                                const url = await getAttachmentUrl(
                                  attachment.id,
                                );
                                const anchor = document.createElement("a");
                                anchor.href = url;
                                anchor.download = attachment.filename;
                                document.body.appendChild(anchor);
                                anchor.click();
                                anchor.remove();
                              })
                            }
                          >
                            <Download size={16} />
                            <span className="sr-only">
                              Download {attachment.filename}
                            </span>
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  {inventory.records.some((record) => record.deletedAt) && (
                    <div className="stack settings-trash">
                      <h3>Deleted records</h3>
                      {inventory.records
                        .filter((record) => record.deletedAt)
                        .map((record) => (
                          <div className="settings-data-row" key={record.id}>
                            <div>
                              <strong>{record.title}</strong>
                              <p>{KIND_LABELS[record.kind]}</p>
                            </div>
                            <Button
                              variant="secondary"
                              disabled={!!busy}
                              onClick={() =>
                                void run("trash-restore", async () => {
                                  await restore(record.id);
                                  await loadInventory();
                                  notify("Record restored.");
                                })
                              }
                            >
                              <RotateCcw size={14} />
                              Restore
                            </Button>
                          </div>
                        ))}
                    </div>
                  )}
                </>
              ) : (
                !inventoryError && (
                  <p role="status" className="muted">
                    Loading saved data…
                  </p>
                )
              )}
              <details
                onToggle={(event) => {
                  if (event.currentTarget.open && !migration)
                    void loadMigration();
                }}
              >
                <summary>Dated project milestones</summary>
                <div className="stack">
                  <p className="field-hint">
                    Review exact milestones from retired project records and
                    choose which ones to copy into the Home timeline. Originals
                    stay unchanged.
                  </p>
                  {migration ? (
                    <>
                      {migration.entries
                        .filter(
                          (entry) =>
                            entry.disposition === "candidate" &&
                            entry.goalInput,
                        )
                        .map((entry) => (
                          <label
                            className="settings-data-row"
                            key={entry.record.id}
                          >
                            <span>
                              <input
                                type="checkbox"
                                checked={migrationSelection.includes(
                                  entry.record.id,
                                )}
                                onChange={(event) =>
                                  setMigrationSelection((current) =>
                                    event.target.checked
                                      ? [...current, entry.record.id]
                                      : current.filter(
                                          (id) => id !== entry.record.id,
                                        ),
                                  )
                                }
                              />
                              <strong>{entry.record.title}</strong>
                              <small>
                                {entry.goalInput!.milestones.length} dated
                                milestone
                                {entry.goalInput!.milestones.length === 1
                                  ? ""
                                  : "s"}
                              </small>
                            </span>
                          </label>
                        ))}
                      {!migration.entries.some(
                        (entry) => entry.disposition === "candidate",
                      ) && (
                        <p className="muted">
                          No unconverted project with exact dated milestones was
                          found.
                        </p>
                      )}
                      <Button
                        disabled={!!busy || !migrationSelection.length}
                        onClick={() => void migrateProjects()}
                      >
                        Move selected milestones to goals
                      </Button>
                    </>
                  ) : (
                    <p className="muted">Loading migration report…</p>
                  )}
                </div>
              </details>
            </div>
          </details>
        </Card>
      </div>
      {connections.length > 0 && (
        <details className="settings-existing-connections">
          <summary>Existing connections</summary>
          <Card className="stack">
            <p className="muted">
              Remove saved connections you no longer use. Imported records and
              files remain recoverable.
            </p>
            {connections.map((connection) => (
              <div className="settings-data-row" key={connection.id}>
                <div>
                  <strong>{connectorName(connection.provider)}</strong>
                  <p>{connection.label}</p>
                </div>
                <Button
                  variant="secondary"
                  disabled={!!busy}
                  onClick={() =>
                    confirm({
                      title: `Remove ${connectorName(connection.provider)} connection?`,
                      description:
                        "This removes its saved access credentials. Existing imported records and files are kept.",
                      action: async () => {
                        const result = await request<{ warning?: string }>(
                          `/api/connectors/${connection.provider}`,
                          jsonRequest("DELETE", { retention: "keep" }),
                        );
                        if (result.warning) notify(result.warning, "info");
                        if (
                          connection.provider === "leetcode" &&
                          !preferences.leetcode
                        ) {
                          profileTouched.current = true;
                          setUsername("");
                        }
                        setConnections((rows) =>
                          rows.filter((row) => row.id !== connection.id),
                        );
                      },
                    })
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
          </Card>
        </details>
      )}
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
