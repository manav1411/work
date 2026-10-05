import { useRef } from "react";
import { Trash2 } from "lucide-react";
import {
  EMPTY_GOAL,
  goalInputSchema,
  type Goal,
  type GoalInput,
  goalProgress,
} from "../../../shared/goals";
import { type WorkRecord, niceDate } from "../../../shared/model";
import { Button, Card, Field, Input, Select } from "../../components/ui";
import { useEditMode } from "../../lib/edit-mode";
import { useInlineAutosave } from "./useInlineAutosave";
export function goalInput(goal: Goal): GoalInput {
  return Object.fromEntries(
    Object.keys(EMPTY_GOAL).map((key) => [
      key,
      goal[key as keyof GoalInput] ?? EMPTY_GOAL[key as keyof GoalInput],
    ]),
  ) as GoalInput;
}
export function GoalEditor({
  goal,
  owner,
  directions,
  onSave,
  onDelete,
  observed,
}: {
  goal: Goal;
  owner: string;
  directions: WorkRecord[];
  onSave: (input: GoalInput, previous: Goal) => Promise<Goal>;
  onDelete: () => Promise<void>;
  observed?: number;
}) {
  const { editing } = useEditMode();
  const current = useRef(goal);
  if (
    goal.version > current.current.version &&
    JSON.stringify({ ...goalInput(goal), value: 0 }) ===
      JSON.stringify({ ...goalInput(current.current), value: 0 })
  )
    current.current = goal;
  const initial = goalInput(goal);
  const {
    value: form,
    setValue,
    state,
    error,
    flush,
    recovered,
    acceptDraft,
    discardDraft,
  } = useInlineAutosave(
    initial,
    `work:goal-draft:${owner}:${goal.id}`,
    async (value) => {
      const parsed = goalInputSchema.parse({
        ...value,
        title: value.title.trim() || "Untitled goal",
        ...(value.measure === current.current.measure &&
        value.scope === current.current.scope
          ? { value: current.current.value }
          : {}),
      });
      current.current = await onSave(parsed, current.current);
    },
  );
  const set = (patch: Partial<GoalInput>) =>
    setValue((previous) => ({ ...previous, ...patch }));
  const progress = goalProgress({ ...goal, ...form }, observed);
  const legacy = !["completion", "leetcode"].includes(form.measure);
  return (
    <Card
      className={`stack goal-inline-card ${progress.complete ? "goal-complete" : ""}`}
    >
      {recovered && (
        <div className="notice notice-warning">
          Recovered device draft. Review before saving.
          <div className="inline-actions">
            <Button variant="secondary" onClick={acceptDraft}>
              Save recovered draft
            </Button>
            <Button variant="ghost" onClick={discardDraft}>
              Load saved goal
            </Button>
          </div>
        </div>
      )}
      <div className="section-heading">
        {editing ? (
          <Input
            className="inline-title"
            aria-label="Goal name"
            value={form.title === "Untitled goal" ? "" : form.title}
            placeholder="Goal name"
            onChange={(event) => set({ title: event.target.value })}
            onBlur={flush}
          />
        ) : (
          <h3>{form.title}</h3>
        )}
        {editing && (
          <Button
            variant="ghost"
            aria-label={`Delete ${form.title}`}
            onClick={() => void onDelete()}
          >
            <Trash2 size={15} />
          </Button>
        )}
      </div>
      {editing ? (
        <>
          <Field label="Direction">
            <Select
              value={form.directionId}
              onChange={(event) => set({ directionId: event.target.value })}
            >
              <option value="">No linked direction</option>
              {directions.map((record) => (
                <option value={record.id} key={record.id}>
                  {record.title}
                </option>
              ))}
            </Select>
          </Field>
          <div className="form-grid">
            <Field label="Start date">
              <Input
                type="date"
                value={form.startDate}
                onChange={(event) => set({ startDate: event.target.value })}
              />
            </Field>
            <Field label="Target date">
              <Input
                type="date"
                value={form.targetDate}
                onChange={(event) => set({ targetDate: event.target.value })}
              />
            </Field>
          </div>
          <Field label="Progress measure">
            <Select
              value={form.measure}
              onChange={(event) => {
                const measure = event.target.value as GoalInput["measure"];
                if (
                  legacy &&
                  !window.confirm(
                    "Convert this goal's measure? Recorded checkpoints remain in history; the new measure starts using its own source.",
                  )
                )
                  return;
                set({
                  measure,
                  scope: "",
                  target: measure === "completion" ? 1 : form.target,
                  unit: measure === "leetcode" ? "problems" : "",
                  value: 0,
                });
              }}
            >
              <option value="completion">Complete / incomplete</option>
              <option value="leetcode">LeetCode problems</option>
              {legacy && (
                <option value={form.measure}>
                  Recorded {form.measure} measure
                </option>
              )}
            </Select>
          </Field>
          {form.measure === "leetcode" && (
            <Field label="Target">
              <Input
                type="number"
                min={1}
                value={form.target}
                onChange={(event) =>
                  set({ target: Number(event.target.value) })
                }
              />
            </Field>
          )}
        </>
      ) : (
        <>
          <p className="muted">
            {directions.find((record) => record.id === form.directionId)
              ?.title || "No linked direction"}
          </p>
          <p>
            {form.startDate ? niceDate(form.startDate) : "No start date"} →{" "}
            {form.targetDate ? niceDate(form.targetDate) : "No target date"}
          </p>
        </>
      )}
      {legacy && (
        <p className="notice notice-warning">
          Recorded {form.measure} progress is preserved. Choose a supported
          measure explicitly to convert it.
        </p>
      )}
      <div
        className="goal-progress"
        role="progressbar"
        aria-label={`${form.title} progress`}
        aria-valuenow={Math.round(progress.percent)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ width: `${progress.percent}%` }} />
      </div>
      <p>
        {form.measure === "completion"
          ? progress.complete
            ? "Complete"
            : "In progress"
          : `${progress.value} / ${progress.target} ${form.unit}`}
      </p>
      {form.measure === "leetcode" && (
        <small className="muted">
          Total unique LeetCode problems solved: {progress.value}. Target:{" "}
          {progress.target}. Existing recorded checkpoints retain their original
          measure.
        </small>
      )}
      <Button
        variant="secondary"
        onClick={() =>
          set({
            status: form.status === "completed" ? "active" : "completed",
            completedAt:
              form.status === "completed" ? null : new Date().toISOString(),
          })
        }
      >
        {form.status === "completed" ? "Reopen" : "Mark complete"}
      </Button>
      {form.milestones.length > 0 && (
        <div className="stack">
          {form.milestones.map((item) => (
            <label className="goal-milestone" key={item.id}>
              <input
                type="checkbox"
                checked={item.done}
                onChange={(event) =>
                  set({
                    milestones: form.milestones.map((point) =>
                      point.id === item.id
                        ? {
                            ...point,
                            done: event.target.checked,
                            completedAt: event.target.checked
                              ? new Date().toISOString()
                              : null,
                          }
                        : point,
                    ),
                  })
                }
              />
              {item.title}
              {item.date && <small>{niceDate(item.date)}</small>}
            </label>
          ))}
        </div>
      )}
      {editing && <small role="status">{state}</small>}
      {error && (
        <p className="form-error" role="alert">
          {error}
          <Button variant="ghost" onClick={flush}>
            Retry
          </Button>
        </p>
      )}
      {goal.checkpoints.length > 0 && (
        <div className="goal-checkpoints">
          <h4>Progress history</h4>
          {goal.checkpoints
            .slice()
            .reverse()
            .map((point, index) => (
              <div key={`${point.at}:${index}`}>
                <time>{new Date(point.at).toLocaleDateString()}</time>
                <strong>
                  {point.value} {point.unit ?? goal.unit}
                </strong>
                <small>{point.measure ?? goal.measure}</small>
              </div>
            ))}
        </div>
      )}
    </Card>
  );
}
