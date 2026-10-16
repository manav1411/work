import { NoteInput } from "../content/NoteInput";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowUpRight, CalendarDays, Plus, Trash2 } from "lucide-react";
import {
  field,
  localDate,
  niceDate,
  type WorkRecord,
} from "../../../shared/model";
import {
  APPLICATION_STATUSES,
  ApplicationDataSchema,
  applicationDate,
  applicationStatus,
  commonRecruitmentProcess,
  recruitmentSteps,
  applicationStatusLabel,
  applicationStatusSelection,
  applicationStatusOptions,
  selectApplicationStatus,
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
  SectionTabs,
  Select,
} from "../../components/ui";
import { webDestination } from "../assets/documentLinks";
import {
  associatedInterviews,
  interviewTime,
  InterviewForm,
} from "./InterviewEditor";
import { errorMessage } from "./domain";
import { useSavingWorkspace as useWorkspace } from "./useSaving";
import { applicationCompany, applicationContact } from "./applicationRecords";
import { CompanyGlyph } from "../../components/CompanyGlyph";
import { useEditMode } from "../../lib/edit-mode";
import "./applications.css";
import { InlineProcess } from "./InlineProcess";
import { InlineApplicationFields } from "./InlineApplicationFields";
import { InlineInterestedFields } from "./InlineInterestedFields";
import { RadarView } from "./RadarView";
import type { Opportunity } from "../../../shared/radar";
import { request, jsonRequest } from "../../lib/api";

export const APPLICATION_STAGES = APPLICATION_STATUSES;

