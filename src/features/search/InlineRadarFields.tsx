import { useRef } from "react";
import { field, type WorkRecord } from "../../../shared/model";
import { RadarCompanyDataSchema } from "../../../shared/applications";
import { Button, Input, Textarea } from "../../components/ui";
import { useWorkspace } from "../../lib/workspace";
import { useAutosave } from "../../lib/autosave";
import { normalizeWebUrl } from "../../../shared/urls";

export function radarNotes(record: WorkRecord) {
  return [
    record.body,
    field(record, "reason"),
    field(record, "website") ? `Website: ${field(record, "website")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
export function InlineRadarFields({ record }: { record: WorkRecord }) {
  const { user, update, isPending, refresh } = useWorkspace();
  const current = useRef(record);
  current.current = record;
  const initial = {
    title: record.title === "Untitled" ? "" : record.title,
    careersUrl: field(record, "careersUrl"),
    location: field(record, "location"),
    body: record.data.radarNotesMigrated ? record.body : radarNotes(record),
  };
  const draft = useAutosave({
    initial,
    version: record.version,
    storageKey: `work:radar-draft:${user?.id || "local"}:${record.id}`,
    refresh,
    persist: async (value, expectedVersion) => {
      const data = RadarCompanyDataSchema.parse({
        ...current.current.data,
        careersUrl: value.careersUrl,
        location: value.location,
        radarNotesMigrated: true,
      });
      const saved = await update(
        record.id,
        { title: value.title.trim() || "Untitled", body: value.body, data },
        expectedVersion,
      );
      current.current = saved;
      return {
        version: saved.version,
        value: {
          title: saved.title === "Untitled" ? "" : saved.title,
          careersUrl: field(saved, "careersUrl"),
          location: field(saved, "location"),
          body: saved.body,
        },
        offline: isPending(record.id),
      };
    },
    pending: isPending(record.id),
  });
  return (
    <div className="stack radar-inline-fields">
      {draft.conflict && (
        <div className="application-notice" role="alert">
          <span>{draft.error || "This company changed elsewhere."}</span>
          <Button variant="secondary" onClick={() => void draft.keepLocal()}>
            Keep my changes
          </Button>
          <Button variant="ghost" onClick={draft.useSaved}>
            Use saved version
          </Button>
        </div>
      )}
      <Input
        className="application-inline-title"
        aria-label="Company"
        autoFocus={record.title === "Untitled"}
        value={draft.value.title}
        placeholder="Company"
        onChange={(event) =>
          draft.setValue({ ...draft.value, title: event.target.value })
        }
        onBlur={draft.flush}
      />
      <Input
        aria-label="Careers page"
        placeholder="Careers page"
        value={draft.value.careersUrl}
        onChange={(event) =>
          draft.setValue({ ...draft.value, careersUrl: event.target.value })
        }
        onBlur={() => {
          draft.setValue({
            ...draft.value,
            careersUrl: normalizeWebUrl(draft.value.careersUrl),
          });
          draft.flush();
        }}
      />
      <Input
        aria-label="Location"
        placeholder="Location (optional)"
        value={draft.value.location}
        onChange={(event) =>
          draft.setValue({ ...draft.value, location: event.target.value })
        }
        onBlur={draft.flush}
      />
      <Textarea
        aria-label="Company notes"
        placeholder="Notes"
        value={draft.value.body}
        rows={4}
        onChange={(event) =>
          draft.setValue({ ...draft.value, body: event.target.value })
        }
        onBlur={draft.flush}
      />
      <small className="muted" role="status">
        {draft.state}
      </small>
      {draft.error && (
        <p className="form-error" role="alert">
          {draft.error}
          <Button variant="ghost" onClick={draft.flush}>
            Retry
          </Button>
        </p>
      )}
    </div>
  );
}
