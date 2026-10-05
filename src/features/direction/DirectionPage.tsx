import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  Check,
  Compass,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { goalProgress, type Goal, type GoalInput } from "../../../shared/goals";
import {
  DIRECTION_KINDS,
  directionDataSchema,
} from "../../../shared/direction";
import {
  field,
  localDate,
  niceDate,
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
  SectionTabs,
  Textarea,
} from "../../components/ui";
import { useWorkspace } from "../../lib/workspace";
import { useEditMode } from "../../lib/edit-mode";
import { useGoals } from "../../lib/goals";
import { useLearningData } from "../learn/useLearningData";
import {
  observedProgress as observed,
  useGoalMeasurements,
} from "./goalMetrics";
import { GoalEditor, goalInput } from "./GoalEditor";
import "../home/timeline.css";
import "./direction.css";

type DirectionKind = (typeof DIRECTION_KINDS)[number];
const kindLabel = {
  path: "Career path",
  rotation: "Stream / experience",
  decision: "Decision",
};
function alternatives(record: WorkRecord | null) {
  if (!record) return "";
  const value = record.data.options;
  return typeof value === "string"
    ? value
    : Array.isArray(value)
      ? value
          .map((option) =>
            typeof option === "string"
              ? option
              : option && typeof option === "object" && "title" in option
                ? String(option.title)
                : "",
          )
          .filter(Boolean)
          .join("\n")
      : "";
}
export function DirectionPage() {
  const { editing: editMode } = useEditMode();
  const workspace = useWorkspace();
  const model = useGoals();
  const learning = useLearningData();
  useGoalMeasurements(model, learning, workspace.user?.id ?? "");
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<WorkRecord | null | undefined>();
  const [newKind, setNewKind] = useState<DirectionKind>("path");
  const [goalEditing, setGoalEditing] = useState<Goal | null | undefined>();
  const [scale, setScale] = useState<"quarter" | "year">("quarter");
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const directions = workspace.records.filter(
    (record) =>
      DIRECTION_KINDS.includes(record.kind as DirectionKind) &&
      !record.deletedAt,
  );
  const selected = directions.find(
    (record) => record.id === params.get("record"),
  );
  const selectedGoal = model.goals.find(
    (goal) => goal.id === params.get("goal"),
  );
  const entries = [
    ...model.goals.flatMap((goal) => [
      ...(goal.targetDate
        ? [
            {
              id: goal.id,
              date: goal.targetDate,
              title: goal.title,
              detail: goal.startDate
                ? `${niceDate(goal.startDate)} → ${niceDate(goal.targetDate)}`
                : "Goal target",
              goalId: goal.id,
              recordId: "",
              done: goalProgress(goal, observed(goal, learning)).complete,
            },
          ]
        : []),
      ...goal.milestones
        .filter((item) => item.date)
        .map((item) => ({
          id: `${goal.id}:${item.id}`,
          date: item.date,
          title: item.title,
          detail: goal.title,
          goalId: goal.id,
          recordId: "",
          done: item.done,
        })),
    ]),
    ...directions.flatMap((record) => {
      const date = field(record, "reviewDate") || field(record, "endDate");
      return date
        ? [
            {
              id: record.id,
              date,
              title: record.title,
              detail: field(record, "reviewDate")
                ? "Review direction"
                : "Experience milestone",
              goalId: "",
              recordId: record.id,
              done: field(record, "status") === "Completed",
            },
          ]
        : [];
    }),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const key = `${entry.date.slice(0, 4)}${scale === "quarter" ? ` · Q${Math.ceil(Number(entry.date.slice(5, 7)) / 3)}` : ""}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const openNew = (kind: DirectionKind) => {
    setNewKind(kind);
    setEditing(null);
  };
  const saveGoalPatch = async (goal: Goal, patch: Partial<GoalInput>) => {
    setBusy(true);
    setFailure("");
    try {
      await model.save({ ...goalInput(goal), ...patch }, goal);
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : "Could not save goal.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page-stack direction-page">
      <PageHeader
        title="Your Direction"
        action={
          editMode && (
            <Button onClick={() => setGoalEditing(null)}>
              <Plus size={17} />
              Add goal
            </Button>
          )
        }
      />
      {(failure || model.error) && (
        <p role="alert" className="notice notice-warning">
          {failure || model.error}
        </p>
      )}
      <Card className="direction-overview">
        <div className="section-heading">
          <h2>Longer-term timeline</h2>
          <SectionTabs
            className="direction-scale"
            role="group"
            aria-label="Timeline scale"
          >
            {(["quarter", "year"] as const).map((value) => (
              <Button
                key={value}
                variant={scale === value ? "primary" : "secondary"}
                aria-pressed={scale === value}
                onClick={() => setScale(value)}
              >
                {value === "quarter" ? "Quarters" : "Years"}
              </Button>
            ))}
          </SectionTabs>
        </div>
        {entries.length ? (
          <div className="direction-timeline">
            {[...groups].map(([group, items]) => (
              <section key={group}>
                <h3>{group}</h3>
                {items.map((entry) => (
                  <button
                    className={`direction-timeline-item ${entry.done ? "is-complete" : ""}`}
                    key={entry.id}
                    onClick={() =>
                      setParams(
                        entry.goalId
                          ? { goal: entry.goalId }
                          : { record: entry.recordId },
                      )
                    }
                  >
                    <time>{niceDate(entry.date)}</time>
                    <span>
                      <strong>{entry.title}</strong>
                      <small>{entry.detail}</small>
                    </span>
                    {entry.done ? (
                      <Check size={18} />
                    ) : (
                      <ArrowUpRight size={18} />
                    )}
                  </button>
                ))}
              </section>
            ))}
          </div>
        ) : (
          <p className="muted">
            Dated goals, milestones, and direction reviews appear here.
          </p>
        )}
      </Card>
      {DIRECTION_KINDS.map((kind) => (
        <section className="stack" key={kind}>
          <div className="section-heading">
            <h2>
              {kind === "path"
                ? "Career paths"
                : kind === "rotation"
                  ? "Streams & experience"
                  : "Decisions"}
            </h2>
            {editMode && (
              <Button variant="secondary" onClick={() => openNew(kind)}>
                <Plus size={16} />
                Add {kind === "rotation" ? "stream" : kind}
              </Button>
            )}
          </div>
          <div className="direction-grid">
            {directions
              .filter((record) => record.kind === kind)
              .map((record) => (
                <Card
                  key={record.id}
                  className={`direction-card application-row-action direction-${kind}`}
                  onClick={(event) => {
                    if (
                      (event.target as HTMLElement).closest(
                        "button,a,input,select,textarea",
                      ) ||
                      window.getSelection()?.toString()
                    )
                      return;
                    setParams({ record: record.id });
                  }}
                >
                  <div className="section-heading">
                    <Badge
                      tone={
                        kind === "path"
                          ? "blue"
                          : kind === "rotation"
                            ? "pink"
                            : "orange"
                      }
                    >
                      {field(
                        record,
                        "priority",
                        field(record, "status", "Exploring"),
                      )}
                    </Badge>
                    {editMode && (
                      <Button
                        variant="ghost"
                        className="icon-button"
                        aria-label={`Edit ${record.title}`}
                        onClick={() => setEditing(record)}
                      >
                        <Pencil size={16} />
                      </Button>
                    )}
                  </div>
                  <button
                    className="record-title-button"
                    onClick={() => setParams({ record: record.id })}
                  >
                    {record.title}
                  </button>
                  {field(record, "focus") && <p>{field(record, "focus")}</p>}
                  {field(record, "location") && (
                    <p className="muted">{field(record, "location")}</p>
                  )}
                  {record.body && <Markdown content={record.body} />}
                  {field(record, "nextStep") && (
                    <p>
                      <strong>Next step</strong>
                      <br />
                      {field(record, "nextStep")}
                    </p>
                  )}
                  {field(record, "reviewDate") && (
                    <small>
                      Review {niceDate(field(record, "reviewDate"))}
                    </small>
                  )}
                </Card>
              ))}
          </div>
          {!directions.some((record) => record.kind === kind) && (
            <EmptyState
              title={
                kind === "path"
                  ? "Add a route you want to explore"
                  : kind === "rotation"
                    ? "Keep your streams and experiences here"
                    : "Record a decision to work towards"
              }
              icon={<Compass size={24} />}
            />
          )}
        </section>
      ))}
      <section className="stack">
        <div className="section-heading">
          <h2>Goals & milestones</h2>
          <span className="muted">{model.goals.length} goals</span>
        </div>
        {model.loading ? (
          <p role="status">Loading goals…</p>
        ) : (
          <div className="goal-grid">
            {model.goals.map((goal) => {
              const progress = goalProgress(goal, observed(goal, learning));
              return (
                <button
                  key={goal.id}
                  className={`goal-card ${progress.complete ? "goal-complete" : ""}`}
                  onClick={() => setParams({ goal: goal.id })}
                >
                  <div className="goal-card-top">
                    <span>
                      {goal.targetDate
                        ? niceDate(goal.targetDate)
                        : "No target date"}
                    </span>
                    {progress.complete ? (
                      <Check size={17} />
                    ) : (
                      <Compass size={17} />
                    )}
                  </div>
                  <strong>{goal.title}</strong>
                  <div
                    className="goal-progress"
                    role="progressbar"
                    aria-label={`${goal.title} progress`}
                    aria-valuenow={Math.round(progress.percent)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <span style={{ width: `${progress.percent}%` }} />
                  </div>
                  <small>
                    {goal.measure === "completion"
                      ? progress.complete
                        ? "Complete"
                        : "In progress"
                      : `${progress.value} / ${progress.target}${goal.unit ? ` ${goal.unit}` : ""}`}
                  </small>
                  {goal.measure === "curriculum" && (
                    <small>Retired Weeks source · recorded progress</small>
                  )}
                </button>
              );
            })}
          </div>
        )}
        {!model.loading && !model.goals.length && (
          <p className="muted">
            Add a goal when you have an outcome to work towards.
          </p>
        )}
      </section>
      {editing !== undefined && (
        <DirectionEditor
          key={editing?.id ?? newKind}
          record={editing}
          kind={(editing?.kind as DirectionKind | undefined) ?? newKind}
          onClose={() => setEditing(undefined)}
          onSave={async (input) => {
            if (editing)
              await workspace.update(editing.id, input, editing.version);
            else await workspace.create({ kind: newKind, ...input });
            setEditing(undefined);
          }}
        />
      )}
      {goalEditing !== undefined && (
        <GoalEditor
          key={goalEditing?.id ?? "new"}
          goal={goalEditing}
          owner={workspace.user?.id ?? ""}
          directions={directions}
          onClose={() => setGoalEditing(undefined)}
          onSave={async (input) => {
            const goal = await model.save(input, goalEditing ?? undefined);
            setGoalEditing(undefined);
            setParams({ goal: goal.id });
          }}
        />
      )}
      <Modal
        open={!!selected}
        onClose={() => setParams({})}
        title={selected?.title ?? "Direction"}
      >
        {selected && (
          <div className="stack">
            <Badge tone="blue">
              {kindLabel[selected.kind as DirectionKind]}
            </Badge>
            {selected.body && <Markdown content={selected.body} />}
            {[
              "status",
              "focus",
              "location",
              "nextStep",
              "uncertainties",
              "outcome",
              "outcomes",
              "feedback",
            ]
              .filter((key) => field(selected, key))
              .map((key) => (
                <div key={key}>
                  <strong>
                    {
                      (
                        {
                          nextStep: "Next step",
                          uncertainties: "Open questions",
                          focus: "Stream",
                          outcomes: "Outcomes",
                          outcome: "Decision",
                          feedback: "Feedback",
                          status: "Status",
                          location: "Location",
                        } as Record<string, string>
                      )[key]
                    }
                  </strong>
                  <p className="preserve-lines">{field(selected, key)}</p>
                </div>
              ))}
            {selected.kind === "decision" && alternatives(selected) && (
              <div>
                <strong>Alternatives</strong>
                <p className="preserve-lines">{alternatives(selected)}</p>
              </div>
            )}
            {Array.isArray(selected.data.researchLinks) &&
              selected.data.researchLinks
                .filter(
                  (value): value is string =>
                    typeof value === "string" && !!safeUrl(value),
                )
                .map((url) => (
                  <a
                    className="text-link"
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {new URL(url).hostname}
                    <ArrowUpRight size={14} />
                  </a>
                ))}
            {editMode && (
              <div className="inline-actions">
                <Button
                  onClick={() => {
                    setEditing(selected);
                    setParams({});
                  }}
                >
                  Edit {selected.kind === "rotation" ? "stream" : selected.kind}
                </Button>
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await workspace.remove(selected.id);
                      setParams({});
                      workspace.notify("Direction deleted.", "info");
                    } catch (error) {
                      setFailure(
                        error instanceof Error
                          ? error.message
                          : "Could not remove direction.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Trash2 size={16} />
                  Delete
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>
      <Modal
        open={!!selectedGoal}
        onClose={() => {
          setParams({});
          setFailure("");
        }}
        title={selectedGoal?.title ?? "Goal"}
      >
        {selectedGoal && (
          <div className="stack goal-detail">
            {failure && (
              <p role="alert" className="notice notice-warning">
                {failure}
              </p>
            )}
            <p>
              {selectedGoal.targetDate
                ? `Target: ${niceDate(selectedGoal.targetDate)} ${selectedGoal.targetDate.slice(0, 4)}`
                : "No target date"}
            </p>
            <div
              className="goal-progress"
              role="progressbar"
              aria-label="Goal progress"
              aria-valuenow={Math.round(
                goalProgress(selectedGoal, observed(selectedGoal, learning))
                  .percent,
              )}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span
                style={{
                  width: `${goalProgress(selectedGoal, observed(selectedGoal, learning)).percent}%`,
                }}
              />
            </div>
            {selectedGoal.measure !== "completion" && (
              <p>
                {
                  goalProgress(selectedGoal, observed(selectedGoal, learning))
                    .value
                }{" "}
                / {goalProgress(selectedGoal).target} {selectedGoal.unit}
              </p>
            )}
            {selectedGoal.measure === "curriculum" && (
              <p className="notice notice-warning">
                The Weeks source has been retired. Recorded progress is
                preserved. Edit the goal to choose a new measure.
              </p>
            )}
            {selectedGoal.directionId && (
              <small>
                Related direction:{" "}
                {directions.find(
                  (record) => record.id === selectedGoal.directionId,
                )?.title ?? "Removed direction"}
              </small>
            )}
            {selectedGoal.milestones.map((milestone) => (
              <label className="goal-milestone" key={milestone.id}>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={milestone.done}
                  onChange={(event) =>
                    void saveGoalPatch(selectedGoal, {
                      milestones: selectedGoal.milestones.map((item) =>
                        item.id === milestone.id
                          ? {
                              ...item,
                              done: event.target.checked,
                              completedAt: event.target.checked
                                ? new Date().toISOString()
                                : null,
                            }
                          : item,
                      ),
                    })
                  }
                />
                <span>{milestone.title}</span>
                <small>{milestone.date && niceDate(milestone.date)}</small>
              </label>
            ))}
            {safeUrl(selectedGoal.sourceUrl) && (
              <a
                className="text-link"
                href={safeUrl(selectedGoal.sourceUrl)!}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open source
                <ArrowUpRight size={15} />
              </a>
            )}
            {selectedGoal.checkpoints.length > 0 && (
              <details>
                <summary>Progress history</summary>
                <div className="goal-checkpoints">
                  {selectedGoal.checkpoints
                    .slice()
                    .reverse()
                    .map((point, index) => (
                      <div key={`${point.at}:${index}`}>
                        <time>
                          {niceDate(
                            localDate(
                              new Date(point.at),
                              workspace.preferences.timezone,
                            ),
                          )}
                        </time>
                        <strong>
                          {point.value} {point.unit ?? selectedGoal.unit}
                        </strong>
                      </div>
                    ))}
                </div>
              </details>
            )}
            <div className="inline-actions">
              <Button
                disabled={busy}
                onClick={() =>
                  void saveGoalPatch(selectedGoal, {
                    status:
                      selectedGoal.status === "completed"
                        ? "active"
                        : "completed",
                    completedAt:
                      selectedGoal.status === "completed"
                        ? null
                        : new Date().toISOString(),
                  })
                }
              >
                {selectedGoal.status === "completed"
                  ? "Reopen"
                  : "Mark complete"}
              </Button>
              {editMode && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setGoalEditing(selectedGoal);
                    setParams({});
                  }}
                >
                  Edit goal
                </Button>
              )}
            </div>
            {editMode && (
              <details>
                <summary>Delete goal</summary>
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await model.remove(selectedGoal);
                      setParams({});
                    } catch (error) {
                      setFailure(
                        error instanceof Error
                          ? error.message
                          : "Could not remove goal.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Delete goal
                </Button>
              </details>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function DirectionEditor({
  record,
  kind,
  onClose,
  onSave,
}: {
  record: WorkRecord | null;
  kind: DirectionKind;
  onClose: () => void;
  onSave: (input: {
    title: string;
    body: string;
    data: WorkRecord["data"];
  }) => Promise<void>;
}) {
  const { user } = useWorkspace();
  const draftKey = `work:direction-draft:${user?.id ?? ""}:${record?.id ?? kind}`;
  const savedForm = {
    title: record?.title ?? "",
    body: record?.body ?? "",
    priority: field(record ?? undefined, "priority", "Exploratory"),
    status: field(record ?? undefined, "status", "Exploring"),
    location: field(record ?? undefined, "location"),
    focus: field(record ?? undefined, "focus"),
    nextStep: field(record ?? undefined, "nextStep"),
    uncertainties: field(record ?? undefined, "uncertainties"),
    outcome: field(record ?? undefined, "outcome"),
    reviewDate: field(record ?? undefined, "reviewDate"),
    startDate: field(record ?? undefined, "startDate"),
    endDate: field(record ?? undefined, "endDate"),
    options: alternatives(record),
    researchLinks: Array.isArray(record?.data.researchLinks)
      ? record.data.researchLinks.join("\n")
      : "",
  };
  const savedSnapshot = JSON.stringify(savedForm);
  const [form, setForm] = useState(() => {
    const defaults = savedForm;
    try {
      const parsed = JSON.parse(localStorage.getItem(draftKey) ?? "null");
      if (parsed && typeof parsed === "object")
        return Object.fromEntries(
          Object.entries(defaults).map(([key, value]) => [
            key,
            typeof parsed[key] === "string" ? parsed[key] : value,
          ]),
        ) as typeof defaults;
    } catch {
      /* Keep saved fields. */
    }
    return defaults;
  });
  const [recovered, setRecovered] = useState(
    JSON.stringify(form) !== savedSnapshot,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    try {
      if (JSON.stringify(form) === savedSnapshot)
        localStorage.removeItem(draftKey);
      else localStorage.setItem(draftKey, JSON.stringify(form));
    } catch {
      /* The form remains available. */
    }
  }, [draftKey, form, savedSnapshot]);
  const input = (
    key: keyof typeof form,
    label: string,
    multiline = false,
    type = "text",
  ) => (
    <Field label={label} key={key}>
      {multiline ? (
        <Textarea
          rows={key === "body" ? 6 : 3}
          value={form[key]}
          onChange={(event) => setForm({ ...form, [key]: event.target.value })}
        />
      ) : (
        <Input
          required={key === "title"}
          type={type}
          value={form[key]}
          onChange={(event) => setForm({ ...form, [key]: event.target.value })}
        />
      )}
    </Field>
  );
  return (
    <Modal
      open
      title={`${record ? "Edit" : "Add"} ${kind === "rotation" ? "stream" : kind}`}
      onClose={onClose}
    >
      <form
        className="stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          setBusy(true);
          try {
            const { title, body, options, researchLinks, ...fields } = form;
            const data = directionDataSchema.parse({
              ...record?.data,
              ...fields,
              category: "direction",
              researchLinks: researchLinks
                .split("\n")
                .map((url) => url.trim())
                .filter(Boolean),
              ...(options !== alternatives(record) ? { options } : {}),
            });
            await onSave({ title: title.trim(), body, data });
            localStorage.removeItem(draftKey);
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : "Could not save direction.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {recovered && (
          <div className="notice notice-warning">
            <p>
              A device draft has been recovered. Review it before saving over
              the current direction.
            </p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setForm(savedForm);
                setRecovered(false);
              }}
            >
              Load saved direction
            </Button>
          </div>
        )}
        {input("title", kindLabel[kind])}
        {input("body", "Notes", true)}
        <div className="form-grid">
          {input("status", "Status")}
          {input("priority", "Priority")}
          {input("focus", "Stream / focus")}
          {input("location", "Location")}
        </div>
        {input("nextStep", "Next step", true)}
        {input("uncertainties", "Open questions", true)}
        {kind === "decision" && (
          <>
            {input("options", "Alternatives (one per line)", true)}
            {input("outcome", "Decision / reasons", true)}
          </>
        )}
        <div className="form-grid">
          {input("reviewDate", "Review date", false, "date")}
          {input("startDate", "Start date", false, "date")}
          {input("endDate", "End date", false, "date")}
        </div>
        {input("researchLinks", "Research links (one URL per line)", true)}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="inline-actions">
          <Button type="submit" disabled={busy || !form.title.trim()}>
            {busy ? "Saving…" : "Save direction"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
