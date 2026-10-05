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
import { Button, Field, Input, Select, Textarea } from "../../components/ui";
import { useWorkspace } from "../../lib/workspace";
import { useInlineAutosave } from "../direction/useInlineAutosave";
import { applicationCompany } from "./applicationRecords";

export function InlineApplicationFields({ record }: { record: WorkRecord }) {
  const { records, preferences, user, update } = useWorkspace();
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
  const draft = useInlineAutosave(
    initial,
    `work:application-draft:${user?.id || "local"}:${record.id}`,
    async (value) => {
      const { title, body, ...fields } = value;
      const data = ApplicationDataSchema.parse({
        ...current.current.data,
        ...fields,
      });
      const saved = await update(
        record.id,
        { title: title.trim() || "Untitled", body, data },
        current.current.version,
      );
      current.current = saved;
    },
  );
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
      {draft.recovered && (
        <div className="application-notice">
          <p>An unsaved application draft is available on this device.</p>
          <Button variant="secondary" onClick={draft.acceptDraft}>
            Recover draft
          </Button>
          <Button variant="ghost" onClick={draft.discardDraft}>
            Use saved fields
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
              {record.data.processVersion !== 2 || record.data.legacyStatusLabel
                ? " · historical"
                : ""}
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
      <Textarea
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
