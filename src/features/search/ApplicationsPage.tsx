import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  CalendarDays,
  Plus,
  Trash2,
} from "lucide-react";
import {
  field,
  localDate,
  niceDate,
  type WorkRecord,
} from "../../../shared/model";
import {
  APPLICATION_STATUSES,
  ApplicationDataSchema,
  RadarCompanyDataSchema,
  STEP_KINDS,
  STEP_STATES,
  applicationDate,
  applicationStatus,
  archiveRecruitmentStep,
  changeRecruitmentStep,
  commonRecruitmentProcess,
  currentRecruitmentStep,
  legacyApplicationStage,
  recruitmentSteps,
  setApplicationStatus,
  type ApplicationStatus,
  type RecruitmentStep,
} from "../../../shared/applications";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Markdown,
  Modal,
  PageHeader,
  Select,
  Textarea,
} from "../../components/ui";
import { webDestination } from "../assets/documentLinks";
import {
  associatedInterviews,
  interviewTime,
  InterviewEditor,
} from "./InterviewEditor";
import { errorMessage, stageHistory } from "./domain";
import { useSavingWorkspace as useWorkspace } from "./useSaving";
import { applicationCompany, applicationContact } from "./applicationRecords";
import { CompanyGlyph } from "../../components/CompanyGlyph";
import { useEditMode } from "../../lib/edit-mode";
import "./applications.css";

export const APPLICATION_STAGES = APPLICATION_STATUSES;

