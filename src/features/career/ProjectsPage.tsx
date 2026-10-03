import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import {
  field,
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
import { downloadFile } from "../../lib/api";
import { errorMessage, relatedRecords } from "../search/domain";
import { useSavingWorkspace } from "../search/useSaving";
import {
  milestonesFromData,
  milestonesFromText,
  type Milestone,
} from "./domain";
import { safeFilename } from "../assets/domain";
import "./career.css";

const CASE_STUDY =
  "## The problem\n[Who needed what? What constraints mattered?]\n\n## My contribution\n[What did you personally build, investigate, or decide?]\n\n## Engineering decision\n[Describe one meaningful tradeoff and the alternatives.]\n\n## Implementation & validation\n[How did you make it work and verify it?]\n\n## Outcome & evidence\n[Use actual outcomes and links. Unknown measurements stay unknown.]\n\n## What I learned\n[What would you change or do next?]";
const blank = {
  title: "",
  body: "",
  scope: "",
  status: "Planned",
  technologies: "",
  repoUrl: "",
  demoUrl: "",
  nextAction: "",
  decision: "",
  caseStudy: "",
  milestoneText: "",
  tags: "",
  links: [] as string[],
};

export function ProjectsPage() {
  const { records, create, update, remove, notify, pending } =
    useSavingWorkspace();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<WorkRecord | null | undefined>();
  const [form, setForm] = useState(blank);
  const projects = records.filter(
    (record) => record.kind === "project" && !record.deletedAt,
  );
  const selected = projects.find(
    (record) => record.id === params.get("record"),
  );
  const filtered = projects.filter(
    (record) =>
      `${record.title} ${record.body} ${field(record, "scope")} ${field(record, "technologies")}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (!status || field(record, "status", "Planned") === status),
  );
  useEffect(() => {
    if (editing === undefined) return;
    setForm(
      editing
        ? {
            title: editing.title,
            body: editing.body,
            scope: field(editing, "scope"),
            status: field(editing, "status", "Planned"),
            technologies: field(editing, "technologies"),
            repoUrl: field(editing, "repoUrl"),
            demoUrl: field(editing, "demoUrl"),
            nextAction: field(editing, "nextAction"),
            decision: field(editing, "decision"),
            caseStudy: field(editing, "caseStudy"),
            milestoneText: milestonesFromData(editing.data)
              .map((item) => item.text)
              .join("\n"),
            tags: editing.tags.join(", "),
            links: editing.links,
          }
        : blank,
    );
  }, [editing]);
  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      const { title, body, tags, links, milestoneText, ...data } = form;
      const input = {
        title: title.trim(),
        body,
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        links,
        data: {
          ...editing?.data,
          ...data,
          milestones: milestonesFromText(
            milestoneText,
            editing ? milestonesFromData(editing.data) : [],
          ),
        },
      };
      const saved = editing
        ? await update(editing.id, input)
        : await create({ kind: "project", ...input });
      setEditing(undefined);
      setParams({ record: saved.id });
      notify(
        "Project saved. One small milestone is enough to start.",
        "success",
      );
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }
  async function changeMilestone(
    record: WorkRecord,
    id: string,
    patch: Partial<Milestone>,
  ) {
    try {
      await update(record.id, {
        data: {
          ...record.data,
          milestones: milestonesFromData(record.data).map((item) =>
            item.id === id ? { ...item, ...patch } : item,
          ),
        },
      });
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }
  async function addAction(record: WorkRecord, milestone?: Milestone) {
    try {
      await create({
        kind: "action",
        title:
          milestone?.text ||
          field(record, "nextAction", `Make progress on ${record.title}`),
        links: [record.id],
        data: {
          status: "todo",
          estimatedMinutes: 30,
          firstStep:
            "Open the project and make the next milestone smaller if needed.",
          dueDate: milestone?.dueDate || "",
          priority: "normal",
          category: "projects",
        },
      });
      notify("Project action added to Today.", "success");
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }
  async function createCaseStudy(record: WorkRecord) {
    try {
      const saved = await create({
        kind: "note",
        title: `${record.title} — case study`,
        body: field(record, "caseStudy") || CASE_STUDY,
        tags: [...record.tags, "case-study"],
        links: [record.id, ...record.links],
        data: { collection: "Project case studies" },
      });
      notify("Case-study note created and linked to the project.", "success");
      window.location.assign(recordUrl(saved));
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="CAREER / PROJECTS"
        title="Make something worth explaining"
        description="Plan small milestones, record engineering decisions, and turn the finished work into evidence you can discuss."
        action={
          <Button onClick={() => setEditing(null)}>+ Create a project</Button>
        }
      />
      <div className="toolbar">
        <Input
          aria-label="Search projects"
          placeholder="Search projects, scope, or technology…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Select
          aria-label="Filter project status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">Every status</option>
          {["Planned", "Active", "Paused", "Completed"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </Select>
        <Badge tone="blue">{projects.length} projects</Badge>
      </div>
      <div className="card-grid">
        {filtered.map((project) => {
          const milestones = milestonesFromData(project.data);
          const done = milestones.filter((item) => item.done).length;
          return (
            <Card className="stack" key={project.id}>
              <Badge
                tone={
                  field(project, "status") === "Completed" ? "lime" : "blue"
                }
              >
                {field(project, "status", "Planned")}
              </Badge>
              <button
                className="record-title-button"
                onClick={() => setParams({ record: project.id })}
              >
                {project.title} ↗
              </button>
              <p>{field(project, "scope") || project.body.slice(0, 160)}</p>
              <div className="project-progress">
                <progress
                  aria-label={`${project.title} milestones completed`}
                  value={done}
                  max={milestones.length || 1}
                />
                <small>
                  {done}/{milestones.length}
                </small>
              </div>
              <p className="muted">
                {field(project, "nextAction", "Choose one small next step.")}
              </p>
              <Button variant="ghost" onClick={() => setEditing(project)}>
                Edit project
              </Button>
            </Card>
          );
        })}
        {!filtered.length && (
          <EmptyState
            title={
              projects.length
                ? "No matching projects."
                : "Keep the next build small."
            }
            description="A useful project has a clear problem, a manageable scope, and an engineering decision you can explain."
            action={
              <Button onClick={() => setEditing(null)}>Plan a project</Button>
            }
          />
        )}
      </div>
      {selected && (
        <Card className="detail-panel">
          <div className="section-heading">
            <Badge tone="blue">PROJECT WORKBENCH</Badge>
            <Button variant="ghost" onClick={() => setParams({})}>
              Close
            </Button>
          </div>
          <h2>{selected.title}</h2>
          <p>{field(selected, "scope", "Define the scope in Edit project.")}</p>
          <div className="inline-actions">
            <Button onClick={() => setEditing(selected)}>Edit project</Button>
            <Button
              variant="secondary"
              onClick={() => void addAction(selected)}
            >
              Add next step to Today
            </Button>
            {safeUrl(field(selected, "repoUrl")) && (
              <a
                className="external-link"
                href={safeUrl(field(selected, "repoUrl"))!}
                target="_blank"
                rel="noreferrer"
              >
                Repository ↗
              </a>
            )}
            {safeUrl(field(selected, "demoUrl")) && (
              <a
                className="external-link"
                href={safeUrl(field(selected, "demoUrl"))!}
                target="_blank"
                rel="noreferrer"
              >
                Demo ↗
              </a>
            )}
          </div>
          <h3>Milestones</h3>
          <div className="stack">
            {milestonesFromData(selected.data).map((milestone) => (
              <div className="review-carry-row" key={milestone.id}>
                <label
                  className={`checklist-row ${milestone.done ? "is-done" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={milestone.done}
                    disabled={!!pending}
                    onChange={() =>
                      void changeMilestone(selected, milestone.id, {
                        done: !milestone.done,
                      })
                    }
                  />
                  <span>{milestone.text}</span>
                </label>
                <div className="inline-actions">
                  <Input
                    type="date"
                    aria-label={`Due date for ${milestone.text}`}
                    value={milestone.dueDate}
                    disabled={!!pending}
                    onChange={(event) =>
                      void changeMilestone(selected, milestone.id, {
                        dueDate: event.target.value,
                      })
                    }
                  />
                  <Button
                    variant="ghost"
                    onClick={() => void addAction(selected, milestone)}
                  >
                    To Today
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <h3>Engineering decisions</h3>
          <Markdown
            content={field(
              selected,
              "decision",
              "Capture a tradeoff, alternatives, and why you chose the implementation.",
            )}
          />
          <h3>Project notes</h3>
          <Markdown content={selected.body} />
          <h3>Case study</h3>
          <Markdown
            content={field(
              selected,
              "caseStudy",
              "Use the case-study template in Edit project or create a linked note below.",
            )}
          />
          <div className="inline-actions">
            <Button
              variant="secondary"
              onClick={() => void createCaseStudy(selected)}
            >
              Create a case-study note
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                downloadFile(
                  `# ${selected.title}\n\n${field(selected, "caseStudy") || CASE_STUDY}`,
                  `${safeFilename(selected.title)}-case-study.md`,
                  "text/markdown",
                )
              }
            >
              Export case study
            </Button>
          </div>
          <h3>Related evidence, skills & stories</h3>
          <div className="linked-record-list">
            {relatedRecords(selected, records).map((record) => (
              <a key={record.id} href={recordUrl(record)}>
                <Badge tone="muted">{record.kind}</Badge>
                {record.title} ↗
              </a>
            ))}
          </div>
          <Button
            variant="danger"
            onClick={async () => {
              try {
                await remove(selected.id);
                setParams({});
                notify("Project moved to trash.", "info");
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
        title={editing ? "Edit project" : "Plan a project"}
        size="wide"
      >
        <form className="stack" onSubmit={save}>
          <div className="form-grid">
            <Field label="Project name">
              <Input
                autoFocus
                required
                value={form.title}
                onChange={(event) =>
                  setForm({ ...form, title: event.target.value })
                }
              />
            </Field>
            <Field label="Status">
              <Select
                value={form.status}
                onChange={(event) =>
                  setForm({ ...form, status: event.target.value })
                }
              >
                {["Planned", "Active", "Paused", "Completed"].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Scope / problem to solve">
            <Textarea
              rows={3}
              value={form.scope}
              onChange={(event) =>
                setForm({ ...form, scope: event.target.value })
              }
            />
          </Field>
          <Field
            label="Milestones"
            hint="One small outcome per line. Completed milestones keep their state when you edit."
          >
            <Textarea
              rows={5}
              value={form.milestoneText}
              onChange={(event) =>
                setForm({ ...form, milestoneText: event.target.value })
              }
              placeholder="Build the smallest working version\nVerify it with a real use case\nWrite up one engineering decision"
            />
          </Field>
          <div className="form-grid">
            <Field label="Technologies">
              <Input
                value={form.technologies}
                onChange={(event) =>
                  setForm({ ...form, technologies: event.target.value })
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
            <Field label="Repository URL">
              <Input
                type="url"
                value={form.repoUrl}
                onChange={(event) =>
                  setForm({ ...form, repoUrl: event.target.value })
                }
              />
            </Field>
            <Field label="Demo URL">
              <Input
                type="url"
                value={form.demoUrl}
                onChange={(event) =>
                  setForm({ ...form, demoUrl: event.target.value })
                }
              />
            </Field>
          </div>
          <Field label="Engineering decisions / tradeoffs">
            <Textarea
              rows={4}
              value={form.decision}
              onChange={(event) =>
                setForm({ ...form, decision: event.target.value })
              }
            />
          </Field>
          <Field label="Notes">
            <Textarea
              rows={4}
              value={form.body}
              onChange={(event) =>
                setForm({ ...form, body: event.target.value })
              }
            />
          </Field>
          <div className="section-heading">
            <h3>Reusable case study</h3>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setForm({ ...form, caseStudy: CASE_STUDY })}
            >
              Use template
            </Button>
          </div>
          <Field
            label="Case study"
            hint="Explain actual work. The template provides prompts without inventing claims."
          >
            <Textarea
              rows={10}
              value={form.caseStudy}
              onChange={(event) =>
                setForm({ ...form, caseStudy: event.target.value })
              }
            />
          </Field>
          <Field label="Tags">
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
            <Button type="submit" disabled={!!pending || !form.title.trim()}>
              Save project
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
