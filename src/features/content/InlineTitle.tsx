import { useAutosave } from "../../lib/autosave";
import { useEditMode } from "../../lib/edit-mode";
import { useWorkspace } from "../../lib/workspace";

export function InlineTitle({
  value,
  onSave,
  draftKey,
  version,
  label = "Name",
  autoFocus = false,
}: {
  value: string;
  onSave: (title: string, expectedVersion?: number) => Promise<unknown>;
  draftKey: string;
  version?: number;
  label?: string;
  autoFocus?: boolean;
}) {
  const { editing } = useEditMode();
  const { user, refresh, isPending } = useWorkspace();
  const normalize = (title: string) => (title === "Untitled" ? "" : title);
  const save = useAutosave({
    initial: normalize(value),
    version,
    storageKey: `work:title-draft:${user?.id || "anonymous"}:${draftKey}`,
    refresh,
    persist: async (text, expectedVersion) => {
      const title = text.trim() || "Untitled";
      const result = await onSave(title, expectedVersion);
      const record =
        result &&
        typeof result === "object" &&
        "id" in result &&
        "version" in result
          ? (result as { id: string; version: number })
          : undefined;
      return {
        value: normalize(title),
        version: record?.version,
        offline: record ? isPending(record.id) : false,
      };
    },
  });
  return (
    <>
      {editing ? (
        <input
          className="inline-title"
          aria-label={label}
          placeholder="Untitled"
          maxLength={200}
          autoFocus={autoFocus}
          value={save.value}
          onBlur={() => void save.flush()}
          onChange={(event) => save.setValue(event.target.value)}
          onClick={(event) => event.stopPropagation()}
        />
      ) : (
        save.value || "Untitled"
      )}
      {save.error && !save.conflict && <small role="alert">{save.error}</small>}
      {save.conflict && (
        <details className="autosave-conflict">
          <summary>Another session changed this name</summary>
          <p>Saved name: {save.savedValue || "Untitled"}</p>
          <button type="button" onClick={() => void save.keepLocal()}>
            Keep my name
          </button>
          <button type="button" onClick={save.useSaved}>
            Use saved name
          </button>
        </details>
      )}
    </>
  );
}
