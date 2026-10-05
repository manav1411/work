import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { field, type WorkRecord } from "../../../shared/model";
import {
  Badge,
  Button,
  Field,
  Input,
  Markdown,
  Modal,
  Select,
} from "../../components/ui";
import {
  APPOINTMENT_STATUSES,
  InterviewAppointmentDataSchema,
  recruitmentSteps,
} from "../../../shared/applications";
import { webDestination } from "../assets/documentLinks";
import { isoToZonedInput, zonedDateTimeToISO } from "../prepare/helpers";
import { errorMessage } from "./domain";
import { useSavingWorkspace as useWorkspace } from "./useSaving";
import "./applications.css";
import { applicationCompany, interviewTime } from "./applicationRecords";
import { CompanyGlyph } from "../../components/CompanyGlyph";
import { useEditMode } from "../../lib/edit-mode";
export { associatedInterviews, interviewTime } from "./applicationRecords";

interface InterviewEditorProps {
  record?: WorkRecord;
  applicationId?: string;
  stepId?: string;
  open: boolean;
  onClose: () => void;
  onRemoved?: (record: WorkRecord) => void;
}

export function InterviewEditor(props: InterviewEditorProps) {
  const { editing } = useEditMode();
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={
        props.record
          ? editing
            ? "Edit interview"
            : props.record.title
          : "Schedule interview"
      }
    >
      {props.open &&
        (editing ? (
          <InterviewForm
            key={`${props.record?.id || "new"}:${props.record?.version || 0}:${props.applicationId || ""}:${props.stepId || ""}`}
            {...props}
          />
        ) : props.record ? (
          <InterviewDetails record={props.record} />
        ) : (
          <p className="muted">
            Hold Applications for 3 seconds to enable editing.
          </p>
        ))}
    </Modal>
  );
}

function InterviewDetails({ record }: { record: WorkRecord }) {
  const { records, preferences } = useWorkspace();
  const application = records.find(
    (item) =>
      item.kind === "application" &&
      (item.id === field(record, "applicationId") ||
        record.links.includes(item.id)),
  );
  const company = application ? applicationCompany(application, records) : "";
  const step = application
    ? recruitmentSteps(application.data, true).find(
        (item) => item.id === field(record, "stepId"),
      )
    : undefined;
  return (
    <div className="stack interview-appointment-details">
      {application && (
        <p>
          <CompanyGlyph name={company} />
          <strong>{company}</strong>
          {company ? " · " : ""}
          {application.title}
        </p>
      )}
      <div className="inline-actions">
        <Badge tone="blue">{field(record, "status", "Scheduled")}</Badge>
        {step && <span>{step.title}</span>}
      </div>
      <p>{interviewTime(record, preferences.timezone)}</p>
      {field(record, "timezone") &&
        field(record, "timezone") !== preferences.timezone && (
          <p className="muted">
            Interviewer: {interviewTime(record, field(record, "timezone"))}
          </p>
        )}
      {record.body && <Markdown content={record.body} />}
      <div className="inline-actions">
        <Link
          className="text-link"
          to={`/interviews?interview=${encodeURIComponent(record.id)}`}
        >
          Prepare for interview
        </Link>
        {[
          ["Meeting", field(record, "meetingUrl")],
          ["Source", field(record, "sourceUrl")],
        ].map(([label, url]) => {
          const destination = webDestination(url);
          return destination ? (
            <a
              key={label}
              className="text-link"
              href={destination}
              target="_blank"
              rel="noopener noreferrer"
            >
              {label}
            </a>
          ) : null;
        })}
      </div>
    </div>
  );
}

