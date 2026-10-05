import { useRef } from "react";
import { field, type WorkRecord } from "../../../shared/model";
import { RadarCompanyDataSchema } from "../../../shared/applications";
import { Button, Input, Textarea } from "../../components/ui";
import { useWorkspace } from "../../lib/workspace";
import { useInlineAutosave } from "../direction/useInlineAutosave";
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
  const { user, update } = useWorkspace();
  const current = useRef(record);
  current.current = record;
  const initial = {
    title: record.title === "Untitled" ? "" : record.title,
    careersUrl: field(record, "careersUrl"),
    location: field(record, "location"),
    body: record.data.radarNotesMigrated ? record.body : radarNotes(record),
  };
  const draft = useInlineAutosave(
    initial,
    `work:radar-draft:${user?.id || "local"}:${record.id}`,
    async (value) => {
      const data = RadarCompanyDataSchema.parse({
        ...current.current.data,
        careersUrl: value.careersUrl,
        location: value.location,
        radarNotesMigrated: true,
      });
      const saved = await update(
        record.id,
        { title: value.title.trim() || "Untitled", body: value.body, data },
        current.current.version,
      );
      current.current = saved;
    },
  );
  return (
    <div className="stack radar-inline-fields">
      {draft.recovered && (
        <div className="application-notice">
          <span>Recover unsaved company notes?</span>
          <Button variant="secondary" onClick={draft.acceptDraft}>
            Recover
          </Button>
          <Button variant="ghost" onClick={draft.discardDraft}>
            Use saved
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
