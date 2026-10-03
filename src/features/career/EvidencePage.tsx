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
import { errorMessage, relatedRecords } from "../search/domain";
import { useSavingWorkspace } from "../search/useSaving";
import { evidenceBullet, evidenceStory } from "./domain";
import "./career.css";

const blank = {
  title: "",
  body: "",
  date: "",
  situation: "",
  task: "",
  contribution: "",
  outcome: "",
  scope: "",
  technologies: "",
  feedback: "",
  evidence: "",
  reflection: "",
  verified: false,
  tags: "",
  links: [] as string[],
};

export function EvidencePage() {
  const { records, preferences, create, update, remove, notify, pending } =
    useSavingWorkspace();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [verification, setVerification] = useState("");
  const [editing, setEditing] = useState<WorkRecord | null | undefined>();
  const [form, setForm] = useState(blank);
  const achievements = records.filter(
    (record) => record.kind === "achievement" && !record.deletedAt,
  );
  const selected = achievements.find(
    (record) => record.id === params.get("record"),
  );
  const filtered = achievements.filter(
    (record) =>
      `${record.title} ${record.body} ${field(record, "contribution")} ${field(record, "technologies")} ${record.tags.join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (!verification ||
        (verification === "checked"
          ? record.data.verified === true
          : record.data.verified !== true)),
  );

  useEffect(() => {
    if (editing === undefined) return;
    setForm(
      editing
        ? {
            title: editing.title,
            body: editing.body,
            date: field(editing, "date", editing.createdAt.slice(0, 10)),
            situation: field(editing, "situation"),
            task: field(editing, "task"),
            contribution: field(editing, "contribution"),
            outcome: field(editing, "outcome", field(editing, "impact")),
            scope: field(editing, "scope"),
            technologies: field(
              editing,
              "technologies",
              field(editing, "technology"),
            ),
            feedback: field(editing, "feedback"),
            evidence: field(editing, "evidence"),
            reflection: field(editing, "reflection"),
            verified: editing.data.verified === true,
            tags: editing.tags.join(", "),
            links: editing.links,
          }
        : { ...blank, date: localDate(new Date(), preferences.timezone) },
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
        data: { ...editing?.data, ...data, impact: data.outcome },
      };
      const saved = editing
        ? await update(editing.id, input)
        : await create({ kind: "achievement", ...input });
      setEditing(undefined);
      setParams({ record: saved.id });
      notify("Work evidence captured. Reuse it when you are ready.", "success");
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }
  async function reuse(record: WorkRecord, target: "story" | "bullet") {
    try {
      const saved = await create(
        target === "story" ? evidenceStory(record) : evidenceBullet(record),
      );
      notify(
        target === "story"
          ? "Behavioural story draft created from your evidence."
          : "Résumé bullet draft created from your evidence.",
        "success",
      );
      window.location.assign(recordUrl(saved));
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="CAREER / WORK EVIDENCE"
        title="Remember what you made better"
        description="A quick record of your contribution becomes a stronger story, résumé bullet, and career decision later."
        action={
          <Button onClick={() => setEditing(null)}>
            + Capture an achievement
          </Button>
        }
      />
      <Card className="evidence-kind-actions">
        <strong>Start with one sentence.</strong>
        <p>
          What changed? What did you personally do? What actually happened?
          Measurements are useful when you have evidence; an honest qualitative
          outcome works too.
        </p>
      </Card>
      <div className="toolbar">
        <Input
          aria-label="Search work evidence"
          placeholder="Search contributions, technologies, or outcomes…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Select
          aria-label="Filter evidence verification"
          value={verification}
          onChange={(event) => setVerification(event.target.value)}
        >
          <option value="">All evidence</option>
          <option value="checked">Evidence checked</option>
          <option value="draft">Drafts to verify</option>
        </Select>
        <Badge tone="lime">{achievements.length} achievements</Badge>
      </div>
      <div className="card-grid">
        {filtered.map((record) => (
          <Card className="evidence-card" key={record.id}>
            <div className="section-heading">
              <Badge tone={record.data.verified === true ? "lime" : "orange"}>
                {record.data.verified === true
                  ? "Evidence checked"
                  : "Draft — verify claims"}
              </Badge>
              <small className="muted">
                {niceDate(field(record, "date", record.createdAt))}
              </small>
            </div>
            <button
              className="record-title-button"
              onClick={() => setParams({ record: record.id })}
            >
              {record.title} ↗
            </button>
            <p>{field(record, "contribution") || record.body.slice(0, 180)}</p>
            <p className="muted">
              {field(
                record,
                "outcome",
                field(
                  record,
                  "impact",
                  "Add an actual outcome when you know it.",
                ),
              )}
            </p>
            <div className="chips">
              {record.tags.map((tag) => (
                <Badge key={tag} tone="blue">
                  {tag}
                </Badge>
              ))}
            </div>
            <Button variant="ghost" onClick={() => setEditing(record)}>
              Edit achievement
            </Button>
          </Card>
        ))}
        {!filtered.length && (
          <EmptyState
            title={
              achievements.length
                ? "No matching evidence."
                : "Capture something you contributed."
            }
            description="Shipping, debugging, testing, security improvements, collaboration, and useful feedback all count when the contribution is clear."
            action={
              <Button onClick={() => setEditing(null)}>
                Capture one achievement
              </Button>
            }
          />
        )}
      </div>
      {selected && (
        <Card className="detail-panel">
          <div className="section-heading">
            <Badge tone="lime">EVIDENCE WORKBENCH</Badge>
            <Button variant="ghost" onClick={() => setParams({})}>
              Close
            </Button>
          </div>
          <h2>{selected.title}</h2>
          <Badge tone={selected.data.verified === true ? "lime" : "orange"}>
            {selected.data.verified === true
              ? "Claims checked against evidence"
              : "Draft claims — verify before using"}
          </Badge>
          <dl className="detail-facts">
            {[
              ["situation", "Context / problem"],
              ["task", "Your responsibility"],
              ["contribution", "Your actual contribution"],
              ["outcome", "Actual outcome / impact"],
              ["scope", "Scope"],
              ["technologies", "Technologies"],
              ["feedback", "Feedback"],
              ["reflection", "What you learned"],
            ].map(([key, title]) => (
              <div key={key}>
                <dt>{title}</dt>
                <dd className="preserve-lines">
                  {field(
                    selected,
                    key,
                    key === "outcome"
                      ? field(selected, "impact", "Not recorded")
                      : "Not recorded",
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <Markdown content={selected.body} />
          <h3>Evidence sources</h3>
          <div className="stack">
            {field(selected, "evidence")
              .split("\n")
              .filter(Boolean)
              .map((line, index) =>
                safeUrl(line) ? (
                  <a
                    key={index}
                    className="external-link"
                    href={safeUrl(line)!}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {line} ↗
                  </a>
                ) : (
                  <p key={index}>{line}</p>
                ),
              )}
          </div>
          <div className="evidence-kind-actions">
            <strong>Reuse the same evidence</strong>
            <p>
              These actions make editable drafts and preserve the link to this
              achievement.
            </p>
            <div className="inline-actions">
              <Button
                disabled={!!pending}
                onClick={() => void reuse(selected, "story")}
              >
                Create a behavioural story
              </Button>
              <Button
                disabled={!!pending}
                variant="secondary"
                onClick={() => void reuse(selected, "bullet")}
              >
                Create a résumé bullet
              </Button>
            </div>
          </div>
          <h3>Related stories, assets & projects</h3>
          <div className="linked-record-list">
            {relatedRecords(selected, records).map((record) => (
              <a key={record.id} href={recordUrl(record)}>
                <Badge tone="muted">{record.kind}</Badge>
                {record.title} ↗
              </a>
            ))}
          </div>
          <div className="inline-actions">
            <Button onClick={() => setEditing(selected)}>Edit evidence</Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  await remove(selected.id);
                  setParams({});
                  notify("Achievement moved to trash.", "info");
                } catch (error) {
                  notify(errorMessage(error), "error");
                }
              }}
            >
              Move to trash
            </Button>
          </div>
        </Card>
      )}
      <Modal
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
        title={editing ? "Edit work evidence" : "Capture an achievement"}
        description="No polished story required. Save a useful first sentence now."
        size="wide"
      >
        <form className="stack" onSubmit={save}>
          <div className="form-grid">
            <Field label="What changed?">
              <Input
                autoFocus
                required
                value={form.title}
                onChange={(event) =>
                  setForm({ ...form, title: event.target.value })
                }
                placeholder="A concrete change or problem you worked on"
              />
            </Field>
            <Field label="When">
              <Input
                type="date"
                value={form.date}
                onChange={(event) =>
                  setForm({ ...form, date: event.target.value })
                }
              />
            </Field>
          </div>
          <Field label="Your contribution">
            <Textarea
              rows={3}
              value={form.contribution}
              onChange={(event) =>
                setForm({ ...form, contribution: event.target.value })
              }
              placeholder="What you personally implemented, investigated, decided, tested, or improved"
            />
          </Field>
          <Field
            label="Actual outcome / impact"
            hint="Include a measurement only if you can support it. Unknown outcomes can be completed later."
          >
            <Textarea
              rows={3}
              value={form.outcome}
              onChange={(event) =>
                setForm({ ...form, outcome: event.target.value })
              }
            />
          </Field>
          <details>
            <summary>Add context and detail</summary>
            <div className="stack">
              <div className="form-grid">
                <Field label="Context / problem">
                  <Textarea
                    rows={3}
                    value={form.situation}
                    onChange={(event) =>
                      setForm({ ...form, situation: event.target.value })
                    }
                  />
                </Field>
                <Field label="Your responsibility">
                  <Textarea
                    rows={3}
                    value={form.task}
                    onChange={(event) =>
                      setForm({ ...form, task: event.target.value })
                    }
                  />
                </Field>
                <Field label="Scope">
                  <Input
                    value={form.scope}
                    onChange={(event) =>
                      setForm({ ...form, scope: event.target.value })
                    }
                  />
                </Field>
                <Field label="Technologies">
                  <Input
                    value={form.technologies}
                    onChange={(event) =>
                      setForm({ ...form, technologies: event.target.value })
                    }
                  />
                </Field>
              </div>
              <Field label="Actual feedback">
                <Textarea
                  rows={3}
                  value={form.feedback}
                  onChange={(event) =>
                    setForm({ ...form, feedback: event.target.value })
                  }
                />
              </Field>
              <Field label="Reflection / what you learned">
                <Textarea
                  rows={3}
                  value={form.reflection}
                  onChange={(event) =>
                    setForm({ ...form, reflection: event.target.value })
                  }
                />
              </Field>
              <Field label="Additional notes">
                <Textarea
                  rows={4}
                  value={form.body}
                  onChange={(event) =>
                    setForm({ ...form, body: event.target.value })
                  }
                />
              </Field>
            </div>
          </details>
          <Field
            label="Evidence links or references"
            hint="One source per line. Capture a relevant artifact, feedback, or measurement source."
          >
            <Textarea
              rows={3}
              value={form.evidence}
              onChange={(event) =>
                setForm({ ...form, evidence: event.target.value })
              }
            />
          </Field>
          <label className="checklist-row">
            <input
              type="checkbox"
              checked={form.verified}
              onChange={(event) =>
                setForm({ ...form, verified: event.target.checked })
              }
            />
            <span>I have checked these claims against the evidence.</span>
          </label>
          <Field label="Competency / technology tags">
            <Input
              value={form.tags}
              onChange={(event) =>
                setForm({ ...form, tags: event.target.value })
              }
              placeholder="ownership, debugging, backend"
            />
          </Field>
          <RecordLinks
            value={form.links}
            onChange={(links) => setForm({ ...form, links })}
            excludeId={editing?.id}
          />
          <div className="inline-actions">
            <Button type="submit" disabled={!!pending || !form.title.trim()}>
              Save evidence
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