export function ApplicationsPage() {
  const { editing: editMode } = useEditMode();
  const { records, preferences, remove, restore, pending } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<WorkRecord | null | undefined>();
  const [companyEditing, setCompanyEditing] = useState<
    WorkRecord | null | undefined
  >();
  const [prefilledCompany, setPrefilledCompany] = useState<WorkRecord>();
  const [processEditing, setProcessEditing] = useState(false);
  const [interviewEditing, setInterviewEditing] = useState<
    WorkRecord | null | undefined
  >();
  const [appointmentStep, setAppointmentStep] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sort, setSort] = useState("updated");
  const [deleting, setDeleting] = useState<WorkRecord>();
  const [undo, setUndo] = useState<WorkRecord>();
  const [error, setError] = useState("");
  const applications = records.filter(
    (record) => record.kind === "application" && !record.deletedAt,
  );
  const companies = records.filter(
    (record) => record.kind === "company" && !record.deletedAt,
  );
  const radar = params.get("tab") === "radar";
  const linkedInterview = records.find(
    (item) =>
      item.kind === "interview" &&
      !item.deletedAt &&
      item.id === params.get("interview"),
  );
  const selectedId =
    params.get("record") ||
    params.get("selected") ||
    params.get("application") ||
    field(linkedInterview, "applicationId") ||
    linkedInterview?.links.find((id) =>
      applications.some((item) => item.id === id),
    );
  const selected = applications.find((record) => record.id === selectedId);
  const interviews = selected ? associatedInterviews(records, selected.id) : [];
  const interviewOpen =
    interviewEditing !== undefined ||
    !!linkedInterview ||
    !!params.get("application");
  const filtered = applications
    .filter(
      (record) =>
        (!statusFilter || applicationStatus(record) === statusFilter) &&
        `${applicationCompany(record, records)} ${record.title} ${field(record, "location")} ${record.body}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => {
      if (sort === "company")
        return (
          applicationCompany(a, records).localeCompare(
            applicationCompany(b, records),
          ) || a.title.localeCompare(b.title)
        );
      if (sort === "role") return a.title.localeCompare(b.title);
      if (sort === "date")
        return (
          applicationDate(b).localeCompare(applicationDate(a)) ||
          b.updatedAt.localeCompare(a.updatedAt)
        );
      if (sort === "status")
        return (
          APPLICATION_STATUSES.indexOf(applicationStatus(a)) -
          APPLICATION_STATUSES.indexOf(applicationStatus(b))
        );
      return b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
    });
  const filteredCompanies = companies
    .filter((record) =>
      `${record.title} ${field(record, "location")} ${field(record, "reason")} ${record.body}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .sort((a, b) => a.title.localeCompare(b.title));

  function closeInterview() {
    setInterviewEditing(undefined);
    setAppointmentStep("");
    const next = new URLSearchParams(params);
    next.delete("interview");
    next.delete("application");
    if (selected) next.set("record", selected.id);
    setParams(next, { replace: true });
  }
  function newApplication(company?: WorkRecord) {
    setPrefilledCompany(company);
    setEditing(null);
  }
  async function deleteRecord() {
    if (!deleting) return;
    setError("");
    try {
      await remove(deleting.id);
      setUndo(deleting);
      setDeleting(undefined);
      setParams(radar ? { tab: "radar" } : {});
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }

  return (
    <div className="page-stack applications-page">
      <PageHeader
        title="Applications"
        description="Keep the opportunity, the process, and your next conversation together."
        action={
          editMode ? (
            <Button
              onClick={() =>
                radar ? setCompanyEditing(null) : newApplication()
              }
            >
              <Plus size={17} />
              {radar ? "Add company" : "New application"}
            </Button>
          ) : undefined
        }
      />
      <div
        className="application-tabs"
        role="tablist"
        aria-label="Application views"
      >
        <button
          role="tab"
          aria-selected={!radar}
          className={!radar ? "active" : ""}
          onClick={() => setParams({})}
        >
          Applications <span>{applications.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={radar}
          className={radar ? "active" : ""}
          onClick={() => setParams({ tab: "radar" })}
        >
          On your radar <span>{companies.length}</span>
        </button>
      </div>
      {undo && (
        <div className="application-notice" role="status">
          <span>Deleted {undo.title}.</span>
          <Button
            variant="ghost"
            onClick={() => {
              void restore(undo.id)
                .then(() => setUndo(undefined))
                .catch((failure: unknown) => setError(errorMessage(failure)));
            }}
          >
            Undo
          </Button>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="application-filters">
        <Input
          aria-label={radar ? "Search companies" : "Search applications"}
          placeholder={radar ? "Find a company…" : "Find a company or role…"}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {!radar && (
          <>
            <Select
              aria-label="Filter application status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">Every status</option>
              {APPLICATION_STATUSES.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </Select>
            <Select
              aria-label="Sort applications"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="updated">Recently updated</option>
              <option value="company">Company A–Z</option>
              <option value="role">Role A–Z</option>
              <option value="date">Application date</option>
              <option value="status">Status</option>
            </Select>
          </>
        )}
      </div>
      {radar ? (
        <>
          {!filteredCompanies.length ? (
            <EmptyState
              title={
                companies.length
                  ? "No matching companies"
                  : "Who is on your radar?"
              }
              description="Save a company before there is a particular role to apply for."
              action={
                editMode && !companies.length ? (
                  <Button onClick={() => setCompanyEditing(null)}>
                    Add company
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="radar-grid">
              {filteredCompanies.map((company) => (
                <Card className="radar-card" key={company.id}>
                  <div className="section-heading">
                    <h3>
                      <CompanyGlyph
                        name={company.title}
                        url={field(company, "website") || field(company, "url")}
                      />
                      {company.title}
                    </h3>
                    <Badge tone="blue">On your radar</Badge>
                  </div>
                  {field(company, "location") && (
                    <p className="muted">{field(company, "location")}</p>
                  )}
                  {field(company, "reason") && (
                    <p>{field(company, "reason")}</p>
                  )}
                  {company.body && (
                    <p className="application-notes-preview">{company.body}</p>
                  )}
                  <div className="inline-actions">
                    <Destination
                      url={field(company, "website") || field(company, "url")}
                      label="Website"
                    />
                    <Destination
                      url={field(company, "careersUrl")}
                      label="Careers"
                    />
                  </div>
                  {field(company, "reviewDate") && (
                    <p className="muted">
                      Review {niceDate(field(company, "reviewDate"))}
                    </p>
                  )}
                  {editMode && (
                    <div className="inline-actions radar-actions">
                      <Button
                        variant="secondary"
                        onClick={() => newApplication(company)}
                      >
                        <Plus size={15} />
                        Add application
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => setCompanyEditing(company)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        aria-label={`Delete ${company.title}`}
                        onClick={() => setDeleting(company)}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </>
      ) : !filtered.length ? (
        <EmptyState
          title={
            applications.length
              ? "No matching applications"
              : "No applications yet"
          }
          description={
            applications.length
              ? "Try another search or status."
              : "Your application spreadsheet, with room for the whole process."
          }
          action={
            editMode && !applications.length ? (
              <Button onClick={() => newApplication()}>New application</Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Card className="application-table-wrap">
            <table className="application-table">
              <thead>
                <tr>
                  {[
                    "Company",
                    "Role",
                    "Listing link",
                    "Status",
                    "Application date",
                    "Location",
                    "Notes",
                  ].map((heading) => (
                    <th key={heading} scope="col">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((record) => (
                  <tr key={record.id}>
                    <td>
                      <CompanyGlyph
                        name={applicationCompany(record, records)}
                      />
                      {applicationCompany(record, records)}
                    </td>
                    <td>
                      <button
                        className="application-open"
                        onClick={() => setParams({ record: record.id })}
                      >
                        <strong>{record.title}</strong>
                      </button>
                    </td>
                    <td>
                      <Destination url={field(record, "url")} label="Listing" />
                    </td>
                    <td>
                      <Status record={record} />
                    </td>
                    <td>
                      {applicationDate(record)
                        ? niceDate(applicationDate(record))
                        : "—"}
                    </td>
                    <td>{field(record, "location") || "—"}</td>
                    <td>
                      <button
                        className="application-notes-preview application-open"
                        aria-label={`Open notes for ${record.title}`}
                        onClick={() => setParams({ record: record.id })}
                      >
                        {record.body || "—"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <div className="application-mobile-cards">
            {filtered.map((record) => (
              <Card key={record.id}>
                <div className="section-heading">
                  <button
                    className="application-open"
                    onClick={() => setParams({ record: record.id })}
                  >
                    <span className="application-company">
                      <CompanyGlyph
                        name={applicationCompany(record, records)}
                      />
                      {applicationCompany(record, records)}
                    </span>
                    <strong>{record.title}</strong>
                  </button>
                  <Status record={record} />
                </div>
                <dl className="application-mobile-fields">
                  <div>
                    <dt>Listing link</dt>
                    <dd>
                      <Destination url={field(record, "url")} label="Listing" />
                      {!webDestination(field(record, "url")) && "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Application date</dt>
                    <dd>
                      {applicationDate(record)
                        ? niceDate(applicationDate(record))
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Location</dt>
                    <dd>{field(record, "location") || "—"}</dd>
                  </div>
                  <div>
                    <dt>Notes</dt>
                    <dd className="application-notes-preview">
                      {record.body || "—"}
                    </dd>
                  </div>
                </dl>
              </Card>
            ))}
          </div>
        </>
      )}
      <Modal
        open={
          !!selected &&
          editing === undefined &&
          !interviewOpen &&
          !processEditing &&
          !deleting
        }
        onClose={() => setParams({})}
        title={selected?.title || "Application"}
        size="wide"
      >
        {selected && (
          <div className="stack application-detail">
            <div className="section-heading">
              <div className="inline-actions">
                <strong>
                  <CompanyGlyph name={applicationCompany(selected, records)} />
                  {applicationCompany(selected, records)}
                </strong>
                <Status record={selected} />
              </div>
              {editMode && (
                <div className="inline-actions">
                  <Button variant="ghost" onClick={() => setEditing(selected)}>
                    Edit application
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label="Delete application"
                    onClick={() => setDeleting(selected)}
                  >
                    <Trash2 size={17} />
                  </Button>
                </div>
              )}
            </div>
            <Destination url={field(selected, "url")} label="Listing" />
            <dl className="application-dates">
              {[
                ["Application date", applicationDate(selected)],
                ["Location", field(selected, "location")],
                ["Deadline", field(selected, "deadline")],
                ["Follow-up", field(selected, "followUp")],
              ]
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{label === "Location" ? value : niceDate(value)}</dd>
                  </div>
                ))}
            </dl>
            {legacyApplicationStage(selected) && (
              <p className="muted">
                Previous stage:{" "}
                <strong>{legacyApplicationStage(selected)}</strong>. The
                original label and history are retained.
              </p>
            )}
            <section className="application-detail-section">
              <div className="section-heading">
                <h3>Recruitment process</h3>
                {editMode && (
                  <Button
                    variant="secondary"
                    onClick={() => setProcessEditing(true)}
                  >
                    Edit process
                  </Button>
                )}
              </div>
              <ProcessTimeline
                record={selected}
                interviews={interviews}
                timezone={preferences.timezone}
                onSchedule={(stepId) => {
                  setAppointmentStep(stepId);
                  setInterviewEditing(null);
                }}
              />
            </section>
            <section className="application-detail-section">
              <div className="section-heading">
                <h3>Appointments</h3>
                {editMode && (
                  <Button
                    variant="secondary"
                    onClick={() => setInterviewEditing(null)}
                  >
                    <Plus size={15} />
                    Schedule interview
                  </Button>
                )}
              </div>
              {interviews.length ? (
                <div className="interview-list">
                  {interviews.map((record) => (
                    <div
                      className={`interview-row ${field(record, "status") === "Cancelled" ? "interview-cancelled" : ""}`}
                      key={record.id}
                    >
                      <CalendarDays size={20} aria-hidden="true" />
                      <div>
                        <button
                          className="interview-title"
                          onClick={() => setInterviewEditing(record)}
                        >
                          {record.title}
                        </button>
                        <p>{interviewTime(record, preferences.timezone)}</p>
                        {field(record, "timezone") &&
                          field(record, "timezone") !==
                            preferences.timezone && (
                            <p className="muted">
                              Interviewer:{" "}
                              {interviewTime(record, field(record, "timezone"))}
                            </p>
                          )}
                        {field(record, "stepId") && (
                          <p className="muted">
                            {recruitmentSteps(selected.data, true).find(
                              (step) => step.id === field(record, "stepId"),
                            )?.title || "Unassigned round"}
                            {recruitmentSteps(selected.data, true).find(
                              (step) => step.id === field(record, "stepId"),
                            )?.archived
                              ? " · deleted step"
                              : ""}
                          </p>
                        )}
                        <div className="inline-actions">
                          <Destination
                            url={field(record, "meetingUrl")}
                            label="Meeting"
                          />
                          <Destination
                            url={field(record, "sourceUrl")}
                            label="Source"
                          />
                          <Link
                            className="external-link"
                            to={`/interviews?interview=${encodeURIComponent(record.id)}`}
                          >
                            Prepare <ArrowUpRight size={15} />
                          </Link>
                        </div>
                      </div>
                      <Badge
                        tone={
                          field(record, "status") === "Cancelled"
                            ? "muted"
                            : "blue"
                        }
                      >
                        {field(record, "status", "Scheduled")}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">
                  No interviews scheduled. Scheduling an appointment does not
                  mark a round as passed.
                </p>
              )}
            </section>
            {selected.body && (
              <section className="application-detail-section">
                <h3>Notes</h3>
                <Markdown content={selected.body} />
              </section>
            )}
            {applicationContact(selected, records) && (
              <section className="application-detail-section">
                <h3>Contact</h3>
                <p>{applicationContact(selected, records)}</p>
              </section>
            )}
            {!!stageHistory(selected.data).length && (
              <details className="application-optional">
                <summary>Previous stage history</summary>
                <ol className="application-history">
                  {stageHistory(selected.data).map((entry, index) => (
                    <li key={`${entry.at}:${index}`}>
                      <strong>{entry.stage}</strong> · {niceDate(entry.at)}
                      {entry.previous ? ` · from ${entry.previous}` : ""}
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </div>
        )}
      </Modal>
      <Modal
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
        title={editing ? "Edit application" : "New application"}
        size="wide"
      >
        {editing !== undefined && (
          <ApplicationForm
            key={`${editing?.id || "new"}:${editing?.version || 0}:${prefilledCompany?.id || ""}`}
            record={editing || undefined}
            company={prefilledCompany}
            onClose={() => setEditing(undefined)}
            onSaved={(id) => {
              setEditing(undefined);
              setPrefilledCompany(undefined);
              setParams({ record: id });
            }}
          />
        )}
      </Modal>
      <Modal
        open={companyEditing !== undefined}
        onClose={() => setCompanyEditing(undefined)}
        title={companyEditing ? "Edit radar company" : "Add radar company"}
      >
        {companyEditing !== undefined && (
          <CompanyForm
            key={`${companyEditing?.id || "new"}:${companyEditing?.version || 0}`}
            record={companyEditing || undefined}
            onClose={() => setCompanyEditing(undefined)}
          />
        )}
      </Modal>
      <Modal
        open={!!selected && processEditing}
        onClose={() => setProcessEditing(false)}
        title="Recruitment process"
        size="wide"
      >
        {selected && processEditing && (
          <ProcessForm
            key={`${selected.id}:${selected.version}`}
            record={selected}
            onClose={() => setProcessEditing(false)}
          />
        )}
      </Modal>
      <Modal
        open={!!deleting}
        onClose={() => {
          setDeleting(undefined);
          setError("");
        }}
        title={`Delete ${deleting?.kind === "company" ? "radar company" : "application"}?`}
      >
        <div className="stack">
          <p>
            {deleting?.kind === "company"
              ? "Applications keep their company name. Removing this radar company does not delete them."
              : "The application is removed from your tracker. Its appointments and preparation stay available."}
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="inline-actions">
            <Button
              variant="danger"
              disabled={!!pending}
              onClick={() => void deleteRecord()}
            >
              Delete {deleting?.title}
            </Button>
            <Button variant="ghost" onClick={() => setDeleting(undefined)}>
              Keep it
            </Button>
          </div>
        </div>
      </Modal>
      <InterviewEditor
        open={interviewOpen}
        record={interviewEditing || linkedInterview}
        applicationId={selected?.id}
        stepId={appointmentStep}
        onRemoved={setUndo}
        onClose={closeInterview}
      />
    </div>
  );
}

function Status({ record }: { record: WorkRecord }) {
  const status = applicationStatus(record);
  const current = currentRecruitmentStep(record);
  return (
    <div className="application-status">
      <Badge
        tone={
          status === "In progress"
            ? "blue"
            : ["Offer", "Accepted"].includes(status)
              ? "lime"
              : status === "Rejected"
                ? "pink"
                : "muted"
        }
      >
        {status}
      </Badge>
      {current && !["Accepted", "Rejected", "Withdrawn"].includes(status) && (
        <small>{current.title}</small>
      )}
    </div>
  );
}
function Destination({ url, label }: { url: string; label: string }) {
  const href = webDestination(url);
  return href ? (
    <a
      className="external-link application-destination"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {label}
      <ArrowUpRight size={15} />
    </a>
  ) : null;
}
function ProcessTimeline({
  record,
  interviews,
  timezone,
  onSchedule,
}: {
  record: WorkRecord;
  interviews: WorkRecord[];
  timezone: string;
  onSchedule: (stepId: string) => void;
}) {
  const { editing: editMode } = useEditMode();
  const steps = recruitmentSteps(record.data);
  if (!steps.length)
    return (
      <p className="muted">
        Outline the company's rounds before dates are known, or start with a
        common process.
      </p>
    );
  return (
    <ol className="recruitment-timeline">
      {steps.map((step, index) => {
        const appointments = interviews.filter(
          (interview) => field(interview, "stepId") === step.id,
        );
        return (
          <li
            className={`recruitment-step recruitment-${step.state.toLowerCase()}`}
            key={step.id}
          >
            <span className="recruitment-step-number" aria-hidden="true">
              {index + 1}
            </span>
            <strong>{step.title}</strong>
            <Badge
              tone={
                step.state === "Current"
                  ? "blue"
                  : step.state === "Completed"
                    ? "lime"
                    : "muted"
              }
            >
              {step.state}
            </Badge>
            {step.date && <small>{niceDate(step.date)}</small>}
            {appointments.map((appointment) => (
              <Link
                className="recruitment-appointment"
                key={appointment.id}
                to={`/interviews?interview=${encodeURIComponent(appointment.id)}`}
              >
                {niceDate(field(appointment, "startsAt"), timezone)} ·{" "}
                {field(appointment, "status", "Scheduled")}
              </Link>
            ))}
            {editMode &&
              step.kind !== "submission" &&
              step.kind !== "offer" && (
                <button
                  className="recruitment-schedule"
                  onClick={() => onSchedule(step.id)}
                >
                  Schedule appointment
                </button>
              )}
          </li>
        );
      })}
    </ol>
  );
}

function ApplicationForm({
  record,
  company,
  onClose,
  onSaved,
}: {
  record?: WorkRecord;
  company?: WorkRecord;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { records, preferences, create, update, pending } = useWorkspace();
  const companies = records.filter(
    (item) => item.kind === "company" && !item.deletedAt,
  );
  const [form, setForm] = useState({
    company: record
      ? applicationCompany(record, records)
      : company?.title || "",
    companyId: field(record, "companyId") || company?.id || "",
    title: record?.title || "",
    status: record ? applicationStatus(record) : ("Saved" as ApplicationStatus),
    url: field(record, "url"),
    applicationDate: record ? applicationDate(record) : "",
    location: field(record, "location"),
    notes: record?.body || "",
    deadline: field(record, "deadline"),
    followUp: field(record, "followUp"),
    contact: record ? applicationContact(record, records) : "",
    currentStepId: record ? currentRecruitmentStep(record)?.id || "" : "",
  });
  const [error, setError] = useState("");
  const steps = record ? recruitmentSteps(record.data) : [];
  function change(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      if (!form.company.trim() || !form.title.trim())
        throw new Error("Enter a company and role.");
      const chosenCompany = companies.find(
        (item) => item.id === form.companyId,
      );
      if (form.url.trim() && !webDestination(form.url))
        throw new Error(
          "Use an http or https listing link without embedded credentials.",
        );
      const base =
        record || ({ data: {}, title: form.title, id: "new" } as WorkRecord);
      const transitioned = setApplicationStatus(
        base,
        form.status,
        form.currentStepId,
        localDate(new Date(), preferences.timezone),
      );
      const data = ApplicationDataSchema.parse({
        ...transitioned,
        company: form.company.trim(),
        companyId: chosenCompany?.id || "",
        url: webDestination(form.url),
        applicationDate:
          form.status === "Saved"
            ? form.applicationDate
            : form.applicationDate ||
              (form.status === "Applied"
                ? localDate(new Date(), preferences.timezone)
                : transitioned.applicationDate),
        location: form.location.trim(),
        deadline: form.deadline,
        followUp: form.followUp,
        contact: form.contact.trim(),
      });
      if (form.status === "Saved" && data.applicationDate)
        throw new Error(
          "Choose Applied or In progress when an application date is recorded.",
        );
      const links = [
        ...new Set([
          ...(record?.links || []).filter(
            (id) => id !== field(record, "companyId"),
          ),
          ...(chosenCompany ? [chosenCompany.id] : []),
        ]),
      ];
      const input = { title: form.title.trim(), body: form.notes, links, data };
      const saved = record
        ? await update(record.id, input)
        : await create({ kind: "application", ...input });
      onSaved(saved.id);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }
  return (
    <form className="stack" onSubmit={(event) => void save(event)}>
      {companies.length > 0 && (
        <Field
          label="Radar company"
          hint="Optional. Choosing a company links this application to its radar entry."
        >
          <Select
            value={form.companyId}
            onChange={(event) => {
              const chosen = companies.find(
                (item) => item.id === event.target.value,
              );
              setForm((current) => ({
                ...current,
                companyId: event.target.value,
                company: chosen?.title || current.company,
              }));
            }}
          >
            <option value="">Company name only</option>
            {companies.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <div className="form-grid">
        <Field label="Company">
          <Input
            required
            autoFocus
            value={form.company}
            maxLength={240}
            onChange={(event) => {
              change("company", event.target.value);
              if (form.companyId) change("companyId", "");
            }}
          />
        </Field>
        <Field label="Role">
          <Input
            required
            value={form.title}
            maxLength={240}
            onChange={(event) => change("title", event.target.value)}
          />
        </Field>
      </div>
      <div className="form-grid">
        <Field label="Status">
          <Select
            value={form.status}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                status: event.target.value as ApplicationStatus,
                applicationDate:
                  event.target.value === "Saved"
                    ? ""
                    : current.applicationDate ||
                      (event.target.value === "Applied"
                        ? localDate(new Date(), preferences.timezone)
                        : ""),
                currentStepId: "",
              }))
            }
          >
            {APPLICATION_STATUSES.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </Select>
        </Field>
        <Field label="Application date">
          <Input
            type="date"
            value={form.applicationDate}
            onChange={(event) => change("applicationDate", event.target.value)}
          />
        </Field>
      </div>
      {steps.length > 0 && ["In progress", "Offer"].includes(form.status) && (
        <Field label="Current recruitment step">
          <Select
            required={
              !(
                form.status === "In progress" &&
                steps.some(
                  (step) =>
                    !["submission", "offer"].includes(step.kind) &&
                    step.state === "Completed",
                )
              )
            }
            value={form.currentStepId}
            onChange={(event) => change("currentStepId", event.target.value)}
          >
            <option value="">
              {form.status === "In progress" &&
              steps.some(
                (step) =>
                  !["submission", "offer"].includes(step.kind) &&
                  step.state === "Completed",
              )
                ? "Awaiting next round"
                : "Choose the current step"}
            </option>
            {steps
              .filter((step) =>
                form.status === "Offer"
                  ? step.kind === "offer"
                  : !["submission", "offer"].includes(step.kind),
              )
              .map((step) => (
                <option key={step.id} value={step.id}>
                  {step.title}
                </option>
              ))}
          </Select>
        </Field>
      )}
      <Field label="Listing link">
        <Input
          type="url"
          value={form.url}
          maxLength={2048}
          placeholder="Optional"
          onChange={(event) => change("url", event.target.value)}
        />
      </Field>
      <Field label="Location">
        <Input
          value={form.location}
          maxLength={1000}
          placeholder="City, country, remote or hybrid"
          onChange={(event) => change("location", event.target.value)}
        />
      </Field>
      <Field label="Notes">
        <Textarea
          value={form.notes}
          maxLength={100000}
          rows={4}
          placeholder="Anything useful to remember"
          onChange={(event) => change("notes", event.target.value)}
        />
      </Field>
      <details className="application-optional" open={!!record || undefined}>
        <summary>Deadline, follow-up & contact</summary>
        <div className="stack">
          <div className="form-grid">
            <Field label="Deadline">
              <Input
                type="date"
                value={form.deadline}
                onChange={(event) => change("deadline", event.target.value)}
              />
            </Field>
            <Field label="Follow-up">
              <Input
                type="date"
                value={form.followUp}
                onChange={(event) => change("followUp", event.target.value)}
              />
            </Field>
          </div>
          <Field label="Contact">
            <Input
              value={form.contact}
              maxLength={1000}
              placeholder="Optional name / email"
              onChange={(event) => change("contact", event.target.value)}
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
          {pending ? "Saving…" : "Save application"}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function CompanyForm({
  record,
  onClose,
}: {
  record?: WorkRecord;
  onClose: () => void;
}) {
  const { create, update, pending } = useWorkspace();
  const [form, setForm] = useState({
    title: record?.title || "",
    website: field(record, "website") || field(record, "url"),
    careersUrl: field(record, "careersUrl"),
    location: field(record, "location"),
    reason: field(record, "reason"),
    notes: record?.body || "",
    reviewDate: field(record, "reviewDate"),
  });
  const [error, setError] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const data = RadarCompanyDataSchema.parse({
        ...record?.data,
        radar: true,
        website: form.website.trim(),
        careersUrl: form.careersUrl.trim(),
        location: form.location.trim(),
        reason: form.reason.trim(),
        reviewDate: form.reviewDate,
      });
      const input = { title: form.title.trim(), body: form.notes, data };
      if (!input.title) throw new Error("Enter a company name.");
      if (record) await update(record.id, input);
      else await create({ kind: "company", ...input });
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }
  return (
    <form className="stack" onSubmit={(event) => void save(event)}>
      {(
        [
          ["title", "Company name"],
          ["website", "Website"],
          ["careersUrl", "Careers link"],
          ["location", "Location"],
          ["reason", "Why it interests you"],
          ["reviewDate", "Review date"],
        ] as const
      ).map(([key, label]) => (
        <Field key={key} label={label}>
          <Input
            required={key === "title"}
            autoFocus={key === "title"}
            type={
              key === "reviewDate"
                ? "date"
                : ["website", "careersUrl"].includes(key)
                  ? "url"
                  : "text"
            }
            maxLength={key === "title" ? 240 : key === "reason" ? 10000 : 2048}
            value={form[key]}
            onChange={(event) =>
              setForm((current) => ({ ...current, [key]: event.target.value }))
            }
          />
        </Field>
      ))}
      <Field label="Notes">
        <Textarea
          rows={4}
          value={form.notes}
          maxLength={100000}
          onChange={(event) =>
            setForm((current) => ({ ...current, notes: event.target.value }))
          }
        />
      </Field>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="inline-actions">
        <Button type="submit" disabled={!!pending}>
          {pending ? "Saving…" : "Save company"}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ProcessForm({
  record,
  onClose,
}: {
  record: WorkRecord;
  onClose: () => void;
}) {
  const { update, pending, preferences } = useWorkspace();
  const [data, setData] = useState(record.data);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const steps = recruitmentSteps(data);
  const allSteps = recruitmentSteps(data, true);
  function draft() {
    return { ...record, data };
  }
  function edit(stepId: string, patch: Partial<RecruitmentStep>) {
    const next = {
      ...data,
      recruitmentSteps: allSteps.map((step) =>
        step.id === stepId ? { ...step, ...patch } : step,
      ),
    };
    const target = recruitmentSteps(next).find((step) => step.id === stepId);
    setData(
      target && (patch.kind || patch.state)
        ? changeRecruitmentStep(
            { ...record, data: next },
            stepId,
            target.state,
            localDate(new Date(), preferences.timezone),
          )
        : next,
    );
  }
  function move(stepId: string, offset: number) {
    const index = allSteps.findIndex((step) => step.id === stepId);
    const activeIndex = steps.findIndex((step) => step.id === stepId);
    const other = steps[activeIndex + offset];
    if (!other) return;
    const otherIndex = allSteps.findIndex((step) => step.id === other.id);
    const reordered = [...allSteps];
    [reordered[index], reordered[otherIndex]] = [
      reordered[otherIndex],
      reordered[index],
    ];
    setData({ ...data, recruitmentSteps: reordered });
  }
  function addTemplate() {
    const template = commonRecruitmentProcess();
    const currentStatus = applicationStatus(draft());
    if (["Applied", "In progress", "Offer"].includes(currentStatus))
      template[0].state = "Completed";
    if (currentStatus === "In progress") template[1].state = "Current";
    if (currentStatus === "Offer")
      template[template.length - 1].state = "Current";
    setData({ ...data, recruitmentSteps: [...allSteps, ...template] });
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const validated = ApplicationDataSchema.parse({
        ...data,
        recruitmentSteps: allSteps.map((step) => ({
          ...step,
          title: titles[step.id] ?? step.title,
        })),
      });
      await update(record.id, { data: validated });
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }
  return (
    <form className="stack" onSubmit={(event) => void save(event)}>
      <p className="muted">
        Set up rounds before dates are known. Mark a round complete yourself
        after its outcome is clear; appointment completion does not advance this
        process.
      </p>
      {!steps.length && (
        <Button type="button" variant="secondary" onClick={addTemplate}>
          Start with a common process
        </Button>
      )}
      <ol className="process-editor">
        {steps.map((step, index) => (
          <li className="process-editor-step" key={step.id}>
            <div className="section-heading">
              <strong>Step {index + 1}</strong>
              <div className="inline-actions">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={index === 0}
                  aria-label={`Move ${step.title} earlier`}
                  onClick={() => move(step.id, -1)}
                >
                  <ArrowUp size={16} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={index === steps.length - 1}
                  aria-label={`Move ${step.title} later`}
                  onClick={() => move(step.id, 1)}
                >
                  <ArrowDown size={16} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Delete ${step.title}`}
                  onClick={() =>
                    setData(archiveRecruitmentStep(draft(), step.id))
                  }
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            </div>
            <Field label="Step name">
              <Input
                required
                value={titles[step.id] ?? step.title}
                maxLength={240}
                onChange={(event) =>
                  setTitles((current) => ({
                    ...current,
                    [step.id]: event.target.value,
                  }))
                }
              />
            </Field>
            <div className="form-grid">
              <Field label="Kind">
                <Select
                  value={step.kind}
                  onChange={(event) =>
                    edit(step.id, {
                      kind: event.target.value as RecruitmentStep["kind"],
                    })
                  }
                >
                  {STEP_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind === "submission"
                        ? "Application submission"
                        : kind.charAt(0).toUpperCase() + kind.slice(1)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Step state">
                <Select
                  value={step.state}
                  onChange={(event) =>
                    edit(step.id, {
                      state: event.target.value as RecruitmentStep["state"],
                    })
                  }
                >
                  {STEP_STATES.map((state) => (
                    <option key={state}>{state}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field
              label="Date"
              hint="Optional milestone date. Appointment times belong to their appointments."
            >
              <Input
                type="date"
                value={step.date}
                onChange={(event) =>
                  edit(step.id, { date: event.target.value })
                }
              />
            </Field>
          </li>
        ))}
      </ol>
      <Button
        type="button"
        variant="secondary"
        disabled={allSteps.length >= 80}
        onClick={() =>
          setData({
            ...data,
            recruitmentSteps: [
              ...allSteps,
              {
                id: crypto.randomUUID(),
                title: "New step",
                kind: "other",
                state: "Planned",
                date: "",
              },
            ],
          })
        }
      >
        <Plus size={15} />
        Add step
      </Button>
      {allSteps.some((step) => step.archived) && (
        <details className="application-optional">
          <summary>Deleted steps</summary>
          <p className="muted">
            Appointments and preparation stay attached. Reassign an appointment
            by editing it, or restore a step here.
          </p>
          {allSteps
            .filter((step) => step.archived)
            .map((step) => (
              <div className="section-heading" key={step.id}>
                <span>{step.title}</span>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    edit(step.id, { archived: false, state: "Planned" })
                  }
                >
                  Restore step
                </Button>
              </div>
            ))}
        </details>
      )}
      <p className="muted">
        Application status: <strong>{applicationStatus(draft())}</strong>
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="inline-actions">
        <Button type="submit" disabled={!!pending}>
          {pending ? "Saving…" : "Save process"}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
