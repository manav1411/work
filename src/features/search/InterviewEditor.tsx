import { useState, type FormEvent } from "react";
import { field, type WorkRecord } from "../../../shared/model";
import {
  Button,
  Field,
  Input,
  Markdown,
  Modal,
  Select,
} from "../../components/ui";
import {
  InterviewAppointmentDataSchema,
  recruitmentSteps,
} from "../../../shared/applications";
import { isoToZonedInput, zonedDateTimeToISO } from "../prepare/helpers";
import { errorMessage } from "./domain";
import { useSavingWorkspace as useWorkspace } from "./useSaving";
import { applicationCompany, interviewTime } from "./applicationRecords";
import { CompanyGlyph } from "../../components/CompanyGlyph";
import { useEditMode } from "../../lib/edit-mode";
import "./applications.css";
export { associatedInterviews, interviewTime } from "./applicationRecords";

interface InterviewEditorProps {
  record?: WorkRecord;
  applicationId?: string;
  stepId?: string;
  open: boolean;
  onClose: () => void;
  onRemoved?: (record: WorkRecord) => void;
}

/** Appointment editor opened from Applications and Home. */
export function InterviewEditor(props: InterviewEditorProps) {
  const { editing } = useEditMode();
  const { records, preferences } = useWorkspace();
  const application = records.find(
    (record) =>
      record.id ===
      (props.applicationId || field(props.record, "applicationId")),
  );
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={props.record?.title || "Schedule"}
    >
      {editing ? (
        <InterviewForm {...props} />
      ) : props.record ? (
        <div className="stack">
          {application && (
            <strong>
              <CompanyGlyph name={applicationCompany(application, records)} />
              {applicationCompany(application, records)}
            </strong>
          )}
          <p>{interviewTime(props.record, preferences.timezone)}</p>
          {props.record.body && <Markdown content={props.record.body} />}
        </div>
      ) : (
        <p className="muted">Hold Applications to enable editing.</p>
      )}
    </Modal>
  );
}

export function InterviewForm({
  record,
  applicationId,
  stepId,
  onClose,
  onRemoved,
}: InterviewEditorProps) {
  const { records, preferences, create, update, remove, pending } =
    useWorkspace();
  const application = records.find(
    (item) =>
      item.kind === "application" &&
      item.id === (applicationId || field(record, "applicationId")),
  );
  const steps = application
    ? recruitmentSteps(application.data).filter(
        (step) => !["submission", "offer"].includes(step.kind),
      )
    : [];
  const [title, setTitle] = useState(record?.title || "");
  const [selectedStep, setSelectedStep] = useState(
    stepId || field(record, "stepId") || steps[0]?.id || "",
  );
  const [time, setTime] = useState(
    isoToZonedInput(field(record, "startsAt"), preferences.timezone),
  );
  const [error, setError] = useState("");
  const [ambiguous, setAmbiguous] = useState(false);
  const [occurrence, setOccurrence] = useState<"earlier" | "later" | "">("");
  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      if (!application)
        throw new Error("Choose an application before scheduling.");
      if (!steps.some((step) => step.id === selectedStep))
        throw new Error(
          "Choose an existing step. Add a process step first if needed.",
        );
      if (!title.trim()) throw new Error("Give this appointment a title.");
      const startsAt =
        record &&
        time ===
          isoToZonedInput(field(record, "startsAt"), preferences.timezone)
          ? field(record, "startsAt")
          : zonedDateTimeToISO(
              time,
              preferences.timezone,
              occurrence || undefined,
            );
      const data = InterviewAppointmentDataSchema.parse({
        ...record?.data,
        appointmentVersion: 2,
        applicationId: application.id,
        stepId: selectedStep,
        startsAt,
        timezone: preferences.timezone,
        status: field(record, "status", "Scheduled"),
      });
      const input = {
        title: title.trim(),
        links: [...new Set([...(record?.links || []), application.id])],
        data,
      };
      if (record) await update(record.id, input);
      else await create({ kind: "interview", ...input });
      onClose();
    } catch (failure) {
      const message = errorMessage(failure);
      setError(message);
      if (message.includes("occurs twice")) setAmbiguous(true);
    }
  }
  if (!steps.length)
    return (
      <div className="application-notice">
        <p>
          Add an assessment or interview step to the process before scheduling.
        </p>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  return (
    <form
      className="stack application-schedule-form"
      onSubmit={(event) => void save(event)}
    >
      <Field label="Step">
        <Select
          required
          value={selectedStep}
          onChange={(event) => setSelectedStep(event.target.value)}
        >
          <option value="" disabled>
            Choose a step
          </option>
          {steps.map((step) => (
            <option key={step.id} value={step.id}>
              {step.title}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Title">
        <Input
          autoFocus
          required
          value={title}
          maxLength={240}
          placeholder="Interview with the platform team"
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>
      <Field label="Date and time">
        <Input
          type="datetime-local"
          required
          value={time}
          onChange={(event) => {
            setTime(event.target.value);
            setAmbiguous(false);
            setOccurrence("");
          }}
        />
      </Field>
      {ambiguous && (
        <Field label="Daylight-saving occurrence">
          <Select
            required
            value={occurrence}
            onChange={(event) =>
              setOccurrence(event.target.value as "earlier" | "later")
            }
          >
            <option value="" disabled>
              Choose which occurrence
            </option>
            <option value="earlier">Earlier occurrence</option>
            <option value="later">Later occurrence</option>
          </Select>
        </Field>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="inline-actions">
        <Button type="submit" disabled={!!pending}>
          {pending ? "Saving…" : "Schedule"}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        {record && (
          <Button
            type="button"
            variant="danger"
            disabled={!!pending}
            onClick={() => {
              if (window.confirm("Delete this appointment?"))
                void remove(record.id)
                  .then(() => {
                    onRemoved?.(record);
                    onClose();
                  })
                  .catch((failure) => setError(errorMessage(failure)));
            }}
          >
            Delete
          </Button>
        )}
      </div>
    </form>
  );
}
