import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowUpRight, CalendarDays, Plus } from "lucide-react";
import {
  field,
  localDate,
  niceDate,
  type WorkRecord,
} from "../../../shared/model";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
} from "../../components/ui";
import { getDocumentLinks, webDestination } from "../assets/documentLinks";
import {
  associatedInterviews,
  interviewTime,
  InterviewEditor,
} from "./InterviewEditor";
import { errorMessage, transitionApplication } from "./domain";
import { useSavingWorkspace as useWorkspace } from "./useSaving";
import {
  applicationCompany,
  applicationContact,
  nextScheduledDate,
} from "./applicationRecords";
import "./applications.css";

export const APPLICATION_STAGES = [
  "Saved",
  "Applied",
  "Assessment",
  "Interview",
  "Offer",
  "Accepted",
  "Rejected",
  "Withdrawn",
];

export function ApplicationsPage() {
  const { records, preferences } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<WorkRecord | null | undefined>();
  const [interviewEditing, setInterviewEditing] = useState<
    WorkRecord | null | undefined
  >();
  const applications = records
    .filter((record) => record.kind === "application" && !record.deletedAt)
    .sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
    );
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
  const documents = getDocumentLinks(records, preferences);
  const interviews = selected ? associatedInterviews(records, selected.id) : [];
  const interviewOpen =
    interviewEditing !== undefined ||
    !!linkedInterview ||
    !!params.get("application");

  function closeInterview() {
    setInterviewEditing(undefined);
    const next = new URLSearchParams(params);
    next.delete("interview");
    next.delete("application");
    if (selected) next.set("record", selected.id);
    setParams(next, { replace: true });
  }

  return (
    <div className="page-stack applications-page">
      <PageHeader
        title="Applications"
        action={
          <Button onClick={() => setEditing(null)}>
            <Plus size={17} /> New application
          </Button>
        }
      />
      {!applications.length ? (
        <EmptyState
          title="No applications yet"
          action={
            <Button onClick={() => setEditing(null)}>New application</Button>
          }
        />
      ) : (
        <Card className="application-list">
          <div className="application-list-heading" aria-hidden="true">
            <span>Company / role</span>
            <span>Stage</span>
            <span>Next date</span>
            <span />
          </div>
          {applications.map((record) => {
            const nextDate = nextScheduledDate(
              record,
              records,
              preferences.timezone,
            );
            const vacancy = webDestination(field(record, "url"));
            return (
              <div className="application-list-row" key={record.id}>
                <button
                  className="application-open"
                  onClick={() => setParams({ record: record.id })}
                  aria-label={`Open ${record.title}`}
                >
                  <span className="application-company">
                    {applicationCompany(record, records)}
                  </span>
                  <strong>{record.title}</strong>
                </button>
                <Badge
                  tone={
                    field(record, "stage") === "Interview"
                      ? "pink"
                      : field(record, "stage") === "Offer"
                        ? "lime"
                        : "muted"
                  }
                >
                  {field(record, "stage", "Saved")}
                </Badge>
                <span
                  className={`application-next-date ${nextDate ? "" : "muted"}`}
                >
                  {nextDate ? niceDate(nextDate, preferences.timezone) : "—"}
                </span>
                {vacancy ? (
                  <a
                    className="application-vacancy"
                    href={vacancy}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Vacancy for ${record.title}`}
                  >
                    <ArrowUpRight size={19} />
                  </a>
                ) : (
                  <span />
                )}
              </div>
            );
          })}
        </Card>
      )}
      <Modal
        open={!!selected && editing === undefined && !interviewOpen}
        onClose={() => setParams({})}
        title={selected?.title || "Application"}
        size="wide"
      >
        {selected && (
          <div className="stack application-detail">
            <div className="section-heading">
              <div className="inline-actions">
                <strong>{applicationCompany(selected, records)}</strong>
                <Badge>{field(selected, "stage", "Saved")}</Badge>
              </div>
              <Button variant="ghost" onClick={() => setEditing(selected)}>
                Edit application
              </Button>
            </div>
            {webDestination(field(selected, "url")) && (
              <Destination url={field(selected, "url")} label="Vacancy" />
            )}
            {(field(selected, "deadline") || field(selected, "followUp")) && (
              <dl className="application-dates">
                {field(selected, "deadline") && (
                  <div>
                    <dt>Deadline</dt>
                    <dd>{niceDate(field(selected, "deadline"))}</dd>
                  </div>
                )}
                {field(selected, "followUp") && (
                  <div>
                    <dt>Follow-up</dt>
                    <dd>{niceDate(field(selected, "followUp"))}</dd>
                  </div>
                )}
              </dl>
            )}
            <section className="application-detail-section">
              <div className="section-heading">
                <h3>Interviews</h3>
                <Button
                  variant="secondary"
                  onClick={() => setInterviewEditing(null)}
                >
                  <Plus size={15} /> Schedule interview
                </Button>
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
                        {webDestination(field(record, "meetingUrl")) && (
                          <Destination
                            url={field(record, "meetingUrl")}
                            label="Meeting"
                          />
                        )}
                        {webDestination(field(record, "sourceUrl")) && (
                          <Destination
                            url={field(record, "sourceUrl")}
                            label="Source"
                          />
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
                <p className="muted">No interviews scheduled.</p>
              )}
            </section>
            <section className="application-detail-section">
              <h3>Documents</h3>
              <div className="application-document-links">
                {webDestination(
                  field(selected, "resumeUrl") || documents.resume.url,
                ) && (
                  <Destination
                    url={field(selected, "resumeUrl") || documents.resume.url}
                    label={`Résumé${field(selected, "resumeUrl") ? "" : " · default"}`}
                  />
                )}
                {webDestination(
                  field(selected, "coverLetterUrl") ||
                    documents.coverLetter.url,
                ) && (
                  <Destination
                    url={
                      field(selected, "coverLetterUrl") ||
                      documents.coverLetter.url
                    }
                    label={`Cover letter${field(selected, "coverLetterUrl") ? "" : " · default"}`}
                  />
                )}
                {!webDestination(
                  field(selected, "resumeUrl") || documents.resume.url,
                ) &&
                  !webDestination(
                    field(selected, "coverLetterUrl") ||
                      documents.coverLetter.url,
                  ) && (
                    <a href="/documents" className="external-link">
                      Add Overleaf links
                    </a>
                  )}
              </div>
            </section>
            {(applicationContact(selected, records) ||
              webDestination(field(selected, "notionUrl"))) && (
              <section className="application-detail-section">
                <h3>Contact & preparation</h3>
                {applicationContact(selected, records) && (
                  <p>{applicationContact(selected, records)}</p>
                )}
                {webDestination(field(selected, "notionUrl")) && (
                  <Destination
                    url={field(selected, "notionUrl")}
                    label="Preparation in Notion"
                  />
                )}
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
            key={`${editing?.id || "new"}:${editing?.version || 0}`}
            record={editing || undefined}
            onClose={() => setEditing(undefined)}
            onSaved={(id) => {
              setEditing(undefined);
              setParams({ record: id });
            }}
          />
        )}
      </Modal>
      <InterviewEditor
        open={interviewOpen}
        record={interviewEditing || linkedInterview}
        applicationId={selected?.id}
        onClose={closeInterview}
      />
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
      {label} <ArrowUpRight size={15} />
    </a>
  ) : null;
}

function ApplicationForm({
  record,
  onClose,
  onSaved,
}: {
  record?: WorkRecord;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { records, preferences, create, update, pending } = useWorkspace();
  const documents = getDocumentLinks(records, preferences);
  const [form, setForm] = useState({
    company: record ? applicationCompany(record, records) : "",
    title: record?.title || "",
    stage: field(record, "stage", "Saved"),
    url: field(record, "url"),
    deadline: field(record, "deadline"),
    followUp: field(record, "followUp"),
    resumeUrl: field(record, "resumeUrl"),
    coverLetterUrl: field(record, "coverLetterUrl"),
    notionUrl: field(record, "notionUrl"),
    contact: record ? applicationContact(record, records) : "",
  });
  const [error, setError] = useState("");
  const stages = [...new Set([...APPLICATION_STAGES, form.stage])];
  function change(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      for (const key of [
        "url",
        "resumeUrl",
        "coverLetterUrl",
        "notionUrl",
      ] as const) {
        if (form[key].trim() && !webDestination(form[key]))
          throw new Error(
            "Links must use http or https without embedded credentials.",
          );
      }
      const company = form.company.trim();
      const companyId =
        records.find(
          (item) =>
            item.kind === "company" &&
            !item.deletedAt &&
            item.title.toLowerCase() === company.toLowerCase(),
        )?.id || "";
      const title = form.title.trim();
      if (!company || !title) throw new Error("Enter a company and role.");
      const links = [
        ...new Set([
          ...(record?.links || []).filter(
            (id) => id !== field(record, "companyId"),
          ),
          ...(companyId ? [companyId] : []),
        ]),
      ];
      const data = {
        ...(record
          ? transitionApplication(record, form.stage)
          : {
              history: [
                {
                  stage: form.stage,
                  previous: "",
                  at: new Date().toISOString(),
                },
              ],
            }),
        company,
        companyId,
        stage: form.stage,
        url: webDestination(form.url),
        deadline: form.deadline,
        followUp: form.followUp,
        resumeUrl: webDestination(form.resumeUrl),
        coverLetterUrl: webDestination(form.coverLetterUrl),
        notionUrl: webDestination(form.notionUrl),
        contact: form.contact.trim(),
        ...(form.stage === "Applied" && !field(record, "submittedAt")
          ? { submittedAt: localDate(new Date(), preferences.timezone) }
          : {}),
      };
      const saved = record
        ? await update(record.id, { title, links, data })
        : await create({ kind: "application", title, links, data });
      onSaved(saved.id);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }

  return (
    <form className="stack" onSubmit={(event) => void save(event)}>
      <div className="form-grid">
        <Field label="Company">
          <Input
            required
            autoFocus
            value={form.company}
            maxLength={240}
            onChange={(event) => change("company", event.target.value)}
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
        <Field label="Stage">
          <Select
            value={form.stage}
            onChange={(event) => change("stage", event.target.value)}
          >
            {stages.map((stage) => (
              <option key={stage}>{stage}</option>
            ))}
          </Select>
        </Field>
        <Field label="Vacancy URL">
          <Input
            type="url"
            value={form.url}
            maxLength={2048}
            placeholder="Optional"
            onChange={(event) => change("url", event.target.value)}
          />
        </Field>
      </div>
      {record && (
        <details className="application-optional" open>
          <summary>Dates & links</summary>
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
            <Field
              label="Résumé URL"
              hint={
                documents.resume.url
                  ? "Leave blank to use the link in Documents."
                  : undefined
              }
            >
              <Input
                type="url"
                value={form.resumeUrl}
                maxLength={2048}
                placeholder="Default document"
                onChange={(event) => change("resumeUrl", event.target.value)}
              />
            </Field>
            <Field
              label="Cover letter URL"
              hint={
                documents.coverLetter.url
                  ? "Leave blank to use the link in Documents."
                  : undefined
              }
            >
              <Input
                type="url"
                value={form.coverLetterUrl}
                maxLength={2048}
                placeholder="Default document"
                onChange={(event) =>
                  change("coverLetterUrl", event.target.value)
                }
              />
            </Field>
            <Field label="Notion preparation URL">
              <Input
                type="url"
                value={form.notionUrl}
                maxLength={2048}
                placeholder="Optional"
                onChange={(event) => change("notionUrl", event.target.value)}
              />
            </Field>
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
      )}
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