function InterviewForm({
  record,
  applicationId,
  stepId,
  onClose,
  onRemoved,
}: InterviewEditorProps) {
  const { editing: editMode } = useEditMode();
  const { records, preferences, create, update, remove, pending } =
    useWorkspace();
  const applications = records.filter(
    (item) => item.kind === "application" && !item.deletedAt,
  );
  const existingApplicationId =
    field(record, "applicationId") ||
    applications.find((item) => record?.links.includes(item.id))?.id ||
    "";
  const [chosenApplicationId, setApplicationId] = useState(
    applicationId || existingApplicationId,
  );
  const [title, setTitle] = useState(record?.title || "");
  const [chosenStepId, setStepId] = useState(stepId || field(record, "stepId"));
  const [confirmDeletion, setConfirmDeletion] = useState(false);
  const [timezone, setTimezone] = useState(
    field(record, "timezone", preferences.timezone),
  );
  const [time, setTime] = useState(
    isoToZonedInput(field(record, "startsAt"), timezone),
  );
  const [meetingUrl, setMeetingUrl] = useState(field(record, "meetingUrl"));
  const [sourceUrl, setSourceUrl] = useState(field(record, "sourceUrl"));
  const [status, setStatus] = useState(field(record, "status", "Scheduled"));
  const [error, setError] = useState("");
  const datalistId = useId();
  const application = applications.find(
    (item) => item.id === chosenApplicationId,
  );
  const statuses = [...new Set([...APPOINTMENT_STATUSES, status])];
  const steps = application ? recruitmentSteps(application.data, true) : [];
  const chosenStep = steps.find((step) => step.id === chosenStepId);
  const defaultTitle = application
    ? `${application.title} — ${chosenStep?.title || "interview"}`
    : "";

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const startsAt = zonedDateTimeToISO(time, timezone);
      for (const [label, value] of [
        ["Meeting URL", meetingUrl],
        ["Source URL", sourceUrl],
      ]) {
        if (value.trim() && !webDestination(value))
          throw new Error(
            `${label} must be an http or https URL without embedded credentials.`,
          );
      }
      const savedTitle = title.trim() || defaultTitle;
      if (!savedTitle)
        throw new Error(
          "Give the appointment a name or choose an application.",
        );
      const links = [
        ...new Set([
          ...(record?.links || []).filter(
            (id) => !applications.some((item) => item.id === id),
          ),
          ...(chosenApplicationId ? [chosenApplicationId] : []),
        ]),
      ];
      const input = {
        title: savedTitle,
        links,
        data: InterviewAppointmentDataSchema.parse({
          ...record?.data,
          startsAt,
          timezone: timezone.trim(),
          applicationId: chosenApplicationId,
          stepId: chosenApplicationId ? chosenStepId : "",
          meetingUrl: webDestination(meetingUrl),
          sourceUrl: webDestination(sourceUrl),
          status,
        }),
      };
      if (record) await update(record.id, input);
      else await create({ kind: "interview", ...input });
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }

  return (
    <form className="stack" onSubmit={(event) => void save(event)}>
      {!applicationId && (
        <Field label="Application">
          <Select
            value={chosenApplicationId}
            onChange={(event) => {
              setApplicationId(event.target.value);
              setStepId("");
            }}
          >
            <option value="">Standalone appointment</option>
            {applications.map((item) => (
              <option key={item.id} value={item.id}>
                {applicationCompany(item, records)
                  ? `${applicationCompany(item, records)} — ${item.title}`
                  : item.title}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {application && (
        <Field
          label="Recruitment step"
          hint="Optional. More than one appointment can belong to a round."
        >
          <Select
            value={chosenStepId}
            onChange={(event) => setStepId(event.target.value)}
          >
            <option value="">Unassigned appointment</option>
            {steps
              .filter(
                (step) =>
                  (!step.archived &&
                    !["submission", "offer"].includes(step.kind)) ||
                  step.id === chosenStepId,
              )
              .map((step) => (
                <option key={step.id} value={step.id}>
                  {step.title}
                  {step.archived ? " · deleted step" : ""}
                </option>
              ))}
          </Select>
        </Field>
      )}
      {!application && (
        <Field label="Appointment name">
          <Input
            required
            autoFocus
            value={title}
            maxLength={240}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Mock interview"
          />
        </Field>
      )}
      <Field label="Date and local time">
        <Input
          type="datetime-local"
          required
          value={time}
          onChange={(event) => setTime(event.target.value)}
          autoFocus={!!application}
        />
      </Field>
      <Field label="Timezone">
        <Input
          required
          value={timezone}
          list={datalistId}
          maxLength={80}
          onChange={(event) => setTimezone(event.target.value)}
        />
        <datalist id={datalistId}>
          {[
            preferences.timezone,
            "Australia/Melbourne",
            "America/Los_Angeles",
            "America/New_York",
            "Europe/London",
            "UTC",
          ]
            .filter((zone, index, all) => all.indexOf(zone) === index)
            .map((zone) => (
              <option key={zone}>{zone}</option>
            ))}
        </datalist>
      </Field>
      <Field label="Meeting URL">
        <Input
          type="url"
          value={meetingUrl}
          maxLength={2048}
          onChange={(event) => setMeetingUrl(event.target.value)}
          placeholder="Optional"
        />
      </Field>
      <details className="application-optional" open={!!record || undefined}>
        <summary>Details</summary>
        <div className="stack">
          {application && (
            <Field label="Interview title">
              <Input
                value={title}
                maxLength={240}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={defaultTitle}
              />
            </Field>
          )}
          <Field label="Status">
            <Select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              {statuses.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </Select>
          </Field>
          <Field label="Source URL">
            <Input
              type="url"
              maxLength={2048}
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="Optional"
            />
          </Field>
        </div>
      </details>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="inline-actions">
        <Button type="submit" disabled={!!pending}>
          {pending ? "Saving…" : "Save interview"}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        {record && editMode && (
          <Button
            type="button"
            variant="danger"
            disabled={!!pending}
            onClick={() => setConfirmDeletion(true)}
          >
            Delete appointment
          </Button>
        )}
      </div>
      {confirmDeletion && record && (
        <div className="application-notice">
          <p>Delete this appointment? Preparation notes remain available.</p>
          <Button
            type="button"
            variant="danger"
            disabled={!!pending}
            onClick={() => {
              void remove(record.id)
                .then(() => {
                  onRemoved?.(record);
                  onClose();
                })
                .catch((failure: unknown) => setError(errorMessage(failure)));
            }}
          >
            Confirm delete
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setConfirmDeletion(false)}
          >
            Keep it
          </Button>
        </div>
      )}
    </form>
  );
}
