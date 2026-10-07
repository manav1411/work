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
import { ApiError } from "../../lib/api";
import { useEditMode } from "../../lib/edit-mode";
import { useAutosave } from "../../lib/autosave";
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
  onRefresh,
  onDelete,
  observed,
}: {
  goal: Goal;
  owner: string;
  directions: WorkRecord[];
  onSave: (input: GoalInput, previous: Goal) => Promise<Goal>;
  onRefresh: () => Promise<void>;
  onDelete: () => Promise<void>;
  observed?: number;
}) {
  const { editing } = useEditMode();
  const current = useRef(goal);
  if (goal.version > current.current.version) current.current = goal;
  const initial = goalInput(goal);
  const {
    value: form,
    setValue,
    state,
    error,
    flush,
    conflict,
    keepLocal,
    useSaved,
  } = useAutosave({
    initial,
    version: goal.version,
    storageKey: `work:goal-draft:${owner}:${goal.id}`,
    refresh: onRefresh,
    persist: async (value, expectedVersion) => {
      const parsed = goalInputSchema.parse({
        ...value,
        title: value.title.trim() || "Untitled goal",
      });
      const base =
        expectedVersion === undefined || goal.version === expectedVersion
          ? goal
          : current.current.version === expectedVersion
            ? current.current
            : null;
      if (!base)
        throw new ApiError(
          "This goal changed elsewhere. Review both copies.",
          409,
        );
      current.current = await onSave(parsed, base);
      return {
        version: current.current.version,
        value: goalInput(current.current),
      };
    },
  });
  const set = (patch: Partial<GoalInput>) =>
    setValue((previous) => ({ ...previous, ...patch }));
  const progress = goalProgress({ ...goal, ...form }, observed);
  return (
    <Card
      className={`stack goal-inline-card ${progress.complete ? "goal-complete" : ""}`}
    >
      {conflict && (
        <div className="notice notice-warning" role="alert">
          {error || "This goal changed elsewhere."}
          <div className="inline-actions">
            <Button variant="secondary" onClick={() => void keepLocal()}>
              Keep my changes
            </Button>
            <Button variant="ghost" onClick={useSaved}>
              Use saved version
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
                set({
                  measure,
                  target: measure === "completion" ? 1 : form.target,
                });
              }}
            >
              <option value="completion">Complete / incomplete</option>
              <option value="leetcode">LeetCode problems</option>
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
      <p>
        {form.measure === "completion"
          ? progress.complete
            ? "Complete"
            : "In progress"
          : `${progress.value} / ${progress.target} problems`}
      </p>
      {form.measure === "leetcode" && (
        <small className="muted">
          Total unique LeetCode problems solved: {progress.value}. Target:{" "}
          {progress.target}.
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
      {error && !conflict && (
        <p className="form-error" role="alert">
          {error}
          <Button variant="ghost" onClick={flush}>
            Retry
          </Button>
        </p>
      )}
    </Card>
  );
}