export function ApplicationsPage() {
  const { editing: editMode } = useEditMode();
  const { records, preferences, create, remove, pending } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<WorkRecord | null | undefined>();
  const [prefilledCompany, setPrefilledCompany] = useState<WorkRecord>();
  const [prefilledOpportunity, setPrefilledOpportunity] =
    useState<Opportunity>();
  const [interviewEditing, setInterviewEditing] = useState<
    WorkRecord | null | undefined
  >();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sort, setSort] = useState("updated");
  const [deleting, setDeleting] = useState<WorkRecord>();
  const [error, setError] = useState("");
  const applications = records.filter(
    (record) => record.kind === "application",
  );
  const companies = records.filter((record) => record.kind === "company");
  const radar = params.get("tab") === "interested";
  const discovery = params.get("tab") === "radar";
  const linkedInterview = records.find(
    (item) => item.kind === "interview" && item.id === params.get("interview"),
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
        (!statusFilter || applicationStatusLabel(record) === statusFilter) &&
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
        return applicationStatusLabel(a).localeCompare(
          applicationStatusLabel(b),
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
    const next = new URLSearchParams(params);
    next.delete("interview");
    next.delete("application");
    if (selected) next.set("record", selected.id);
    setParams(next, { replace: true });
  }
  async function addCompany() {
    try {
      await create({
        kind: "company",
        title: "Untitled",
        body: "",
        data: {},
      });
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }
  function newApplication(company?: WorkRecord) {
    setPrefilledOpportunity(undefined);
    setPrefilledCompany(company);
    setEditing(null);
  }
  function newRadarApplication(opportunity: Opportunity) {
    if (opportunity.applicationId) {
      setParams({ record: opportunity.applicationId });
      return;
    }
    setPrefilledOpportunity(opportunity);
    setPrefilledCompany(companies.find((c) => c.id === opportunity.companyId));
    setEditing(null);
  }
  async function deleteRecord() {
    if (!deleting) return;
    setError("");
    try {
      await remove(deleting.id);
      setDeleting(undefined);
      setParams(radar ? { tab: "interested" } : {});
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
          editMode && !discovery ? (
            <Button
              onClick={() => (radar ? void addCompany() : newApplication())}
            >
              <Plus size={17} />
              {radar ? "Add company" : "New application"}
            </Button>
          ) : undefined
        }
      />
      <SectionTabs
        className="application-tabs"
        role="tablist"
        aria-label="Application views"
      >
        <button
          role="tab"
          aria-selected={!radar && !discovery}
          tabIndex={radar || discovery ? -1 : 0}
          className={!radar && !discovery ? "active" : ""}
          onClick={() => setParams({})}
        >
          Applications <span>{applications.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={radar}
          tabIndex={radar ? 0 : -1}
          className={radar ? "active" : ""}
          onClick={() => setParams({ tab: "interested" })}
        >
          Interested <span>{companies.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={discovery}
          tabIndex={discovery ? 0 : -1}
          className={discovery ? "active" : ""}
          onClick={() => setParams({ tab: "radar" })}
        >
          Radar
        </button>
      </SectionTabs>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!discovery && (
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
                {[...new Set(applications.map(applicationStatusLabel))].map(
                  (value) => (
                    <option key={value}>{value}</option>
                  ),
                )}
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
      )}
      {discovery ? (
        <RadarView view="radar" onApplication={newRadarApplication} />
      ) : radar ? (
        <>
          <RadarView view="interested" onApplication={newRadarApplication} />
          {!filteredCompanies.length ? (
            <EmptyState
              title={
                companies.length
                  ? "No matching companies"
                  : "Companies you're interested in"
              }
              description="Save a company before there is a particular role to apply for."
              action={
                editMode && !companies.length ? (
                  <Button onClick={() => void addCompany()}>Add company</Button>
                ) : undefined
              }
            />
          ) : (
            <div className="radar-grid">
              {filteredCompanies.map((company) => (
                <Card className="radar-card" key={company.id}>
                  {editMode ? (
                    <InlineInterestedFields record={company} />
                  ) : (
                    <>
                      <div className="radar-title-row">
                        <h3>
                          {webDestination(field(company, "careersUrl")) ? (
                            <a
                              className="radar-title-link"
                              href={webDestination(
                                field(company, "careersUrl"),
                              )}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <CompanyGlyph
                                name={company.title}
                                url={field(company, "careersUrl")}
                              />
                              {company.title}
                            </a>
                          ) : (
                            <>
                              <CompanyGlyph
                                name={company.title}
                                url={field(company, "careersUrl")}
                              />
                              {company.title}
                            </>
                          )}
                        </h3>
                        <Destination
                          url={field(company, "careersUrl")}
                          label="Careers"
                          className="radar-careers-button"
                        />
                      </div>
                      {field(company, "location") && (
                        <p className="radar-location">
                          {field(company, "location")}
                        </p>
                      )}
                      <p className="radar-notes-preview">{company.body}</p>
                    </>
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
                  <tr
                    key={record.id}
                    className="application-row-action"
                    onClick={(event) => {
                      if (
                        event.defaultPrevented ||
                        (event.target as HTMLElement).closest(
                          "a,button,input,select,textarea,label",
                        ) ||
                        window.getSelection()?.toString()
                      )
                        return;
                      const anchor =
                        event.currentTarget.querySelector<HTMLAnchorElement>(
                          ".application-primary-link",
                        );
                      anchor?.dispatchEvent(
                        new MouseEvent("click", {
                          bubbles: true,
                          cancelable: true,
                          ctrlKey: event.ctrlKey,
                          metaKey: event.metaKey,
                          shiftKey: event.shiftKey,
                          altKey: event.altKey,
                        }),
                      );
                    }}
                  >
                    <td>
                      <CompanyGlyph
                        name={applicationCompany(record, records)}
                      />
                      {applicationCompany(record, records)}
                    </td>
                    <td>
                      <Link
                        className="application-open application-primary-link"
                        to={`/applications?record=${encodeURIComponent(record.id)}`}
                      >
                        <strong>{record.title}</strong>
                      </Link>
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
                    <td title={field(record, "location") || "—"}>
                      {field(record, "location") || "—"}
                    </td>
                    <td>
                      <Link
                        className="application-open application-primary-link"
                        aria-label={`Open notes for ${record.title}`}
                        to={`/applications?record=${encodeURIComponent(record.id)}`}
                      >
                        <span
                          className="application-notes-preview"
                          title={record.body || "—"}
                        >
                          {record.body || "—"}
                        </span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <div className="application-mobile-cards">
            {filtered.map((record) => (
              <Card key={record.id} className="action-card">
                <div className="section-heading">
                  <Link
                    className="application-open card-hit-target"
                    to={`/applications?record=${encodeURIComponent(record.id)}`}
                  >
                    <span className="application-company">
                      <CompanyGlyph
                        name={applicationCompany(record, records)}
                      />
                      {applicationCompany(record, records)}
                    </span>
                    <strong>{record.title}</strong>
                  </Link>
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
                    <dd title={field(record, "location") || "—"}>
                      {field(record, "location") || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Notes</dt>
                    <dd
                      className="application-notes-preview"
                      title={record.body || "—"}
                    >
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
        open={!!selected && editing === undefined && !deleting}
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
            {editMode && (
              <InlineApplicationFields key={selected.id} record={selected} />
            )}
            {!editMode && (
              <Destination url={field(selected, "url")} label="Listing" />
            )}
            {!editMode && (
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
            )}
            <section className="application-detail-section">
              <InlineProcess record={selected} interviews={interviews} />
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
                    Schedule
                  </Button>
                )}
              </div>
              {interviewOpen && editMode && (
                <InterviewForm
                  key={interviewEditing?.id || linkedInterview?.id || "new"}
                  open
                  record={interviewEditing || linkedInterview}
                  applicationId={selected.id}
                  onClose={closeInterview}
                />
              )}
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
                        {field(record, "stepId") && (
                          <p className="muted">
                            {recruitmentSteps(selected.data).find(
                              (step) => step.id === field(record, "stepId"),
                            )?.title || "Unassigned round"}
                          </p>
                        )}
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
            {!editMode && selected.body && (
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
            key={`${editing?.id || "new"}:${editing?.version || 0}:${prefilledCompany?.id || ""}:${prefilledOpportunity?.id || ""}`}
            record={editing || undefined}
            company={prefilledCompany}
            opportunity={prefilledOpportunity}
            onClose={() => setEditing(undefined)}
            onSaved={(id) => {
              setEditing(undefined);
              setPrefilledCompany(undefined);
              setPrefilledOpportunity(undefined);
              setParams({ record: id });
            }}
          />
        )}
      </Modal>
      <Modal
        open={!!deleting}
        onClose={() => {
          setDeleting(undefined);
          setError("");
        }}
        title={`Delete ${deleting?.kind === "company" ? "interested company" : "application"}?`}
      >
        <div className="stack">
          <p>
            {deleting?.kind === "company"
              ? "Applications and saved opportunities keep their company name. Removing this company does not delete them."
              : "The application, its appointments, and preparation notes will be permanently deleted."}
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
    </div>
  );
}

function Status({ record }: { record: WorkRecord }) {
  const status = applicationStatus(record);
  return (
    <Badge
      className={
        status === "In progress" ? "application-intermediate-status" : ""
      }
      tone={
        ["Offer", "Accepted"].includes(status)
          ? "lime"
          : status === "Rejected"
            ? "pink"
            : "muted"
      }
    >
      {applicationStatusLabel(record)}
    </Badge>
  );
}
function Destination({
  url,
  label,
  className = "",
}: {
  url: string;
  label: string;
  className?: string;
}) {
  const href = webDestination(url);
  return href ? (
    <a
      className={`external-link application-destination ${className}`.trim()}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {label}
      <ArrowUpRight size={15} />
    </a>
  ) : null;
}
function ApplicationForm({
  record,
  company,
  opportunity,
  onClose,
  onSaved,
}: {
  record?: WorkRecord;
  company?: WorkRecord;
  opportunity?: Opportunity;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { records, preferences, create, update, pending, refresh } =
    useWorkspace();
  const [submitting, setSubmitting] = useState(false);
  const companies = records.filter((item) => item.kind === "company");
  const [form, setForm] = useState({
    company: record
      ? applicationCompany(record, records)
      : opportunity?.company || company?.title || "",
    companyId: field(record, "companyId") || company?.id || "",
    title: record?.title || opportunity?.title || "",
    status: record ? applicationStatusSelection(record) : "Applied",
    url: field(record, "url") || opportunity?.sources[0]?.url || "",
    applicationDate: record ? applicationDate(record) : "",
    location:
      field(record, "location") || opportunity?.locations.join(" · ") || "",
    notes:
      record?.body ||
      (opportunity
        ? [opportunity.notes, opportunity.description]
            .filter(Boolean)
            .join("\n\n")
        : ""),
    deadline: field(record, "deadline") || opportunity?.closingDate || "",
    followUp: field(record, "followUp"),
    contact: record ? applicationContact(record, records) : "",
  });
  const [error, setError] = useState("");
  const base: WorkRecord = record || {
    data: { processVersion: 2, recruitmentSteps: commonRecruitmentProcess() },
    title: form.title,
    id: "new",
    kind: "application",
    body: "",
    tags: [],
    links: [],
    version: 1,
    createdAt: "",
    updatedAt: "",
  };
  const statusOptions = applicationStatusOptions(base);
  function change(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      if (!form.company.trim() || !form.title.trim())
        throw new Error("Enter a company and role.");
      const chosenCompany = companies.find(
        (item) => item.id === form.companyId,
      );
      const transitioned =
        record && form.status === applicationStatusSelection(record)
          ? record.data
          : selectApplicationStatus(
              base,
              form.status,
              localDate(new Date(), preferences.timezone),
            );
      const data = ApplicationDataSchema.parse({
        ...transitioned,
        company: form.company.trim(),
        companyId: chosenCompany?.id || "",
        url: form.url.trim(),
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
      const saved =
        opportunity && !record
          ? (
              await request<{ record: WorkRecord }>(
                `/api/radar/opportunities/${opportunity.id}/application`,
                jsonRequest("POST", { kind: "application", ...input }),
              )
            ).record
          : record
            ? await update(record.id, input)
            : await create({ kind: "application", ...input });
      if (opportunity) await refresh();
      onSaved(saved.id);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <form className="stack" onSubmit={(event) => void save(event)}>
      {companies.length > 0 && (
        <Field
          label="Interested company"
          hint="Optional. Choosing a company links this application to its Interested entry."
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
                status: event.target.value,
                applicationDate:
                  event.target.value === "Saved"
                    ? ""
                    : current.applicationDate ||
                      (event.target.value === "Applied"
                        ? localDate(new Date(), preferences.timezone)
                        : ""),
              }))
            }
          >
            {!statusOptions.some((option) => option.value === form.status) && (
              <option value={form.status} disabled>
                {record ? applicationStatusLabel(record) : form.status}
              </option>
            )}
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
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
      <Field label="Listing link">
        <Input
          type="text"
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
        <NoteInput
          aria-label="Notes"
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
        <Button type="submit" disabled={!!pending || submitting}>
          {pending || submitting ? "Saving…" : "Save application"}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
