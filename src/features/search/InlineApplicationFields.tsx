import { NoteInput } from "../content/NoteInput";
import { useRef, useState } from "react";
import { field, localDate, type WorkRecord } from "../../../shared/model";
import {
  ApplicationDataSchema,
  applicationDate,
  applicationStatusLabel,
  applicationStatusOptions,
  applicationStatusSelection,
  selectApplicationStatus,
} from "../../../shared/applications";
import { Button, Field, Input, Select } from "../../components/ui";
import { useWorkspace } from "../../lib/workspace";
import { useAutosave } from "../../lib/autosave";
import { applicationCompany } from "./applicationRecords";

export function InlineApplicationFields({ record }: { record: WorkRecord }) {
  const { records, preferences, user, update, isPending, refresh } =
    useWorkspace();
  const current = useRef(record);
  current.current = record;
  const [statusError, setStatusError] = useState("");
  const initial = {
    title: record.title,
    company: applicationCompany(record, records),
    url: field(record, "url"),
    location: field(record, "location"),
    applicationDate: applicationDate(record),
    deadline: field(record, "deadline"),
    followUp: field(record, "followUp"),
    body: record.body,
  };
  const draft = useAutosave({
    initial,
    version: record.version,
    storageKey: `work:application-draft:${user?.id || "local"}:${record.id}`,
    refresh,
    persist: async (value, expectedVersion) => {
      const { title, body, ...fields } = value;
      const data = ApplicationDataSchema.parse({
        ...current.current.data,
        ...fields,
      });
      const saved = await update(
        record.id,
        { title: title.trim() || "Untitled", body, data },
        expectedVersion,
      );
      current.current = saved;
      return {
        version: saved.version,
        value: {
          title: saved.title,
          company: applicationCompany(saved, records),
          url: field(saved, "url"),
          location: field(saved, "location"),
          applicationDate: applicationDate(saved),
          deadline: field(saved, "deadline"),
          followUp: field(saved, "followUp"),
          body: saved.body,
        },
        offline: isPending(record.id),
      };
    },
    pending: isPending(record.id),
  });
  const selection = applicationStatusSelection(record);
  const options = applicationStatusOptions(record);
  async function setStatus(value: string) {
    try {
      setStatusError("");
      const saved = await update(
        record.id,
        {
          data: selectApplicationStatus(
            current.current,
            value,
            localDate(new Date(), preferences.timezone),
          ),
        },
        current.current.version,
      );
      current.current = saved;
    } catch (failure) {
      setStatusError(
        failure instanceof Error ? failure.message : "Could not change status.",
      );
    }
  }
  return (
    <div className="stack application-inline-fields">
      {draft.conflict && (
        <div className="application-notice" role="alert">
          <span>{draft.error || "This application changed elsewhere."}</span>
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
        aria-label="Role"
        value={draft.value.title === "Untitled" ? "" : draft.value.title}
        placeholder="Role"
        onChange={(event) =>
          draft.setValue({ ...draft.value, title: event.target.value })
        }
        onBlur={draft.flush}
      />
      <Field label="Status">
        <Select
          value={selection}
          onChange={(event) => void setStatus(event.target.value)}
        >
          {!options.some((option) => option.value === selection) && (
            <option value={selection} disabled>
              {applicationStatusLabel(record)}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="form-grid">
        {(
          [
            ["company", "Company"],
            ["url", "Listing link"],
            ["location", "Location"],
            ["applicationDate", "Application date"],
            ["deadline", "Deadline"],
            ["followUp", "Follow-up"],
          ] as const
        ).map(([key, label]) => (
          <Field label={label} key={key}>
            <Input
              type={
                ["applicationDate", "deadline", "followUp"].includes(key)
                  ? "date"
                  : "text"
              }
              value={draft.value[key]}
              onChange={(event) =>
                draft.setValue({ ...draft.value, [key]: event.target.value })
              }
              onBlur={draft.flush}
            />
          </Field>
        ))}
      </div>
      <NoteInput
        aria-label="Application notes"
        placeholder="Notes"
        value={draft.value.body}
        rows={5}
        onChange={(event) =>
          draft.setValue({ ...draft.value, body: event.target.value })
        }
        onBlur={draft.flush}
      />
      <small className="muted" role="status">
        {draft.state}
      </small>
      {(draft.error || statusError) && (
        <p className="form-error" role="alert">
          {draft.error || statusError}
          <Button variant="ghost" onClick={draft.flush}>
            Retry
          </Button>
        </p>
      )}
    </div>
  );
}
