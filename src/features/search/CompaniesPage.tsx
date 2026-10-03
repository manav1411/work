import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import {
  field,
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
import {
  CAREER_PATHS,
  errorMessage,
  normalizePath,
  pathLabel,
  relatedRecords,
} from "./domain";
import "./search.css";

const blank = {
  title: "",
  body: "",
  location: "",
  path: "australia-transfer",
  priority: "Medium",
  engineeringInterests: "",
  hiringUrl: "",
  source: "",
  checkedAt: "",
  confidence: "Unverified",
  nextQuestion: "",
  nextAction: "",
  tags: "",
  links: [] as string[],
};

export function CompaniesPage() {
  const {
    records,
    create,
    update,
    remove,
    notify,
    pending: pendingCount,
  } = useWorkspace();
  const pending = !!pendingCount;
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [path, setPath] = useState("");
  const [editing, setEditing] = useState<WorkRecord | null | undefined>(
    undefined,
  );
  const [form, setForm] = useState(blank);
  const companies = records.filter(
    (record) => record.kind === "company" && !record.deletedAt,
  );
  const selected = companies.find(
    (record) => record.id === params.get("record"),
  );
  const filtered = companies.filter(
    (record) =>
      (!path || field(record, "path") === path) &&
      `${record.title} ${record.body} ${field(record, "location")} ${record.tags.join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );

  useEffect(() => {
    if (editing === undefined) return;
    setForm(
      editing
        ? {
            title: editing.title,
            body: editing.body,
            location: field(editing, "location"),
            path: normalizePath(field(editing, "path", "australia-transfer")),
            priority: field(editing, "priority", "Medium"),
            engineeringInterests: field(editing, "engineeringInterests"),
            hiringUrl: field(editing, "hiringUrl", field(editing, "website")),
            source: field(editing, "source"),
            checkedAt: field(
              editing,
              "checkedAt",
              field(editing, "verifiedDate"),
            ),
            confidence: field(editing, "confidence", "Unverified"),
            nextQuestion: field(editing, "nextQuestion"),
            nextAction: field(editing, "nextAction"),
            tags: editing.tags.join(", "),
            links: editing.links,
          }
        : blank,
    );
  }, [editing]);

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      const { title, body, tags, links, ...data } = form;
      const input = {
        title: title.trim(),
        body,
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        links,
        data: { ...editing?.data, ...data },
      };
      const saved = editing
        ? await update(editing.id, input)
        : await create({ kind: "company", ...input });
      setEditing(undefined);
      setParams({ record: saved.id });
      notify("Company research saved.", "success");
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }

  async function trash(record: WorkRecord) {
    try {
      await remove(record.id);
      setParams({});
      notify("Company moved to trash. Restore it in Settings.", "info");
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="SEARCH / COMPANIES"
        title="Aim somewhere great."
        description="Research the teams, engineering work, and routes that matter to you. Every claim has a source and a date."
        action={
          <Button onClick={() => setEditing(null)}>+ Research a company</Button>
        }
      />
      <div className="toolbar">
        <Input
          aria-label="Search companies"
          placeholder="Find a company, location, or research note…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Select
          aria-label="Filter company career path"
          value={path}
          onChange={(event) => setPath(event.target.value)}
        >
          <option value="">Every career path</option>
          {CAREER_PATHS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </Select>
        <Badge tone="orange">{companies.length} research targets</Badge>
      </div>
      <div className={selected ? "split-layout" : "search-full-width"}>
        <div className={selected ? "stack" : "card-grid search-card-grid"}>
          {filtered.map((company) => (
            <Card
              key={company.id}
              className={`company-card ${selected?.id === company.id ? "is-selected" : ""}`}
            >
              <div className="section-heading">
                <Badge
                  tone={
                    field(company, "priority") === "High" ? "pink" : "muted"
                  }
                >
                  {field(company, "priority", "Medium")} priority
                </Badge>
                <Badge tone="blue">Research target</Badge>
              </div>
              <button
                className="record-title-button"
                onClick={() => setParams({ record: company.id })}
              >
                {company.title}
                <span aria-hidden="true">↗</span>
              </button>
              <p className="muted">
                {field(company, "location", "Location to research")}
              </p>
              <p className="search-path">{pathLabel(field(company, "path"))}</p>
              <p>
                {field(
                  company,
                  "nextAction",
                  "Choose one concrete research question to answer next.",
                )}
              </p>
              <div className="section-heading">
                <small className="muted">
                  {field(company, "checkedAt")
                    ? `Checked ${niceDate(field(company, "checkedAt"))}`
                    : "Research not checked yet"}
                </small>
                <Button variant="ghost" onClick={() => setEditing(company)}>
                  Edit
                </Button>
              </div>
            </Card>
          ))}
          {!filtered.length && (
            <EmptyState
              title={
                companies.length
                  ? "No matching companies."
                  : "Build your target list."
              }
              description="A company here is a research target. Actual vacancies belong in Applications, with the original job description."
              action={
                <Button onClick={() => setEditing(null)}>
                  Research your first company
                </Button>
              }
            />
          )}
        </div>
        {selected && (
          <Card className="detail-panel">
            <div className="section-heading">
              <Badge tone="orange">COMPANY RESEARCH</Badge>
              <Button variant="ghost" onClick={() => setParams({})}>
                Close
              </Button>
            </div>
            <h2>{selected.title}</h2>
            <p>
              {field(
                selected,
                "engineeringInterests",
                "Add the teams and engineering work you want to understand.",
              )}
            </p>
            <dl className="detail-facts">
              <div>
                <dt>Location</dt>
                <dd>{field(selected, "location", "Unknown")}</dd>
              </div>
              <div>
                <dt>Path</dt>
                <dd>{pathLabel(field(selected, "path"))}</dd>
              </div>
              <div>
                <dt>Confidence</dt>
                <dd>{field(selected, "confidence", "Unverified")}</dd>
              </div>
              <div>
                <dt>Last checked</dt>
                <dd>{niceDate(field(selected, "checkedAt"))}</dd>
              </div>
            </dl>
            <div className="inline-actions">
              {safeUrl(field(selected, "hiringUrl")) && (
                <a
                  className="external-link"
                  href={safeUrl(field(selected, "hiringUrl"))!}
                  target="_blank"
                  rel="noreferrer"
                >
                  Hiring page ↗
                </a>
              )}
              {safeUrl(field(selected, "source")) && (
                <a
                  className="external-link"
                  href={safeUrl(field(selected, "source"))!}
                  target="_blank"
                  rel="noreferrer"
                >
                  Research source ↗
                </a>
              )}
            </div>
            <h3>Research notes</h3>
            <Markdown
              content={
                selected.body ||
                "Capture current research here. Record original sources for employer policy and hiring information."
              }
            />
            <div className="next-action-callout">
              <strong>Next question</strong>
              <p>
                {field(
                  selected,
                  "nextQuestion",
                  "What would you need to know before committing to this path?",
                )}
              </p>
              <strong>Next action</strong>
              <p>{field(selected, "nextAction", "Set a small next step.")}</p>
            </div>
            <h3>Connected work</h3>
            <div className="linked-record-list">
              {relatedRecords(selected, records).map((record) => (
                <a key={record.id} href={recordUrl(record)}>
                  <Badge tone="muted">{record.kind}</Badge>
                  {record.title} ↗
                </a>
              ))}
              {!relatedRecords(selected, records).length && (
                <p className="muted">
                  Link contacts, notes, career paths, or applications when you
                  edit.
                </p>
              )}
            </div>
            <div className="inline-actions">
              <Button onClick={() => setEditing(selected)}>
                Edit research
              </Button>
              <a
                className="external-link"
                href={`/applications?company=${encodeURIComponent(selected.id)}`}
              >
                Capture a vacancy ↗
              </a>
              <Button variant="danger" onClick={() => void trash(selected)}>
                Move to trash
              </Button>
            </div>
          </Card>
        )}
      </div>
      <Modal
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
        title={editing ? "Edit company research" : "Research a company"}
        description="Keep historical notes separate from current, verified information."
        size="wide"
      >
        <form className="stack" onSubmit={save}>
          <div className="form-grid">
            <Field label="Company name">
              <Input
                autoFocus
                required
                maxLength={180}
                value={form.title}
                onChange={(event) =>
                  setForm({ ...form, title: event.target.value })
                }
                placeholder="Company or team"
              />
            </Field>
            <Field label="Location / relevant teams">
              <Input
                value={form.location}
                onChange={(event) =>
                  setForm({ ...form, location: event.target.value })
                }
                placeholder="Melbourne, Sydney, Bay Area…"
              />
            </Field>
            <Field label="Career path">
              <Select
                value={form.path}
                onChange={(event) =>
                  setForm({ ...form, path: event.target.value })
                }
              >
                {CAREER_PATHS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Priority">
              <Select
                value={form.priority}
                onChange={(event) =>
                  setForm({ ...form, priority: event.target.value })
                }
              >
                {["High", "Medium", "Low"].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </Select>
            </Field>
            <Field label="Hiring page">
              <Input
                type="url"
                value={form.hiringUrl}
                onChange={(event) =>
                  setForm({ ...form, hiringUrl: event.target.value })
                }
                placeholder="https://…"
              />
            </Field>
            <Field
              label="Research source"
              hint="Source URL or a specific reference"
            >
              <Input
                value={form.source}
                onChange={(event) =>
                  setForm({ ...form, source: event.target.value })
                }
                placeholder="Original employer information"
              />
            </Field>
            <Field label="Date checked">
              <Input
                type="date"
                value={form.checkedAt}
                onChange={(event) =>
                  setForm({ ...form, checkedAt: event.target.value })
                }
              />
            </Field>
            <Field label="Confidence">
              <Select
                value={form.confidence}
                onChange={(event) =>
                  setForm({ ...form, confidence: event.target.value })
                }
              >
                {[
                  "Unverified",
                  "Employer-stated",
                  "Contact-confirmed",
                  "Historical / needs review",
                ].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Engineering interests">
            <Input
              value={form.engineeringInterests}
              onChange={(event) =>
                setForm({ ...form, engineeringInterests: event.target.value })
              }
              placeholder="Teams, production ownership, mentorship, technical depth"
            />
          </Field>
          <Field
            label="Research notes"
            hint="Markdown supported. Keep policy uncertainties explicit."
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
            <Field label="Next question">
              <Input
                value={form.nextQuestion}
                onChange={(event) =>
                  setForm({ ...form, nextQuestion: event.target.value })
                }
              />
            </Field>
            <Field label="Next action">
              <Input
                value={form.nextAction}
                onChange={(event) =>
                  setForm({ ...form, nextAction: event.target.value })
                }
              />
            </Field>
          </div>
          <Field label="Tags" hint="Comma separated">
            <Input
              value={form.tags}
              onChange={(event) =>
                setForm({ ...form, tags: event.target.value })
              }
            />
          </Field>
          <RecordLinks
            value={form.links}
            onChange={(links) => setForm({ ...form, links })}
            excludeId={editing?.id}
          />
          <div className="inline-actions">
            <Button type="submit" disabled={pending || !form.title.trim()}>
              Save company
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
    </div>
  );
}
