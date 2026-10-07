import { useState } from "react";
import { Download, Upload, LogOut } from "lucide-react";
import {
  Button,
  Card,
  Field,
  Input,
  Modal,
  PageHeader,
} from "../../components/ui";
import { request, jsonRequest } from "../../lib/api";
import { useWorkspace } from "../../lib/workspace";
import { useAutosave, flushAutosaves } from "../../lib/autosave";
import {
  downloadWorkspace,
  readWorkspacePackage,
  uploadWorkspacePackage,
  type WorkspaceUploadPackage,
} from "../../lib/workspace-transfer";
import { clearWorkspaceDeviceStorage } from "../../lib/device-storage";
import { learningUsername } from "../../../shared/learning";
import "./settings.css";
export function SettingsPage() {
  const workspace = useWorkspace();
  const { preferences, user, mode, pending, syncIssues } = workspace;
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [pkg, setPackage] = useState<WorkspaceUploadPackage>(),
    [confirm, setConfirm] = useState(""),
    [deleteAccount, setDeleteAccount] = useState(false);
  const draft = useAutosave({
    initial: preferences,
    storageKey: `work:preferences-draft:${user?.id ?? ""}:settings`,
    validate: (value) => {
      if (value.leetcode.trim() && !learningUsername(value.leetcode))
        return "Enter a valid LeetCode username.";
      try {
        new Intl.DateTimeFormat("en", { timeZone: value.timezone });
      } catch {
        return "Choose a valid timezone.";
      }
      return null;
    },
    persist: async (value) => ({
      value: await workspace.savePreferences(value),
    }),
  });
  const run = async (action: () => Promise<void>) => {
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not complete this action.",
      );
    } finally {
      setBusy("");
    }
  };
  const finishSaving = async () => {
    if (!(await flushAutosaves()))
      throw new Error(
        "Finish saving current edits before exporting or uploading.",
      );
    if (draft.error || draft.conflict)
      throw new Error("Finish saving your current edits first.");
    await workspace.syncOutbox();
    if (pending || syncIssues.length)
      throw new Error(
        "Wait for pending edits to sync before exporting or uploading.",
      );
  };
  return (
    <div className="page-stack simple-settings">
      <PageHeader title="Settings" />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <Card className="stack settings-preferences">
        <h2>Your preferences</h2>
        <Field label="Display name">
          <Input
            value={draft.value.displayName}
            onChange={(event) =>
              draft.setValue((value) => ({
                ...value,
                displayName: event.target.value,
              }))
            }
          />
        </Field>
        <Field label="Timezone">
          <Input
            value={draft.value.timezone}
            onChange={(event) =>
              draft.setValue((value) => ({
                ...value,
                timezone: event.target.value,
              }))
            }
          />
        </Field>
        <Field label="LeetCode username">
          <Input
            value={draft.value.leetcode}
            placeholder="username"
            onChange={(event) =>
              draft.setValue((value) => ({
                ...value,
                leetcode: event.target.value,
              }))
            }
          />
        </Field>
        <Field label="Appearance">
          <div
            className="appearance-switch"
            data-mode={draft.value.theme}
            role="group"
            aria-label="Appearance mode"
          >
            {(["light", "dark"] as const).map((theme) => (
              <button
                key={theme}
                type="button"
                className="appearance-switch-option"
                aria-pressed={draft.value.theme === theme}
                onClick={() => draft.setValue((value) => ({ ...value, theme }))}
              >
                {theme === "light" ? "Light" : "Dark"}
              </button>
            ))}
          </div>
        </Field>
        <p className="muted settings-save-status" role="status">
          {draft.error || draft.state}
        </p>
        {draft.conflict && (
          <div className="settings-preference-conflict">
            <Button onClick={() => void draft.keepLocal()}>
              Keep my changes
            </Button>
            <Button onClick={draft.useSaved}>Use saved preferences</Button>
          </div>
        )}
      </Card>
      <Card className="stack settings-workspace">
        <h2>Workspace export and upload</h2>
        <p>
          Export your current workspace, including documents and files.
          Uploading an export replaces this workspace.
        </p>
        <div className="inline-actions">
          <Button
            disabled={!!busy || mode === "demo"}
            onClick={() => {
              setBusy("Exporting…");
              void run(async () => {
                await finishSaving();
                await downloadWorkspace();
              });
            }}
          >
            <Download size={16} />
            Export workspace
          </Button>
          <label className="button button-secondary workspace-file-picker">
            <Upload size={16} />
            Choose workspace export
            <Input
              type="file"
              accept=".tar"
              disabled={!!busy || mode === "demo"}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) {
                  setBusy("Checking export…");
                  void run(async () =>
                    setPackage(await readWorkspacePackage(file)),
                  );
                }
              }}
            />
          </label>
        </div>
        {busy && <p role="status">{busy}</p>}
        {mode === "demo" && (
          <p className="muted">
            Export and upload are available in your signed-in workspace.
          </p>
        )}
      </Card>
      {pending > 0 && (
        <Card className="settings-sync-status">
          <p>{pending} changes waiting to sync.</p>
          <Button onClick={() => void run(() => workspace.syncOutbox())}>
            Retry saving
          </Button>
        </Card>
      )}
      {syncIssues.length > 0 && (
        <Card className="stack settings-sync-issues">
          <h2>Edits needing attention</h2>
          {syncIssues.map((issue) => (
            <div key={issue.id}>
              <p>{issue.message}</p>
              <Button
                onClick={() => void run(() => workspace.discardDraft(issue.id))}
              >
                Discard pending edit
              </Button>
            </div>
          ))}
        </Card>
      )}
      <Card className="stack settings-account">
        <h2>Account</h2>
        <p>{user?.name}</p>
        <div className="settings-account-actions">
          <Button
            variant="secondary"
            onClick={() => void run(() => workspace.signOut())}
          >
            <LogOut size={16} />
            Sign out
          </Button>
          <Button variant="danger" onClick={() => setDeleteAccount(true)}>
            Delete account
          </Button>
        </div>
      </Card>
      <Modal
        open={!!pkg}
        onClose={() => {
          if (!busy) setPackage(undefined);
        }}
        title="Replace workspace"
        description="This permanently deletes the current workspace and its files."
      >
        {pkg && (
          <>
            <p>
              The export contains {pkg.manifest.records.length} records,{" "}
              {pkg.manifest.goals.length} goals, and{" "}
              {pkg.manifest.attachments.length} files.
            </p>
            <Button
              variant="danger"
              disabled={!!busy}
              onClick={() => {
                setBusy("Preparing upload…");
                void run(async () => {
                  await finishSaving();
                  await uploadWorkspacePackage(pkg, (count, total) =>
                    setBusy(`Uploading files ${count}/${total}…`),
                  );
                  window.location.assign("/");
                });
              }}
            >
              Replace workspace
            </Button>
          </>
        )}
      </Modal>
      <Modal
        open={deleteAccount}
        onClose={() => setDeleteAccount(false)}
        title="Delete account"
        description="Permanently deletes your workspace, files, settings, and sessions."
      >
        <Field label="Type DELETE MY WORKSPACE">
          <Input
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </Field>
        <Button
          variant="danger"
          disabled={!!busy || confirm !== "DELETE MY WORKSPACE"}
          onClick={() => {
            setBusy("Deleting…");
            void run(async () => {
              await request(
                "/api/account/delete",
                jsonRequest("POST", { confirmation: confirm }),
              );
              clearWorkspaceDeviceStorage();
              window.location.assign("/");
            });
          }}
        >
          Delete account
        </Button>
      </Modal>
    </div>
  );
}
