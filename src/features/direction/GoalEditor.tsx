import { useRef } from "react";
import { Trash2 } from "lucide-react";
import {
  actionInput,
  actionGoalIds,
  actionLinks,
  goalInputSchema,
  type Goal,
  type GoalInput,
  goalProgress,
  eventStatus,
} from "../../../shared/goals";
import { type WorkRecord, niceDate } from "../../../shared/model";
import { Button, Card, CompactSelect, Field, Input } from "../../components/ui";
import { ApiError } from "../../lib/api";
import { useEditMode } from "../../lib/edit-mode";
import { useAutosave } from "../../lib/autosave";
import { ActionDateBar } from "./ScheduleBars";
import type { DateAxis } from "./goalSchedule";
import { roadmapTotalProblems } from "../../content/problems";
export const goalInput = actionInput;
export function GoalEditor({
  goal,
  owner,
  directions,
  onSave,
  onRefresh,
  onDelete,
  observed,
  dateAxis,
  today,
}: {
  goal: Goal;
  owner: string;
  directions: WorkRecord[];
  onSave: (input: GoalInput, previous: Goal) => Promise<Goal>;
  onRefresh: () => Promise<void>;
  onDelete: () => Promise<void>;
  observed?: number;
  dateAxis: DateAxis | null;
  today: string;
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
        title: value.title.trim() || "Untitled action",
      });
      const base =
        expectedVersion === undefined || goal.version === expectedVersion
          ? goal
          : current.current.version === expectedVersion
            ? current.current
            : null;
      if (!base)
        throw new ApiError(
          "This action changed elsewhere. Review both copies.",
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
  const progress = goalProgress({ ...goal, ...form }, observed, today);
  const linkedNames = directions
    .filter((record) => actionGoalIds(form).includes(record.id))
    .map((record) => record.title);
  return (
    <Card
      id={`direction-item-${goal.id}`}
      className={`stack goal-inline-card ${progress.complete ? "goal-complete" : ""} ${editing ? "is-editing" : ""}`}
    >
      {conflict && (
        <div className="notice notice-warning" role="alert">
          {error || "This action changed elsewhere."}
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
            aria-label="Action name"
            value={form.title === "Untitled action" ? "" : form.title}
            placeholder="Action name"
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
      <ActionDateBar
        start={form.startDate}
        end={form.targetDate}
        axis={dateAxis}
      />
      {editing ? (
        <div className="action-edit-fields">
          <Field label="Schedule">
            <CompactSelect
              value={form.scheduleKind ?? "range"}
              onChange={(event) => {
                const scheduleKind = event.target.value as "event" | "range";
                const date = form.startDate || form.targetDate;
                set({
                  scheduleKind,
                  ...(scheduleKind === "event"
                    ? { startDate: date, targetDate: date }
                    : {}),
                });
              }}
            >
              <option value="range">Date range</option>
              <option value="event">One-day event</option>
            </CompactSelect>
          </Field>
          <div className="form-grid direction-date-fields">
            {form.scheduleKind === "event" ? (
              <Field label="Event date">
                <Input
                  type="date"
                  value={form.targetDate}
                  onChange={(event) =>
                    set({
                      startDate: event.target.value,
                      targetDate: event.target.value,
                    })
                  }
                />
              </Field>
            ) : (
              <>
                <Field label="Start date">
                  <Input
                    type="date"
                    value={form.startDate}
                    onChange={(event) => set({ startDate: event.target.value })}
                  />
                </Field>
                <Field label="End date">
                  <Input
                    type="date"
                    value={form.targetDate}
                    onChange={(event) =>
                      set({ targetDate: event.target.value })
                    }
                  />
                </Field>
              </>
            )}
          </div>
          <Field label="Progress measure">
            <CompactSelect
              value={form.measure}
              onChange={(event) => {
                const measure = event.target.value as GoalInput["measure"];
                set({
                  measure,
                  target:
                    measure === "completion"
                      ? 1
                      : measure === "neetcode150"
                        ? roadmapTotalProblems
                        : form.measure === "leetcode"
                          ? form.target
                          : 1,
                });
              }}
            >
              <option value="completion">Complete / incomplete</option>
              <option value="leetcode">Total LeetCode problems solved</option>
              <option value="neetcode150">NeetCode 150</option>
            </CompactSelect>
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
          <fieldset className="action-goal-links">
            <legend>Goals</legend>
            {directions.length ? (
              directions.map((record) => (
                <label className="action-goal-option" key={record.id}>
                  <input
                    type="checkbox"
                    checked={actionGoalIds(form).includes(record.id)}
                    disabled={
                      actionGoalIds(form).length === 1 &&
                      actionGoalIds(form).includes(record.id)
                    }
                    onChange={(event) => {
                      const ids = actionGoalIds(form);
                      set(
                        actionLinks(
                          event.target.checked
                            ? [...ids, record.id]
                            : ids.filter((id) => id !== record.id),
                        ),
                      );
                    }}
                  />
                  <span>{record.title}</span>
                </label>
              ))
            ) : (
              <p className="muted">Add a goal to link this action.</p>
            )}
          </fieldset>
        </div>
      ) : linkedNames.length > 1 ? (
        <p className="action-shared-goals">
          Supports {linkedNames.join(" · ")}
        </p>
      ) : null}
      <div className="action-footer">
        {form.scheduleKind === "event" && (
          <span className="action-event-badge">Event</span>
        )}
        {form.scheduleKind === "event" && form.measure !== "completion" && (
          <span className="action-status">
            {eventStatus(form.targetDate, today)}
          </span>
        )}
        {form.measure === "completion" ? (
          <span className="action-status">
            {form.scheduleKind === "event"
              ? eventStatus(form.targetDate, today)
              : progress.complete
                ? "Complete"
                : "In progress"}
          </span>
        ) : (
          <div className="action-progress">
            <span>
              {form.measure === "neetcode150" ? "NeetCode 150" : "LeetCode"}
            </span>
            <div
              role="progressbar"
              aria-label={`${form.measure === "neetcode150" ? "NeetCode" : "LeetCode"} progress`}
              aria-valuenow={Math.min(progress.value, progress.target)}
              aria-valuemin={0}
              aria-valuemax={progress.target}
            >
              <span style={{ width: `${progress.percent}%` }} />
            </div>
            <strong>
              {progress.value} / {progress.target}
            </strong>
          </div>
        )}
        {form.sourceUrl && (
          <a href={form.sourceUrl} target="_blank" rel="noreferrer">
            Reference
          </a>
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
      </div>
      {form.milestones.length > 0 && (
        <div className="action-milestones">
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
