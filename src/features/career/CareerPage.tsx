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
import { CAREER_PATHS, errorMessage, relatedRecords } from "../search/domain";
import { useSavingWorkspace } from "../search/useSaving";
import {
  blankOption,
  CAREER_TIMELINE,
  criteriaFromData,
  defaultCriteria,
  optionsFromData,
  weightedRating,
  type Criterion,
  type RoleOption,
} from "./domain";
import "./career.css";

type CareerKind = "path" | "rotation" | "decision";
const blank = {
  title: "",
  kind: "path" as CareerKind,
  body: "",
  tags: "",
  links: [] as string[],
  slug: "australia-transfer",
  location: "",
  confidence: "Unverified",
  priority: "Primary",
  nextStep: "",
  uncertainties: "",
  evidence: "",
  source: "",
  checkedAt: "",
  reviewDate: "",
  focus: "",
  status: "Researching",
  startDate: "",
  endDate: "",
  goals: "",
  outcomes: "",
  feedback: "",
  mentorship: "",
  ownership: "",
  technicalDepth: "",
  frontendEvidence: "",
  nonNegotiables: "",
  outcome: "",
  criteria: defaultCriteria(),
  options: [] as RoleOption[],
};

export function CareerPage() {
  const { records, create, update, remove, notify, pending } =
    useSavingWorkspace();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<WorkRecord | null | undefined>();
  const [newKind, setNewKind] = useState<CareerKind>("path");
  const [form, setForm] = useState(blank);
  const career = records.filter(
    (record) =>
      ["path", "rotation", "decision"].includes(record.kind) &&
      !record.deletedAt,
  );
  const selected = career.find((record) => record.id === params.get("record"));
  const paths = career.filter((record) => record.kind === "path");
  const rotations = career.filter((record) => record.kind === "rotation");
  const decisions = career.filter((record) => record.kind === "decision");
  const openNew = (kind: CareerKind) => {
    setNewKind(kind);
    setEditing(null);
  };

  useEffect(() => {
    if (editing === undefined) return;
    if (!editing) {
      setForm({
        ...blank,
        kind: newKind,
        status: newKind === "rotation" ? "Planned" : "Researching",
        criteria: defaultCriteria(),
      });
      return;
    }
    const values = Object.fromEntries(
      Object.keys(blank)
        .filter(
          (key) =>
            ![
              "title",
              "kind",
              "body",
              "tags",
              "links",
              "criteria",
              "options",
            ].includes(key),
        )
        .map((key) => [
          key,
          field(editing, key, String(blank[key as keyof typeof blank])),
        ]),
    );
    const slug = field(editing, "slug");
    setForm({
      ...blank,
      ...values,
      title: editing.title,
      kind: editing.kind as CareerKind,
      body: editing.body,
      tags: editing.tags.join(", "),
      links: editing.links,
      slug:
        (
          {
            "australia-us": "australia-transfer",
            flutter: "flutter-internal",
          } as Record<string, string>
        )[slug] ||
        slug ||
        "other",
      criteria: criteriaFromData(editing.data),
      options: optionsFromData(editing.data),
    });
  }, [editing, newKind]);

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      const { title, kind, body, tags, links, ...data } = form;
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
          criteria: data.criteria.filter((item) => item.label.trim()),
          options: data.options.filter((item) => item.title.trim()),
        },
      };
      const saved = editing
        ? await update(editing.id, input)
        : await create({ kind, ...input });
      setEditing(undefined);
      setParams({ record: saved.id });
      notify("Career worksheet saved.", "success");
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }
  async function nextAction(record: WorkRecord) {
    try {
      await create({
        kind: "action",
        title: field(record, "nextStep", `Review ${record.title}`),
        links: [record.id, ...record.links],
        data: {
          status: "todo",
          estimatedMinutes: 20,
          dueDate: field(record, "reviewDate"),
          firstStep: "Open the worksheet and answer one unresolved question.",
          priority: "normal",
          category: "career",
        },
      });
      notify("Career next step added to Today.", "success");
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }
  function editOption(id: string, patch: Partial<RoleOption>) {
    setForm({
      ...form,
      options: form.options.map((option) =>
        option.id === id ? { ...option, ...patch } : option,
      ),
    });
  }
  function editCriterion(id: string, patch: Partial<Criterion>) {
    setForm({
      ...form,
      criteria: form.criteria.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    });
  }
  const simpleField = (
    key: keyof typeof blank,
    label: string,
    hint?: string,
    multiline = false,
    type = "text",
  ) => (
    <Field key={key} label={label} hint={hint}>
      {multiline ? (
        <Textarea
          rows={3}
          value={String(form[key])}
          onChange={(event) => setForm({ ...form, [key]: event.target.value })}
        />
      ) : (
        <Input
          type={type}
          value={String(form[key])}
          onChange={(event) => setForm({ ...form, [key]: event.target.value })}
        />
      )}
    </Field>
  );

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="CAREER / DIRECTION"
        title="Build the next chapter"
        description="Keep the three routes visible, collect evidence, and choose the role that serves your engineering growth and life."
        action={
          <Button onClick={() => openNew("decision")}>
            + Create a decision
          </Button>
        }
      />
      <div className="career-timeline" aria-label="Career preparation timeline">
        {CAREER_TIMELINE.map((period) => (
          <article key={period.month}>
            <span>{period.month}</span>
            <h3>{period.title}</h3>
            <p>{period.body}</p>
          </article>
        ))}
      </div>
      <div className="section-heading">
        <div>
          <h2>Your routes forward</h2>
          <p className="muted">
            Employer mobility and work-authorisation requirements need current,
            specific evidence.
          </p>
        </div>
        <Button variant="secondary" onClick={() => openNew("path")}>
          + Add a path
        </Button>
      </div>
      <div className="card-grid">
        {paths.map((path) => (
          <Card className="career-path-card" key={path.id}>
            <div className="section-heading">
              <Badge tone="orange">
                {field(path, "priority", "Research path")}
              </Badge>
              <Badge tone="muted">
                {field(path, "confidence", "Unverified")}
              </Badge>
            </div>
            <button
              className="record-title-button"
              onClick={() => setParams({ record: path.id })}
            >
              {path.title} ↗
            </button>
            <Markdown content={path.body} />
            <p>
              <strong>Next step</strong>
              <br />
              {field(path, "nextStep", "Choose a useful research question.")}
            </p>
            <p className="muted">
              Open questions:{" "}
              {field(
                path,
                "uncertainties",
                "Record the assumptions to verify.",
              )}
            </p>
            <div className="section-heading">
              <small className="muted">
                Review {niceDate(field(path, "reviewDate"))}
              </small>
              <Button variant="ghost" onClick={() => setEditing(path)}>
                Edit path
              </Button>
            </div>
          </Card>
        ))}
        {!paths.length && (
          <EmptyState
            title="Compare your options."
            description="Australia then a possible US transfer, direct US applications, or a researched internal route can progress together."
            action={
              <Button onClick={() => openNew("path")}>
                Create a career path
              </Button>
            }
          />
        )}
      </div>
      <div className="section-heading">
        <div>
          <h2>Rotations & engineering growth</h2>
          <p className="muted">
            Compare additional depth, production ownership, mentorship, and
            demonstrable impact. A frontend rotation should add evidence you
            want.
          </p>
        </div>
        <Button variant="secondary" onClick={() => openNew("rotation")}>
          + Add a rotation
        </Button>
      </div>
      <div className="card-grid">
        {rotations.map((rotation) => (
          <Card className="stack" key={rotation.id}>
            <Badge tone="blue">{field(rotation, "status", "Planned")}</Badge>
            <button
              className="record-title-button"
              onClick={() => setParams({ record: rotation.id })}
            >
              {rotation.title} ↗
            </button>
            <p>{field(rotation, "focus")}</p>
            <p className="muted">
              {field(rotation, "goals") ||
                field(
                  rotation,
                  "nextStep",
                  "Capture what you want to learn and own.",
                )}
            </p>
            <div className="section-heading">
              <small>
                {field(rotation, "endDate")
                  ? `Ends ${niceDate(field(rotation, "endDate"))}`
                  : "End date to confirm"}
              </small>
              <Button variant="ghost" onClick={() => setEditing(rotation)}>
                Edit rotation
              </Button>
            </div>
          </Card>
        ))}
        {!rotations.length && (
          <p className="muted">
            Add current, completed, or possible rotations and connect them to
            your work evidence.
          </p>
        )}
      </div>
      <div className="section-heading">
        <div>
          <h2>Decisions, offers & role comparisons</h2>
          <p className="muted">
            Compare actual options with your own criteria. Unknown terms stay
            unknown.
          </p>
        </div>
        <Button variant="secondary" onClick={() => openNew("decision")}>
          + Compare options
        </Button>
      </div>
      <div className="card-grid">
        {decisions.map((decision) => (
          <Card className="stack" key={decision.id}>
            <Badge tone="pink">
              {field(decision, "status", "Researching")}
            </Badge>
            <button
              className="record-title-button"
              onClick={() => setParams({ record: decision.id })}
            >
              {decision.title} ↗
            </button>
            <p>
              {field(
                decision,
                "nextStep",
                "Collect the evidence needed to decide.",
              )}
            </p>
            <small className="muted">
              {optionsFromData(decision.data).length} options · review{" "}
              {niceDate(field(decision, "reviewDate"))}
            </small>
            <Button variant="ghost" onClick={() => setEditing(decision)}>
              Edit comparison
            </Button>
          </Card>
        ))}
      </div>
      {selected && (
        <Card className="detail-panel">
          <div className="section-heading">
            <Badge tone="orange">{selected.kind.toUpperCase()} WORKSHEET</Badge>
            <Button variant="ghost" onClick={() => setParams({})}>
              Close
            </Button>
          </div>
          <h2>{selected.title}</h2>
          <Markdown content={selected.body} />
          <div className="inline-actions">
            <Button onClick={() => setEditing(selected)}>Edit worksheet</Button>
            <Button
              variant="secondary"
              onClick={() => void nextAction(selected)}
            >
              Add next step to Today
            </Button>
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
          <dl className="detail-facts">
            <div>
              <dt>Review date</dt>
              <dd>{niceDate(field(selected, "reviewDate"))}</dd>
            </div>
            <div>
              <dt>Last verified</dt>
              <dd>{niceDate(field(selected, "checkedAt"))}</dd>
            </div>
            <div>
              <dt>Next step</dt>
              <dd>{field(selected, "nextStep", "Not recorded")}</dd>
            </div>
            <div>
              <dt>Uncertainties</dt>
              <dd>{field(selected, "uncertainties", "Not recorded")}</dd>
            </div>
          </dl>
          {selected.kind === "rotation" && (
            <dl className="detail-facts">
              {[
                ["goals", "Learning goals"],
                ["ownership", "Production ownership"],
                ["technicalDepth", "Technical depth"],
                ["mentorship", "Mentorship"],
                ["outcomes", "Outcomes & evidence"],
                ["feedback", "Feedback"],
                ["frontendEvidence", "What a frontend rotation would add"],
              ].map(([key, name]) => (
                <div key={key}>
                  <dt>{name}</dt>
                  <dd className="preserve-lines">
                    {field(selected, key, "Unknown / to discuss")}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {selected.kind === "decision" && (
            <>
              <div className="next-action-callout">
                <strong>Your non-negotiables</strong>
                <p>
                  {field(
                    selected,
                    "nonNegotiables",
                    "Choose what matters to you. You can leave this undecided.",
                  )}
                </p>
              </div>
              <div className="table-wrap">
                <table className="career-comparison-table">
                  <thead>
                    <tr>
                      <th>Criteria / terms</th>
                      {optionsFromData(selected.data).map((option) => (
                        <th key={option.id}>{option.title}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["scope", "Engineering scope"],
                      ["mentorship", "Mentorship"],
                      ["growth", "Growth"],
                      ["location", "Location"],
                      ["arrangement", "Working arrangement"],
                      ["mobility", "Mobility evidence"],
                      ["base", "Base salary"],
                      ["equity", "Equity & vesting"],
                      ["bonus", "Bonus"],
                      ["currency", "Currency"],
                      ["confirmation", "Terms confirmation"],
                      ["nonNegotiables", "Meets non-negotiables?"],
                      ["startDate", "Start date"],
                      ["deadline", "Decision deadline"],
                    ].map(([key, name]) => (
                      <tr key={key}>
                        <th>{name}</th>
                        {optionsFromData(selected.data).map((option) => (
                          <td key={option.id}>
                            {String(
                              option[key as keyof RoleOption] || "Unknown",
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {criteriaFromData(selected.data).map((criterion) => (
                      <tr key={criterion.id}>
                        <th>
                          {criterion.label}
                          <small>Weight {criterion.weight}</small>
                        </th>
                        {optionsFromData(selected.data).map((option) => (
                          <td key={option.id}>
                            {option.scores[criterion.id] ?? "Unknown"}
                            {option.scores[criterion.id] !== null &&
                            option.scores[criterion.id] !== undefined
                              ? " / 5"
                              : ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr>
                      <th>Your weighted rating</th>
                      {optionsFromData(selected.data).map((option) => (
                        <td key={option.id}>
                          {weightedRating(
                            option,
                            criteriaFromData(selected.data),
                          )?.toFixed(2) || "Incomplete ratings"}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <th>Evidence source / checked</th>
                      {optionsFromData(selected.data).map((option) => (
                        <td key={option.id}>
                          {safeUrl(option.source) && (
                            <a
                              href={safeUrl(option.source)!}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Source ↗
                            </a>
                          )}
                          <br />
                          {niceDate(option.checkedAt)}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="muted">
                Ratings are your subjective assessment, not a predicted outcome.
                Different currencies and unknown compensation are not combined.
                A total appears only after all weighted criteria have ratings.
              </p>
              <h3>Decision & rationale</h3>
              <p className="preserve-lines">
                {field(selected, "outcome", "No decision recorded yet.")}
              </p>
            </>
          )}
          <h3>Supporting evidence & opportunities</h3>
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
                notify("Worksheet moved to trash.", "info");
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
        title={editing ? "Edit career worksheet" : `Create a ${newKind}`}
        size="wide"
      >
        <form className="stack" onSubmit={save}>
          <div className="form-grid">
            <Field label="Title">
              <Input
                autoFocus
                required
                value={form.title}
                onChange={(event) =>
                  setForm({ ...form, title: event.target.value })
                }
              />
            </Field>
            <Field label="Worksheet type">
              <Select
                disabled={!!editing}
                value={form.kind}
                onChange={(event) =>
                  setForm({ ...form, kind: event.target.value as CareerKind })
                }
              >
                <option value="path">Career path</option>
                <option value="rotation">Rotation</option>
                <option value="decision">Decision / offer comparison</option>
              </Select>
            </Field>
          </div>
          <Field label="Context & notes">
            <Textarea
              rows={4}
              value={form.body}
              onChange={(event) =>
                setForm({ ...form, body: event.target.value })
              }
            />
          </Field>
          {form.kind === "path" && (
            <>
              <div className="form-grid">
                <Field label="Route">
                  <Select
                    value={form.slug}
                    onChange={(event) =>
                      setForm({ ...form, slug: event.target.value })
                    }
                  >
                    {CAREER_PATHS.map((path) => (
                      <option key={path.value} value={path.value}>
                        {path.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                {simpleField("location", "Location / relevant teams")}
                <Field label="Confidence">
                  <Select
                    value={form.confidence}
                    onChange={(event) =>
                      setForm({ ...form, confidence: event.target.value })
                    }
                  >
                    {[
                      "Unverified",
                      "To research",
                      "Low / unverified",
                      "Employer-stated",
                      "Contact-confirmed",
                      "Confirmed available option",
                    ].map((value) => (
                      <option key={value}>{value}</option>
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
                    {["Primary", "Secondary", "Exploratory"].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </Select>
                </Field>
              </div>
              {simpleField(
                "uncertainties",
                "Open questions / assumptions",
                "Transfer availability and work authorisation are employer-specific.",
                true,
              )}
              {simpleField(
                "evidence",
                "What is actually supported by evidence?",
                undefined,
                true,
              )}
            </>
          )}
          {form.kind === "rotation" && (
            <>
              <div className="form-grid">
                {simpleField("focus", "Engineering focus")}
                <Field label="Status">
                  <Select
                    value={form.status}
                    onChange={(event) =>
                      setForm({ ...form, status: event.target.value })
                    }
                  >
                    {["Planned", "Current", "Completed", "Considering"].map(
                      (value) => (
                        <option key={value}>{value}</option>
                      ),
                    )}
                  </Select>
                </Field>
                {simpleField(
                  "startDate",
                  "Start date",
                  undefined,
                  false,
                  "date",
                )}
                {simpleField("endDate", "End date", undefined, false, "date")}
              </div>
              {[
                ["goals", "Learning goals"],
                ["ownership", "Production ownership to seek"],
                ["technicalDepth", "Additional technical depth"],
                ["mentorship", "Mentorship and feedback"],
                ["outcomes", "Outcomes and evidence"],
                ["feedback", "Actual feedback"],
                ["frontendEvidence", "What would a frontend rotation add?"],
              ].map(([key, name]) =>
                simpleField(
                  key as keyof typeof blank,
                  name,
                  key === "frontendEvidence"
                    ? "Focus on depth, ownership, and demonstrable impact beyond existing full-stack exposure."
                    : undefined,
                  true,
                ),
              )}
            </>
          )}
          {form.kind === "decision" && (
            <>
              <Field label="Decision status">
                <Select
                  value={form.status}
                  onChange={(event) =>
                    setForm({ ...form, status: event.target.value })
                  }
                >
                  {[
                    "Researching",
                    "Ready to decide",
                    "Decided",
                    "Archived",
                  ].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </Select>
              </Field>
              {simpleField(
                "nonNegotiables",
                "Your non-negotiables",
                "Write the conditions that an option must meet. Leave unknown conditions explicit.",
                true,
              )}
              <section className="stack">
                <div className="section-heading">
                  <h3>Your comparison criteria</h3>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      setForm({
                        ...form,
                        criteria: [
                          ...form.criteria,
                          { id: crypto.randomUUID(), label: "", weight: 1 },
                        ],
                      })
                    }
                  >
                    + Add criterion
                  </Button>
                </div>
                <p className="muted">
                  Choose weights from 0–10. Zero excludes a criterion from the
                  optional rating.
                </p>
                {form.criteria.map((criterion) => (
                  <div className="career-criterion-row" key={criterion.id}>
                    <Input
                      aria-label="Criterion name"
                      value={criterion.label}
                      onChange={(event) =>
                        editCriterion(criterion.id, {
                          label: event.target.value,
                        })
                      }
                    />
                    <Input
                      aria-label={`Weight for ${criterion.label}`}
                      type="number"
                      min={0}
                      max={10}
                      step={1}
                      value={criterion.weight}
                      onChange={(event) =>
                        editCriterion(criterion.id, {
                          weight: Math.max(
                            0,
                            Math.min(10, Number(event.target.value)),
                          ),
                        })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        setForm({
                          ...form,
                          criteria: form.criteria.filter(
                            (item) => item.id !== criterion.id,
                          ),
                        })
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </section>
              <section className="stack">
                <div className="section-heading">
                  <h3>Actual options</h3>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      setForm({
                        ...form,
                        options: [...form.options, blankOption()],
                      })
                    }
                  >
                    + Add an option
                  </Button>
                </div>
                {form.options.map((option) => (
                  <Card className="career-option-editor stack" key={option.id}>
                    <div className="section-heading">
                      <strong>{option.title || "New option"}</strong>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          setForm({
                            ...form,
                            options: form.options.filter(
                              (item) => item.id !== option.id,
                            ),
                          })
                        }
                      >
                        Remove option
                      </Button>
                    </div>
                    <div className="form-grid">
                      {[
                        ["title", "Option / role name"],
                        ["location", "Location"],
                        ["arrangement", "Working arrangement"],
                        ["scope", "Engineering scope"],
                        ["mentorship", "Mentorship"],
                        ["growth", "Growth opportunities"],
                        ["mobility", "Mobility evidence"],
                        ["currency", "Currency"],
                        ["base", "Base salary"],
                        ["equity", "Equity and vesting"],
                        ["bonus", "Bonus"],
                      ].map(([key, name]) => (
                        <Field key={key} label={name}>
                          <Input
                            value={String(option[key as keyof RoleOption])}
                            placeholder="Unknown"
                            onChange={(event) =>
                              editOption(option.id, {
                                [key]: event.target.value,
                              })
                            }
                          />
                        </Field>
                      ))}
                      <Field label="Terms confirmation">
                        <Select
                          value={option.confirmation}
                          onChange={(event) =>
                            editOption(option.id, {
                              confirmation: event.target
                                .value as RoleOption["confirmation"],
                            })
                          }
                        >
                          {["Unknown", "Employer-stated", "Written offer"].map(
                            (value) => (
                              <option key={value}>{value}</option>
                            ),
                          )}
                        </Select>
                      </Field>
                      <Field label="Meets your non-negotiables?">
                        <Select
                          value={option.nonNegotiables}
                          onChange={(event) =>
                            editOption(option.id, {
                              nonNegotiables: event.target
                                .value as RoleOption["nonNegotiables"],
                            })
                          }
                        >
                          {["Unknown", "Yes", "No"].map((value) => (
                            <option key={value}>{value}</option>
                          ))}
                        </Select>
                      </Field>
                      {[
                        ["startDate", "Start date"],
                        ["deadline", "Decision deadline"],
                        ["checkedAt", "Date checked"],
                      ].map(([key, name]) => (
                        <Field key={key} label={name}>
                          <Input
                            type="date"
                            value={String(option[key as keyof RoleOption])}
                            onChange={(event) =>
                              editOption(option.id, {
                                [key]: event.target.value,
                              })
                            }
                          />
                        </Field>
                      ))}
                      <Field label="Source / offer reference">
                        <Input
                          type="url"
                          value={option.source}
                          onChange={(event) =>
                            editOption(option.id, {
                              source: event.target.value,
                            })
                          }
                        />
                      </Field>
                    </div>
                    <Field label="Questions, evidence and notes">
                      <Textarea
                        rows={3}
                        value={option.notes}
                        onChange={(event) =>
                          editOption(option.id, { notes: event.target.value })
                        }
                      />
                    </Field>
                    <div className="form-grid">
                      {form.criteria
                        .filter((item) => item.label.trim())
                        .map((criterion) => (
                          <Field
                            key={criterion.id}
                            label={`${criterion.label} — your rating / 5`}
                            hint="Blank = unknown"
                          >
                            <Input
                              type="number"
                              min={1}
                              max={5}
                              step={1}
                              value={option.scores[criterion.id] ?? ""}
                              onChange={(event) =>
                                editOption(option.id, {
                                  scores: {
                                    ...option.scores,
                                    [criterion.id]:
                                      event.target.value === ""
                                        ? null
                                        : Number(event.target.value),
                                  },
                                })
                              }
                            />
                          </Field>
                        ))}
                    </div>
                    <p className="muted">
                      Your weighted rating:{" "}
                      {weightedRating(option, form.criteria)?.toFixed(2) ||
                        "Incomplete ratings"}
                    </p>
                  </Card>
                ))}
              </section>
              {simpleField(
                "outcome",
                "Decision, rationale & transition steps",
                undefined,
                true,
              )}
            </>
          )}
          <div className="form-grid">
            {simpleField("source", "Research source", undefined, false, "url")}
            {simpleField("checkedAt", "Date checked", undefined, false, "date")}
            {simpleField("reviewDate", "Review date", undefined, false, "date")}
            {simpleField("nextStep", "One next step")}
          </div>
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
              Save worksheet
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
