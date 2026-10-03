import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import {
  field,
  localDate,
  niceDate,
  recordUrl,
  safeUrl,
  type WorkRecord,
} from "../../../shared/model";
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
  RecordLinks,
  Select,
  Textarea,
} from "../../components/ui";
import { useSavingWorkspace as useWorkspace } from "./useSaving";
import { getAttachmentUrl } from "../../lib/api";
import {
  applicationCSV,
  assetVersions,
  captureAssetVersion,
  CAREER_PATHS,
  checklist,
  checklistFromText,
  errorMessage,
  exportText,
  pathLabel,
  relatedRecords,
  stageHistory,
  transitionApplication,
} from "./domain";
import "./search.css";

const blank = {
  title: "",
  body: "",
  companyId: "",
  stage: "Saved",
  location: "",
  path: "australia-transfer",
  url: "",
  requirements: "",
  deadline: "",
  workAuthorisation: "",
  compensation: "",
  submittedAt: "",
  followUp: "",
  nextAction: "",
  fit: "Unassessed",
  checklistText:
    "Read the job description\nMatch requirements to actual evidence\nChoose and attach a résumé version\nPrepare questions about the team",
  tags: "",
  links: [] as string[],
  assetIds: [] as string[],
  refreshAssets: false,
};

export function ApplicationsPage() {
  const {
    records,
    preferences,
    create,
    update,
    remove,
    notify,
    pending: pendingCount,
    savePreferences,
  } = useWorkspace();
  const pending = !!pendingCount;
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<"board" | "table">("table");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState({
    stage: "",
    company: "",
    geography: "",
    path: "",
    urgency: "",
    fit: "",
  });
  const [editing, setEditing] = useState<WorkRecord | null | undefined>();
  const [form, setForm] = useState(blank);
  const [stageEditor, setStageEditor] = useState(false);
  const [stageText, setStageText] = useState("");
  const applications = records.filter(
    (record) => record.kind === "application" && !record.deletedAt,
  );
  const companies = records.filter(
    (record) => record.kind === "company" && !record.deletedAt,
  );
  const assets = records.filter(
    (record) =>
      record.kind === "asset" &&
      !record.deletedAt &&
      ["resume", "cover-letter", "answer"].includes(field(record, "type")),
  );
  const selected = applications.find(
    (record) => record.id === params.get("record"),
  );
  const stages = [
    ...new Set([
      ...preferences.customStages,
      ...applications.map((record) => field(record, "stage", "Saved")),
    ]),
  ];
  const today = localDate(new Date(), preferences.timezone);
  const companyName = (record: WorkRecord) =>
    companies.find((company) => company.id === field(record, "companyId"))
      ?.title || "Company not linked";
  const filtered = applications.filter((record) => {
    const date = field(record, "deadline");
    const followUp = field(record, "followUp");
    const terminal = ["Rejected", "Withdrawn", "Accepted"].includes(
      field(record, "stage"),
    );
    const urgent =
      !terminal && ((date && date <= today) || (followUp && followUp <= today));
    return (
      `${record.title} ${companyName(record)} ${record.body} ${field(record, "requirements")}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (!filters.stage || field(record, "stage", "Saved") === filters.stage) &&
      (!filters.company || field(record, "companyId") === filters.company) &&
      (!filters.geography ||
        field(record, "location")
          .toLowerCase()
          .includes(filters.geography.toLowerCase())) &&
      (!filters.path || field(record, "path") === filters.path) &&
      (!filters.fit || field(record, "fit", "Unassessed") === filters.fit) &&
      (!filters.urgency || (filters.urgency === "due" ? urgent : !terminal))
    );
  });

  useEffect(() => {
    if (params.get("company")) setEditing(null);
  }, [params]);
  useEffect(() => {
    if (editing === undefined) return;
    const companyId = params.get("company") || "";
    setForm(
      editing
        ? {
            title: editing.title,
            body: editing.body,
            companyId: field(editing, "companyId"),
            stage: field(editing, "stage", "Saved"),
            location: field(editing, "location"),
            path: field(editing, "path", "australia-transfer"),
            url: field(editing, "url"),
            requirements: field(editing, "requirements"),
            deadline: field(editing, "deadline"),
            workAuthorisation: field(editing, "workAuthorisation"),
            compensation: field(editing, "compensation"),
            submittedAt: field(editing, "submittedAt"),
            followUp: field(editing, "followUp"),
            nextAction: field(editing, "nextAction"),
            fit: field(editing, "fit", "Unassessed"),
            checklistText: checklist(editing.data)
              .map((item) => item.text)
              .join("\n"),
            tags: editing.tags.join(", "),
            links: editing.links,
            assetIds: assetVersions(editing.data).map((asset) => asset.assetId),
            refreshAssets: false,
          }
        : {
            ...blank,
            stage: preferences.customStages[0] || "Saved",
            companyId,
            links: companyId ? [companyId] : [],
          },
    );
  }, [editing]);

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      const {
        title,
        body,
        tags,
        links,
        checklistText,
        assetIds,
        refreshAssets,
        ...values
      } = form;
      const captured = assetIds
        .map((id) => {
          const existing =
            editing &&
            assetVersions(editing.data).find((asset) => asset.assetId === id);
          const asset = assets.find((record) => record.id === id);
          return !refreshAssets && existing
            ? existing
            : asset
              ? captureAssetVersion(asset)
              : existing;
        })
        .filter((entry) => entry !== undefined);
      const data = {
        ...(editing
          ? transitionApplication(editing, values.stage)
          : {
              history: [
                {
                  stage: values.stage,
                  previous: "",
                  at: new Date().toISOString(),
                },
              ],
            }),
        ...values,
        checklist: checklistFromText(
          checklistText,
          editing ? checklist(editing.data) : [],
        ),
        assetVersions: captured,
        submittedAt:
          values.submittedAt || (values.stage === "Applied" ? today : ""),
      };
      const input = {
        title: title.trim(),
        body,
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        links: [
          ...new Set([
            ...links,
            ...assetIds,
            ...(values.companyId ? [values.companyId] : []),
          ]),
        ],
        data,
      };
      const saved = editing
        ? await update(editing.id, input)
        : await create({ kind: "application", ...input });
      setEditing(undefined);
      setParams({ record: saved.id });
      notify("Opportunity saved. Your next step is ready.", "success");
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }

  async function changeStage(record: WorkRecord, stage: string) {
    try {
      await update(record.id, { data: transitionApplication(record, stage) });
      notify(`Moved to ${stage}.`, "success");
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }
  async function togglePreparation(record: WorkRecord, id: string) {
    try {
      await update(record.id, {
        data: {
          ...record.data,
          checklist: checklist(record.data).map((item) =>
            item.id === id ? { ...item, done: !item.done } : item,
          ),
        },
      });
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }
  async function addAction(record: WorkRecord) {
    try {
      await create({
        kind: "action",
        title: field(record, "nextAction", `Follow up: ${record.title}`),
        links: [record.id, ...record.links],
        data: {
          status: "todo",
          estimatedMinutes: 15,
          dueDate: field(record, "followUp") || field(record, "deadline"),
          firstStep: `Open the ${record.title} opportunity and complete the next step.`,
          priority: "normal",
        },
      });
      notify("Added a linked action to Today.", "success");
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }
  async function saveStages(event: FormEvent) {
    event.preventDefault();
    const customStages = [
      ...new Set(
        stageText
          .split("\n")
          .map((stage) => stage.trim())
          .filter(Boolean),
      ),
    ];
    if (!customStages.length) return;
    try {
      await savePreferences({ customStages });
      setStageEditor(false);
      notify(
        "Pipeline stages updated. Existing stages stay visible while in use.",
        "success",
      );
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }
  const stageControl = (record: WorkRecord) => (
    <Select
      aria-label={`Stage for ${record.title}`}
      value={field(record, "stage", "Saved")}
      onChange={(event) => void changeStage(record, event.target.value)}
      disabled={pending}
    >
      {stages.map((stage) => (
        <option key={stage}>{stage}</option>
      ))}
    </Select>
  );

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="SEARCH / APPLICATIONS"
        title="Make your next move."
        description="Capture real vacancies, preserve the details, and make the next step obvious. Preparation never blocks an application."
        action={
          <Button onClick={() => setEditing(null)}>
            + Capture an opportunity
          </Button>
        }
      />
      <div className="stat-grid">
        <Card>
          <small className="muted">Saved opportunities</small>
          <h2>{applications.length}</h2>
        </Card>
        <Card>
          <small className="muted">Applied or progressing</small>
          <h2>
            {
              applications.filter((record) =>
                [
                  "Applied",
                  "Assessment",
                  "Interview",
                  "Offer",
                  "Accepted",
                ].includes(field(record, "stage")),
              ).length
            }
          </h2>
        </Card>
        <Card>
          <small className="muted">Interview stage</small>
          <h2>
            {
              applications.filter(
                (record) => field(record, "stage") === "Interview",
              ).length
            }
          </h2>
        </Card>
      </div>
      <div className="toolbar search-filters">
        <Input
          aria-label="Search opportunities"
          placeholder="Search roles, companies, requirements…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Select
          aria-label="Filter application stage"
          value={filters.stage}
          onChange={(event) =>
            setFilters({ ...filters, stage: event.target.value })
          }
        >
          <option value="">Every stage</option>
          {stages.map((stage) => (
            <option key={stage}>{stage}</option>
          ))}
        </Select>
        <Select
          aria-label="Filter application company"
          value={filters.company}
          onChange={(event) =>
            setFilters({ ...filters, company: event.target.value })
          }
        >
          <option value="">Every company</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.title}
            </option>
          ))}
        </Select>
        <Input
          aria-label="Filter application location"
          placeholder="Location"
          value={filters.geography}
          onChange={(event) =>
            setFilters({ ...filters, geography: event.target.value })
          }
        />
      </div>
      <div className="toolbar search-filters">
        <Select
          aria-label="Filter application path"
          value={filters.path}
          onChange={(event) =>
            setFilters({ ...filters, path: event.target.value })
          }
        >
          <option value="">Every career path</option>
          {CAREER_PATHS.map((path) => (
            <option key={path.value} value={path.value}>
              {path.label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filter urgency"
          value={filters.urgency}
          onChange={(event) =>
            setFilters({ ...filters, urgency: event.target.value })
          }
        >
          <option value="">Any urgency</option>
          <option value="due">Due / overdue</option>
          <option value="active">Active opportunities</option>
        </Select>
        <Select
          aria-label="Filter role fit"
          value={filters.fit}
          onChange={(event) =>
            setFilters({ ...filters, fit: event.target.value })
          }
        >
          <option value="">Any role fit</option>
          {["Unassessed", "Strong", "Partial", "Stretch"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </Select>
        <div className="inline-actions">
          <Button
            variant={view === "table" ? "primary" : "secondary"}
            onClick={() => setView("table")}
          >
            Table
          </Button>
          <Button
            variant={view === "board" ? "primary" : "secondary"}
            onClick={() => setView("board")}
          >
            Board
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setStageText(preferences.customStages.join("\n"));
              setStageEditor(true);
            }}
          >
            Stages
          </Button>
        </div>
      </div>
      <div className="section-heading">
        <small className="muted">
          {filtered.length} opportunities · companies are research targets until
          you capture a vacancy
        </small>
        <div className="inline-actions">
          <Button
            variant="ghost"
            onClick={() =>
              exportText(
                "work-applications.csv",
                applicationCSV(filtered, records),
                "text/csv;charset=utf-8",
              )
            }
          >
            Export CSV
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              exportText(
                "work-applications.json",
                JSON.stringify(filtered, null, 2),
                "application/json",
              )
            }
          >
            Export JSON
          </Button>
        </div>
      </div>
      {!filtered.length ? (
        <EmptyState
          title={
            applications.length
              ? "No opportunities match these filters."
              : "Your pipeline starts with one real role."
          }
          description="Paste a current vacancy URL and its description. Research targets are in Companies; no invented job openings are added here."
          action={
            <Button onClick={() => setEditing(null)}>
              Capture a real opportunity
            </Button>
          }
        />
      ) : view === "board" ? (
        <div
          className="application-board"
          aria-label="Application pipeline board"
        >
          {stages.map((stage) => (
            <section className="board-column" key={stage}>
              <h2>
                {stage}
                <Badge tone="orange">
                  {
                    filtered.filter(
                      (record) => field(record, "stage", "Saved") === stage,
                    ).length
                  }
                </Badge>
              </h2>
              {filtered
                .filter((record) => field(record, "stage", "Saved") === stage)
                .map((record) => (
                  <Card
                    key={record.id}
                    className={`application-card ${selected?.id === record.id ? "is-selected" : ""}`}
                  >
                    <button
                      className="record-title-button"
                      onClick={() => setParams({ record: record.id })}
                    >
                      {record.title} ↗
                    </button>
                    <p className="muted">
                      {companyName(record)} ·{" "}
                      {field(record, "location", "Location unknown")}
                    </p>
                    <p>{field(record, "nextAction", "Choose a next action")}</p>
                    {field(record, "deadline") && (
                      <Badge
                        tone={
                          field(record, "deadline") <= today ? "pink" : "muted"
                        }
                      >
                        Deadline {niceDate(field(record, "deadline"))}
                      </Badge>
                    )}
                    {stageControl(record)}
                  </Card>
                ))}
              {!filtered.some(
                (record) => field(record, "stage", "Saved") === stage,
              ) && <p className="board-empty">Nothing in this stage yet.</p>}
            </section>
          ))}
        </div>
      ) : (
        <Card className="table-wrap">
          <table className="pipeline-table">
            <thead>
              <tr>
                <th>Opportunity</th>
                <th>Company / location</th>
                <th>Stage</th>
                <th>Next action</th>
                <th>Dates</th>
                <th>Fit</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((record) => (
                <tr key={record.id}>
                  <td>
                    <button
                      className="record-title-button"
                      onClick={() => setParams({ record: record.id })}
                    >
                      {record.title}
                    </button>
                    <small className="muted">
                      {pathLabel(field(record, "path"))}
                    </small>
                  </td>
                  <td>
                    {companyName(record)}
                    <br />
                    <small className="muted">
                      {field(record, "location", "Unknown")}
                    </small>
                  </td>
                  <td>{stageControl(record)}</td>
                  <td>{field(record, "nextAction", "Set a next action")}</td>
                  <td>
                    {field(record, "deadline") && (
                      <div>Deadline: {niceDate(field(record, "deadline"))}</div>
                    )}
                    {field(record, "followUp") && (
                      <div>
                        Follow-up: {niceDate(field(record, "followUp"))}
                      </div>
                    )}
                    {!field(record, "deadline") &&
                      !field(record, "followUp") &&
                      "—"}
                  </td>
                  <td>
                    <Badge tone="muted">
                      {field(record, "fit", "Unassessed")}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {selected && (
        <Card className="detail-panel">
          <div className="section-heading">
            <Badge tone="orange">OPPORTUNITY WORKBENCH</Badge>
            <Button variant="ghost" onClick={() => setParams({})}>
              Close
            </Button>
          </div>
          <h2>{selected.title}</h2>
          <p className="muted">
            {companyName(selected)} ·{" "}
            {field(selected, "location", "Location unknown")}
          </p>
          <div className="inline-actions">
            {stageControl(selected)}
            <Button onClick={() => setEditing(selected)}>
              Edit opportunity
            </Button>
            {safeUrl(field(selected, "url")) && (
              <a
                className="external-link"
                href={safeUrl(field(selected, "url"))!}
                target="_blank"
                rel="noreferrer"
              >
                Original vacancy ↗
              </a>
            )}
            <Button variant="ghost" onClick={() => void addAction(selected)}>
              Add next step to Today
            </Button>
            <a
              className="external-link"
              href={`/interviews?application=${encodeURIComponent(selected.id)}`}
            >
              Schedule interview ↗
            </a>
          </div>
          <dl className="detail-facts">
            <div>
              <dt>Deadline</dt>
              <dd>{niceDate(field(selected, "deadline"))}</dd>
            </div>
            <div>
              <dt>Follow-up</dt>
              <dd>{niceDate(field(selected, "followUp"))}</dd>
            </div>
            <div>
              <dt>Submitted</dt>
              <dd>{niceDate(field(selected, "submittedAt"))}</dd>
            </div>
            <div>
              <dt>Work-authorisation wording</dt>
              <dd>
                {field(
                  selected,
                  "workAuthorisation",
                  "Not provided in the vacancy",
                )}
              </dd>
            </div>
            <div>
              <dt>Experience / requirements</dt>
              <dd>
                {field(selected, "requirements", "Add the actual requirements")}
              </dd>
            </div>
            <div>
              <dt>Compensation</dt>
              <dd>{field(selected, "compensation", "Unknown")}</dd>
            </div>
          </dl>
          <div className="next-action-callout">
            <strong>Your next step</strong>
            <p>
              {field(
                selected,
                "nextAction",
                "Choose a concrete step in Edit opportunity.",
              )}
            </p>
          </div>
          <div className="form-grid">
            <section className="stack">
              <h3>Role preparation</h3>
              <div className="checklist-items">
                {checklist(selected.data).map((item) => (
                  <label
                    key={item.id}
                    className={`checklist-row ${item.done ? "is-done" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={item.done}
                      disabled={pending}
                      onChange={() => void togglePreparation(selected, item.id)}
                    />
                    <span>{item.text}</span>
                  </label>
                ))}
              </div>
              <p className="muted">
                Link skill gaps, work evidence, interview stories, and notes
                below. You can apply at any time.
              </p>
              <div className="linked-record-list">
                {relatedRecords(selected, records)
                  .filter((record) => record.kind !== "asset")
                  .map((record) => (
                    <a key={record.id} href={recordUrl(record)}>
                      <Badge tone="muted">{record.kind}</Badge>
                      {record.title} ↗
                    </a>
                  ))}
              </div>
            </section>
            <section className="stack">
              <h3>Attached asset versions</h3>
              {assetVersions(selected.data).map((asset) => (
                <div
                  key={`${asset.assetId}-${asset.version}`}
                  className="snapshot-note"
                >
                  <strong>{asset.title}</strong>
                  <br />
                  {asset.label} · record v{asset.version} · captured{" "}
                  {niceDate(asset.capturedAt)}
                  <div className="inline-actions">
                    <a
                      href={`/assets?record=${encodeURIComponent(asset.assetId)}`}
                    >
                      Open asset ↗
                    </a>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        exportText(
                          `${asset.title}-v${asset.version}.md`,
                          asset.body,
                          "text/markdown",
                        )
                      }
                    >
                      Download captured text
                    </Button>
                    {asset.attachmentId && (
                      <Button
                        variant="ghost"
                        onClick={async () => {
                          try {
                            const url = await getAttachmentUrl(
                              asset.attachmentId!,
                            );
                            const anchor = document.createElement("a");
                            anchor.href = url;
                            anchor.download =
                              asset.attachmentName || "resume.pdf";
                            anchor.target = "_blank";
                            anchor.rel = "noopener";
                            anchor.click();
                          } catch (error) {
                            notify(errorMessage(error), "error");
                          }
                        }}
                      >
                        Download captured PDF
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {!assetVersions(selected.data).length && (
                <p className="muted">
                  Attach an exact résumé or letter version in Edit opportunity.
                  Later edits will not overwrite captured text.
                </p>
              )}
              <h3>Stage history</h3>
              <ol className="stage-timeline">
                {stageHistory(selected.data).map((event, index) => (
                  <li key={`${event.at}-${index}`}>
                    <span>
                      {event.previous ? `${event.previous} → ` : ""}
                      {event.stage}
                    </span>
                    <time dateTime={event.at}>
                      {niceDate(event.at, preferences.timezone)}
                    </time>
                  </li>
                ))}
              </ol>
            </section>
          </div>
          <h3>Job description snapshot & notes</h3>
          <Markdown
            content={
              selected.body ||
              "Paste the original description so you retain the requirements after the vacancy closes."
            }
          />
          <Button
            variant="danger"
            onClick={async () => {
              try {
                await remove(selected.id);
                setParams({});
                notify("Opportunity moved to trash.", "info");
              } catch (error) {
                notify(errorMessage(error), "error");
              }
            }}
          >
            Move to trash
          </Button>
        </Card>
      )}
      <Modal
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
        title={editing ? "Edit opportunity" : "Capture a real opportunity"}
        description="Use a vacancy URL or pasted details. Unknown requirements stay unknown."
        size="wide"
      >
        <form className="stack" onSubmit={save}>
          <div className="form-grid">
            <Field label="Role title">
              <Input
                required
                autoFocus
                maxLength={180}
                value={form.title}
                onChange={(event) =>
                  setForm({ ...form, title: event.target.value })
                }
                placeholder="Software Engineer, Backend"
              />
            </Field>
            <Field label="Company">
              <Select
                value={form.companyId}
                onChange={(event) =>
                  setForm({ ...form, companyId: event.target.value })
                }
              >
                <option value="">Not linked yet</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Vacancy URL">
              <Input
                type="url"
                value={form.url}
                onChange={(event) =>
                  setForm({ ...form, url: event.target.value })
                }
                placeholder="https://…"
              />
            </Field>
            <Field label="Location / working arrangement">
              <Input
                value={form.location}
                onChange={(event) =>
                  setForm({ ...form, location: event.target.value })
                }
                placeholder="Employer-stated location"
              />
            </Field>
            <Field label="Career path">
              <Select
                value={form.path}
                onChange={(event) =>
                  setForm({ ...form, path: event.target.value })
                }
              >
                {CAREER_PATHS.map((path) => (
                  <option key={path.value} value={path.value}>
                    {path.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Stage">
              <Select
                value={form.stage}
                onChange={(event) =>
                  setForm({ ...form, stage: event.target.value })
                }
              >
                {stages.map((stage) => (
                  <option key={stage}>{stage}</option>
                ))}
              </Select>
            </Field>
            <Field label="Date-only deadline">
              <Input
                type="date"
                value={form.deadline}
                onChange={(event) =>
                  setForm({ ...form, deadline: event.target.value })
                }
              />
            </Field>
            <Field label="Follow-up date">
              <Input
                type="date"
                value={form.followUp}
                onChange={(event) =>
                  setForm({ ...form, followUp: event.target.value })
                }
              />
            </Field>
            <Field label="Submission date">
              <Input
                type="date"
                value={form.submittedAt}
                onChange={(event) =>
                  setForm({ ...form, submittedAt: event.target.value })
                }
              />
            </Field>
            <Field label="Role fit">
              <Select
                value={form.fit}
                onChange={(event) =>
                  setForm({ ...form, fit: event.target.value })
                }
              >
                {["Unassessed", "Strong", "Partial", "Stretch"].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field
            label="Job description snapshot & notes"
            hint="Paste the original text. Markdown supported; no automatic scraping."
          >
            <Textarea
              rows={7}
              value={form.body}
              onChange={(event) =>
                setForm({ ...form, body: event.target.value })
              }
            />
          </Field>
          <div className="form-grid">
            <Field label="Experience / requirements">
              <Textarea
                rows={3}
                value={form.requirements}
                onChange={(event) =>
                  setForm({ ...form, requirements: event.target.value })
                }
              />
            </Field>
            <Field
              label="Work-authorisation wording"
              hint="Record the employer's actual wording, not assumed eligibility."
            >
              <Textarea
                rows={3}
                value={form.workAuthorisation}
                onChange={(event) =>
                  setForm({ ...form, workAuthorisation: event.target.value })
                }
              />
            </Field>
          </div>
          <Field label="Compensation, currency & source">
            <Input
              value={form.compensation}
              onChange={(event) =>
                setForm({ ...form, compensation: event.target.value })
              }
              placeholder="Unknown is fine"
            />
          </Field>
          <Field label="Next action">
            <Input
              value={form.nextAction}
              onChange={(event) =>
                setForm({ ...form, nextAction: event.target.value })
              }
              placeholder="A small concrete action"
            />
          </Field>
          <Field
            label="Role preparation checklist"
            hint="One item per line. Existing completed items keep their state."
          >
            <Textarea
              rows={4}
              value={form.checklistText}
              onChange={(event) =>
                setForm({ ...form, checklistText: event.target.value })
              }
            />
          </Field>
          <Field
            label="Exact résumé / letter / answer versions"
            hint="Selected assets are captured when you save. Captured text remains unchanged when the original asset is edited."
          >
            <div className="checklist-items">
              {assets.map((asset) => (
                <label className="checklist-row" key={asset.id}>
                  <input
                    type="checkbox"
                    checked={form.assetIds.includes(asset.id)}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        assetIds: event.target.checked
                          ? [...form.assetIds, asset.id]
                          : form.assetIds.filter((id) => id !== asset.id),
                      })
                    }
                  />
                  <span>
                    {asset.title} ·{" "}
                    {field(asset, "versionLabel", `v${asset.version}`)}
                    {editing &&
                    assetVersions(editing.data).some(
                      (version) => version.assetId === asset.id,
                    )
                      ? " · previously captured version retained"
                      : ""}
                  </span>
                </label>
              ))}
              {!assets.length && (
                <a href="/assets">
                  Create or upload your first résumé in Assets ↗
                </a>
              )}
              {editing && (
                <label className="checklist-row">
                  <input
                    type="checkbox"
                    checked={form.refreshAssets}
                    onChange={(event) =>
                      setForm({ ...form, refreshAssets: event.target.checked })
                    }
                  />
                  <span>
                    Replace previously captured versions with the current
                    selected assets
                  </span>
                </label>
              )}
            </div>
          </Field>
          <Field label="Tags">
            <Input
              value={form.tags}
              onChange={(event) =>
                setForm({ ...form, tags: event.target.value })
              }
              placeholder="Comma separated"
            />
          </Field>
          <RecordLinks
            value={form.links}
            onChange={(links) => setForm({ ...form, links })}
            excludeId={editing?.id}
          />
          <div className="inline-actions">
            <Button type="submit" disabled={pending || !form.title.trim()}>
              Save opportunity
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditing(undefined)}
            >
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={stageEditor}
        onClose={() => setStageEditor(false)}
        title="Your pipeline stages"
        description="One stage per line. Stages still used by existing opportunities remain visible."
      >
        <form className="stack" onSubmit={saveStages}>
          <Field label="Stages">
            <Textarea
              autoFocus
              rows={12}
              value={stageText}
              onChange={(event) => setStageText(event.target.value)}
            />
          </Field>
          <Button type="submit" disabled={pending || !stageText.trim()}>
            Save stages
          </Button>
        </form>
      </Modal>
    </div>
  );
}
