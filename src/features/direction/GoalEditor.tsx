import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import {
  EMPTY_GOAL,
  goalInputSchema,
  type Goal,
  type GoalInput,
} from "../../../shared/goals";
import type { WorkRecord } from "../../../shared/model";
import { Button, Field, Input, Modal, Select } from "../../components/ui";
import { roadmapTopics } from "../../content/problems";
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
  onClose,
  onSave,
}: {
  goal: Goal | null;
  owner: string;
  directions: WorkRecord[];
  onClose: () => void;
  onSave: (input: GoalInput) => Promise<void>;
}) {
  const key = `work:goal-draft:${owner}:${goal?.id ?? "new"}`;
  const [form, setForm] = useState<GoalInput>(() => {
    try {
      const draft = JSON.parse(localStorage.getItem(key) ?? "null");
      if (draft && goalInputSchema.safeParse(draft).success) return draft;
    } catch {
      /* keep the saved record */
    }
    return goal ? goalInput(goal) : structuredClone(EMPTY_GOAL);
  });
  const [recovered, setRecovered] = useState(
    () =>
      JSON.stringify(form) !==
      JSON.stringify(goal ? goalInput(goal) : EMPTY_GOAL),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const set = (patch: Partial<GoalInput>) =>
    setForm((previous) => ({ ...previous, ...patch }));
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(form));
    } catch {
      /* editor stays open */
    }
  }, [form, key]);
  const close = () => {
    if (!error) localStorage.removeItem(key);
    onClose();
  };
  return (
    <Modal open onClose={close} title={goal ? "Edit goal" : "Add goal"}>
      <form
        className="stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          const parsed = goalInputSchema.safeParse(form);
          if (!parsed.success) {
            setError(parsed.error.issues[0].message);
            return;
          }
          setBusy(true);
          try {
            await onSave(parsed.data);
            localStorage.removeItem(key);
          } catch (error) {
            setError(
              error instanceof Error ? error.message : "Could not save goal.",
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
              the current goal.
            </p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setForm(goal ? goalInput(goal) : structuredClone(EMPTY_GOAL));
                setRecovered(false);
              }}
            >
              Load saved goal
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="notice notice-warning">
            {error}
          </p>
        )}
        <Field label="Goal">
          <Input
            autoFocus
            value={form.title}
            required
            onChange={(event) => set({ title: event.target.value })}
          />
        </Field>
        <Field label="Related direction">
          <Select
            value={form.directionId ?? ""}
            onChange={(event) => set({ directionId: event.target.value })}
          >
            <option value="">No direction selected</option>
            {directions.map((record) => (
              <option key={record.id} value={record.id}>
                {record.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Target date">
          <Input
            type="date"
            value={form.targetDate}
            onChange={(event) => set({ targetDate: event.target.value })}
          />
        </Field>
        <details
          className="goal-options"
          open={goal?.measure !== undefined && goal.measure !== "completion"}
        >
          <summary>Progress and details</summary>
          <div className="stack">
            <Field label="Progress measure">
              <Select
                value={form.measure}
                onChange={(event) => {
                  const measure = event.target.value as GoalInput["measure"];
                  set({
                    measure,
                    scope: "",
                    target: measure === "completion" ? 1 : form.target,
                    unit:
                      measure === "curriculum"
                        ? "tasks"
                        : measure === "problems" || measure === "leetcode"
                          ? "problems"
                          : form.unit,
                  });
                }}
              >
                <option value="completion">Complete / incomplete</option>
                <option value="manual">A number I update</option>
                <option value="milestones">Milestones</option>
                {goal?.measure === "curriculum" && (
                  <option value="curriculum">
                    Curriculum tasks (retired source)
                  </option>
                )}
                <option value="problems">Roadmap problems</option>
                <option value="leetcode">Total LeetCode problems</option>
              </Select>
            </Field>
            {form.measure === "curriculum" && (
              <p className="notice notice-warning">
                The Weeks source has been retired. Existing recorded progress is
                preserved; select another measure to convert this goal.
              </p>
            )}
            {form.measure === "problems" && (
              <Field label="Problem collection">
                <Select
                  value={form.scope}
                  onChange={(event) => set({ scope: event.target.value })}
                >
                  <option value="">All roadmap problems</option>
                  {roadmapTopics.map((topic) => (
                    <option key={topic.id} value={topic.id}>
                      {topic.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {!["completion", "milestones"].includes(form.measure) && (
              <div className="form-grid">
                <Field label="Target">
                  <Input
                    type="number"
                    min="1"
                    value={form.target}
                    required
                    onChange={(event) =>
                      set({ target: Number(event.target.value) })
                    }
                  />
                </Field>
                {form.measure === "manual" && (
                  <Field label="Current progress">
                    <Input
                      type="number"
                      min="0"
                      value={form.value}
                      onChange={(event) =>
                        set({ value: Number(event.target.value) })
                      }
                    />
                  </Field>
                )}
                <Field label="Unit">
                  <Input
                    value={form.unit}
                    onChange={(event) => set({ unit: event.target.value })}
                  />
                </Field>
              </div>
            )}
            {form.measure === "milestones" && (
              <div className="stack">
                {form.milestones.map((milestone) => (
                  <div className="goal-milestone-editor" key={milestone.id}>
                    <Field label="Milestone">
                      <Input
                        value={milestone.title}
                        required
                        onChange={(event) =>
                          set({
                            milestones: form.milestones.map((item) =>
                              item.id === milestone.id
                                ? { ...item, title: event.target.value }
                                : item,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field label="Date">
                      <Input
                        type="date"
                        value={milestone.date}
                        onChange={(event) =>
                          set({
                            milestones: form.milestones.map((item) =>
                              item.id === milestone.id
                                ? { ...item, date: event.target.value }
                                : item,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Button
                      type="button"
                      variant="ghost"
                      className="icon-button"
                      aria-label={`Remove ${milestone.title || "milestone"}`}
                      onClick={() =>
                        set({
                          milestones: form.milestones.filter(
                            (item) => item.id !== milestone.id,
                          ),
                        })
                      }
                    >
                      <X size={16} />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() =>
                    set({
                      milestones: [
                        ...form.milestones,
                        {
                          id: crypto.randomUUID(),
                          title: "",
                          date: "",
                          done: false,
                          completedAt: null,
                        },
                      ],
                    })
                  }
                >
                  <Plus size={16} />
                  Add milestone
                </Button>
              </div>
            )}
            <Field label="Start date">
              <Input
                type="date"
                value={form.startDate}
                onChange={(event) => set({ startDate: event.target.value })}
              />
            </Field>
            <Field label="Source link">
              <Input
                type="url"
                value={form.sourceUrl}
                placeholder="https://"
                onChange={(event) => set({ sourceUrl: event.target.value })}
              />
            </Field>
          </div>
        </details>
        <div className="inline-actions">
          <Button type="submit" disabled={busy || !form.title.trim()}>
            {busy ? "Saving…" : "Save goal"}
          </Button>
          <Button variant="ghost" type="button" onClick={close}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
