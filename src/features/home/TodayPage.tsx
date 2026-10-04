import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Flag,
  Plus,
  X,
} from "lucide-react";
import {
  EMPTY_GOAL,
  goalInputSchema,
  goalProgress,
  type Goal,
  type GoalInput,
} from "../../../shared/goals";
import {
  addDays,
  localDate,
  niceDate,
  safeUrl,
  type WorkRecord,
} from "../../../shared/model";
import {
  Button,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
} from "../../components/ui";
import { useWorkspace } from "../../lib/workspace";
import { useGoals } from "../../lib/goals";
import { useLearningData } from "../learn/useLearningData";
import { roadmapTopics } from "../../content/problems";
import { InterviewEditor } from "../search/InterviewEditor";
import {
  dayDistance,
  timelineItems,
  timelineLayout,
  timelineWeeks,
  windowItems,
  type TimelineItem,
} from "./timeline";
import "./timeline.css";

function goalInput(goal: Goal): GoalInput {
  return Object.fromEntries(
    Object.keys(EMPTY_GOAL).map((key) => [key, goal[key as keyof GoalInput]]),
  ) as GoalInput;
}
function observedProgress(
  goal: Goal,
  learning: ReturnType<typeof useLearningData>,
): number | undefined {
  if (!learning.configured) return undefined;
  if (goal.measure === "curriculum") {
    if (!learning.source.progress.fetchedAt) return undefined;
    const tasks = learning.weeks
      .filter((week) => !goal.scope || String(week.week) === goal.scope)
      .flatMap((week) => week.tasks ?? []);
    return tasks.filter((task) => learning.tasks[task.id]).length;
  }
  if (goal.measure === "problems") {
    if (!learning.stats) return undefined;
    const slugs = new Set(
      roadmapTopics
        .filter((topic) => !goal.scope || topic.id === goal.scope)
        .flatMap((topic) => topic.problems.map((problem) => problem.slug)),
    );
    return [...learning.solvedSlugs].filter((slug) => slugs.has(slug)).length;
  }
  if (goal.measure === "leetcode")
    return learning.stats?.solved.find((item) => item.difficulty === "All")
      ?.count;
  return undefined;
}

export function TodayPage() {
  const { records, preferences, user } = useWorkspace();
  const model = useGoals();
  const learning = useLearningData();
  const today = localDate(new Date(), preferences.timezone);
  const [offset, setOffset] = useState(0),
    [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<Goal | null | undefined>(),
    [selectedGoal, setSelectedGoal] = useState<string | null>(null);
  const [interview, setInterview] = useState<WorkRecord | null | undefined>();
  const [selectedEvent, setSelectedEvent] = useState<TimelineItem | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [width, setWidth] = useState(800);
  const graphRef = useRef<HTMLDivElement>(null);
  const checkpointAttempts = useRef(new Set<string>());
  const span = expanded ? 90 : 42;
  const start = addDays(today, offset - (expanded ? 21 : 7)),
    end = addDays(start, span);
  const items = timelineItems(
    records,
    model.goals,
    preferences.timezone,
    today,
  );
  const visible = windowItems(items, start, end);
  const goalSpans = model.goals.filter(
    (goal) =>
      goal.startDate &&
      goal.targetDate &&
      goal.startDate <= end &&
      goal.targetDate >= start &&
      !goal.deletedAt,
  );
  const chartItems = visible.filter(
    (item) =>
      !(
        item.goal &&
        item.id.endsWith(":target") &&
        goalSpans.some((goal) => goal.id === item.goal!.id)
      ),
  );
  const layout = timelineLayout(chartItems, start, end, width);
  const lanes = Math.max(1, ...layout.map((item) => item.lane + 1));
  const currentGoal = model.goals.find((goal) => goal.id === selectedGoal);
  useEffect(() => {
    const node = graphRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(280, entries[0].contentRect.width)),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [model.loading]);
  useEffect(() => {
    for (const goal of model.goals) {
      const value = observedProgress(goal, learning);
      const source =
        goal.measure === "curriculum"
          ? learning.source.progress
          : learning.source.stats;
      if (
        value === undefined ||
        goal.value === value ||
        !source.fetchedAt ||
        source.stale ||
        goal.status === "completed"
      )
        continue;
      const key = `${user?.id}:${goal.id}:${goal.measure}:${goal.scope}:${source.fetchedAt}:${value}`;
      if (checkpointAttempts.current.has(key)) continue;
      checkpointAttempts.current.add(key);
      void model
        .checkpoint(goal, value, source.fetchedAt)
        .catch(() => void model.refresh());
    }
  }, [
    model.goals,
    model.checkpoint,
    model.refresh,
    learning.tasks,
    learning.stats,
    learning.source,
    learning.weeks,
    learning.configured,
    learning.solvedSlugs,
    user?.id,
  ]);
  const openEvent = (item: TimelineItem) => {
    if (item.goal) setSelectedGoal(item.goal.id);
    else if (item.record?.kind === "interview") setInterview(item.record);
    else setSelectedEvent(item);
  };
  const saveChange = async (goal: Goal, patch: Partial<GoalInput>) => {
    setBusy(true);
    setError("");
    try {
      await model.save({ ...goalInput(goal), ...patch }, goal);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page-stack home-page">
      <PageHeader
        title="Home"
        action={
          <div className="inline-actions">
            <Button variant="secondary" onClick={() => setInterview(null)}>
              <CalendarDays size={16} />
              Add interview
            </Button>
            <Button onClick={() => setEditing(null)}>
              <Plus size={17} />
              Add goal
            </Button>
          </div>
        }
      />
      {model.error && (
        <div role="alert" className="notice notice-warning">
          {model.error}
          <Button variant="ghost" onClick={() => void model.refresh()}>
            Retry
          </Button>
        </div>
      )}
      <section className="timeline-board" aria-label="Career timeline">
        <div className="timeline-heading">
          <div>
            <span className="timeline-date">
              {new Intl.DateTimeFormat("en-AU", {
                weekday: "long",
                day: "numeric",
                month: "long",
                timeZone: preferences.timezone,
              }).format(new Date())}
            </span>
            <h2>Timeline</h2>
          </div>
          <div className="timeline-navigation">
            <Button
              variant="ghost"
              className="icon-button"
              aria-label="Earlier dates"
              onClick={() => setOffset(offset - span)}
            >
              <ChevronLeft size={18} />
            </Button>
            <Button variant="ghost" onClick={() => setOffset(0)}>
              Today
            </Button>
            <Button
              variant="ghost"
              className="icon-button"
              aria-label="Later dates"
              onClick={() => setOffset(offset + span)}
            >
              <ChevronRight size={18} />
            </Button>
            <Button
              variant="ghost"
              aria-expanded={expanded}
              onClick={() => {
                setExpanded(!expanded);
                setOffset(0);
              }}
            >
              {expanded ? "Less" : "Expand"}
            </Button>
          </div>
        </div>
        <p className="timeline-range">
          {niceDate(start)} – {niceDate(end)} {end.slice(0, 4)}
        </p>
        {model.loading ? (
          <p role="status" className="timeline-empty">
            Loading timeline…
          </p>
        ) : (
          <>
            <div
              className="timeline-chart"
              ref={graphRef}
              style={{
                height: `${lanes * 100 + 80 + goalSpans.length * 48}px`,
              }}
            >
              {timelineWeeks(start, end).map((date) => (
                <div
                  key={date}
                  className="timeline-gridline"
                  style={{
                    left: `${(dayDistance(start, date) / span) * 100}%`,
                  }}
                >
                  <span>{niceDate(date)}</span>
                </div>
              ))}
              {today >= start && today <= end && (
                <div
                  className="timeline-now"
                  style={{
                    left: `${(dayDistance(start, today) / span) * 100}%`,
                  }}
                >
                  <span>Today</span>
                </div>
              )}
              <div className="timeline-axis" />
              {layout.map(({ item, x, left, lane, cardWidth }) => (
                <div
                  key={item.id}
                  className={`timeline-event timeline-${item.kind} ${item.completed ? "is-complete" : ""}`}
                  style={{
                    left: `${left}px`,
                    top: `${lane * 100 + 64}px`,
                    width: `${cardWidth}px`,
                  }}
                >
                  <span
                    className="timeline-event-stem"
                    style={{
                      left: `${x - left}px`,
                      height: `${lane * 100 + 30}px`,
                      top: `-${lane * 100 + 30}px`,
                    }}
                  />
                  <button onClick={() => openEvent(item)}>
                    <span
                      className="timeline-event-point"
                      style={{
                        left: `${x - left - 8}px`,
                        top: `${-38 - lane * 100}px`,
                      }}
                    />
                    <span className="timeline-event-date">
                      {niceDate(item.date)}
                    </span>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </button>
                </div>
              ))}
              {goalSpans.map((goal, index) => {
                const left = Math.max(
                    0,
                    (dayDistance(start, goal.startDate) / span) * 100,
                  ),
                  right = Math.min(
                    100,
                    (dayDistance(start, goal.targetDate) / span) * 100,
                  );
                const progress = goalProgress(
                  goal,
                  observedProgress(goal, learning),
                );
                return (
                  <button
                    key={goal.id}
                    className="timeline-goal-span"
                    style={{
                      left: `${left}%`,
                      width: `${Math.max(3, right - left)}%`,
                      top: `${lanes * 100 + 64 + index * 48}px`,
                    }}
                    onClick={() => setSelectedGoal(goal.id)}
                    aria-label={`${goal.title}: ${goal.startDate} to ${goal.targetDate}, ${Math.round(progress.percent)}% complete`}
                  >
                    <span
                      className="timeline-span-fill"
                      style={{ width: `${progress.percent}%` }}
                    />
                    <span className="timeline-span-label">
                      {goal.title} · {Math.round(progress.percent)}%
                    </span>
                  </button>
                );
              })}
              {!visible.length && !goalSpans.length && (
                <p className="timeline-no-events">
                  No dates scheduled in this period.
                </p>
              )}
            </div>
            <div className="timeline-mobile" aria-label="Scheduled dates">
              {visible.map((item) => (
                <button
                  key={item.id}
                  className={`chronology-row timeline-${item.kind} ${item.completed ? "is-complete" : ""}`}
                  onClick={() => openEvent(item)}
                >
                  <time dateTime={item.date}>{niceDate(item.date)}</time>
                  <span className="chronology-point" />
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))}
              {!visible.length && (
                <p className="timeline-empty">
                  No dates scheduled in this period.
                </p>
              )}
            </div>
            <div className="timeline-goals">
              <div className="section-heading">
                <h3>Goals</h3>
                <span className="muted">
                  {
                    model.goals.filter(
                      (goal) =>
                        !goalProgress(goal, observedProgress(goal, learning))
                          .complete,
                    ).length
                  }{" "}
                  active
                </span>
              </div>
              {model.goals.length ? (
                <div className="goal-grid">
                  {model.goals.map((goal) => {
                    const progress = goalProgress(
                      goal,
                      observedProgress(goal, learning),
                    );
                    return (
                      <button
                        className={`goal-card ${progress.complete ? "goal-complete" : ""}`}
                        key={goal.id}
                        onClick={() => {
                          setError("");
                          setSelectedGoal(goal.id);
                        }}
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
                            <Flag size={17} />
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
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="muted">No goals added.</p>
              )}
            </div>
          </>
        )}
      </section>
      <div className="home-shortcuts">
        <Link to="/learn">
          Learn
          <ArrowUpRight size={15} />
        </Link>
        <Link to="/applications">
          Applications
          <ArrowUpRight size={15} />
        </Link>
        <Link to="/documents">
          Documents
          <ArrowUpRight size={15} />
        </Link>
      </div>
      {editing !== undefined && (
        <GoalEditor
          key={editing?.id ?? "new"}
          goal={editing}
          owner={user?.id ?? ""}
          weeks={learning.weeks}
          onClose={() => setEditing(undefined)}
          onSave={async (input) => {
            await model.save(input, editing ?? undefined);
            setEditing(undefined);
          }}
        />
      )}
      <Modal
        open={!!currentGoal}
        onClose={() => {
          setSelectedGoal(null);
          setError("");
        }}
        title={currentGoal?.title ?? "Goal"}
      >
        {currentGoal && (
          <div className="stack goal-detail">
            {error && (
              <p role="alert" className="notice notice-warning">
                {error}
              </p>
            )}
            {currentGoal.startDate && (
              <small className="muted">
                Started {niceDate(currentGoal.startDate)}{" "}
                {currentGoal.startDate.slice(0, 4)}
              </small>
            )}
            <div className="goal-detail-date">
              <Flag size={18} />
              {currentGoal.targetDate
                ? `Target: ${niceDate(currentGoal.targetDate)} ${currentGoal.targetDate.slice(0, 4)}`
                : "No target date"}
            </div>
            <div
              className="goal-progress"
              role="progressbar"
              aria-label="Goal progress"
              aria-valuenow={Math.round(
                goalProgress(
                  currentGoal,
                  observedProgress(currentGoal, learning),
                ).percent,
              )}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span
                style={{
                  width: `${goalProgress(currentGoal, observedProgress(currentGoal, learning)).percent}%`,
                }}
              />
            </div>
            {currentGoal.measure !== "completion" && (
              <p className="goal-numbers">
                {
                  goalProgress(
                    currentGoal,
                    observedProgress(currentGoal, learning),
                  ).value
                }{" "}
                / {goalProgress(currentGoal).target} {currentGoal.unit}
              </p>
            )}
            {currentGoal.milestones.map((milestone) => (
              <label className="goal-milestone" key={milestone.id}>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={milestone.done}
                  onChange={(event) =>
                    void saveChange(currentGoal, {
                      milestones: currentGoal.milestones.map((item) =>
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
            {safeUrl(currentGoal.sourceUrl) && (
              <a
                className="text-link"
                href={safeUrl(currentGoal.sourceUrl)!}
                target="_blank"
                rel="noreferrer"
              >
                Open source
                <ArrowUpRight size={15} />
              </a>
            )}
            {["curriculum", "problems", "leetcode"].includes(
              currentGoal.measure,
            ) && (
              <div className="goal-source-state">
                <Link to="/learn">Learning progress ↗</Link>
                <small>
                  {learning.configured
                    ? currentGoal.measure === "problems"
                      ? "Counts confirmed distinct problems in tracked history."
                      : "From your linked learning account."
                    : "Set your LeetCode handle in Learn to update this goal."}
                </small>
                {(currentGoal.measure === "curriculum"
                  ? learning.source.progress
                  : learning.source.stats
                ).stale && (
                  <small>Showing the last available source data.</small>
                )}
                {(currentGoal.measure === "curriculum"
                  ? learning.source.progress
                  : learning.source.stats
                ).fetchedAt && (
                  <small>
                    Updated{" "}
                    {new Intl.DateTimeFormat("en-AU", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: preferences.timezone,
                    }).format(
                      new Date(
                        (currentGoal.measure === "curriculum"
                          ? learning.source.progress
                          : learning.source.stats
                        ).fetchedAt!,
                      ),
                    )}
                  </small>
                )}
              </div>
            )}
            {!!currentGoal.checkpoints.length && (
              <details>
                <summary>Progress history</summary>
                <div className="goal-checkpoints">
                  {currentGoal.checkpoints
                    .slice()
                    .reverse()
                    .map((checkpoint, index) => (
                      <div key={`${checkpoint.at}:${index}`}>
                        <time>
                          {niceDate(
                            localDate(
                              new Date(checkpoint.at),
                              preferences.timezone,
                            ),
                          )}
                        </time>
                        <strong>
                          {checkpoint.value}{" "}
                          {checkpoint.unit ?? currentGoal.unit}
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
                  void saveChange(currentGoal, {
                    status:
                      currentGoal.status === "completed"
                        ? "active"
                        : "completed",
                    completedAt:
                      currentGoal.status === "completed"
                        ? null
                        : new Date().toISOString(),
                  })
                }
              >
                {currentGoal.status === "completed"
                  ? "Reopen"
                  : "Mark complete"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setEditing(currentGoal);
                  setSelectedGoal(null);
                }}
              >
                Edit goal
              </Button>
            </div>
            <details>
              <summary>Remove goal</summary>
              <Button
                variant="danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await model.remove(currentGoal);
                    setSelectedGoal(null);
                  } catch (error) {
                    setError(
                      error instanceof Error
                        ? error.message
                        : "Could not remove goal.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Remove goal
              </Button>
              <p className="muted">Removed goals remain in your backup.</p>
            </details>
          </div>
        )}
      </Modal>
      <Modal
        open={!!selectedEvent}
        onClose={() => setSelectedEvent(null)}
        title={selectedEvent?.title ?? "Event"}
      >
        <div className="stack">
          <p>
            {selectedEvent?.detail} ·{" "}
            {selectedEvent && niceDate(selectedEvent.date)}
          </p>
          <Link
            className="text-link"
            to={`/applications?record=${selectedEvent?.record?.id}`}
            onClick={() => setSelectedEvent(null)}
          >
            Open application
            <ArrowUpRight size={16} />
          </Link>
        </div>
      </Modal>
      <InterviewEditor
        open={interview !== undefined}
        record={interview ?? undefined}
        onClose={() => setInterview(undefined)}
      />
    </div>
  );
}

function GoalEditor({
  goal,
  owner,
  weeks,
  onClose,
  onSave,
}: {
  goal: Goal | null;
  owner: string;
  weeks: { week: number; title: string }[];
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
    localStorage.removeItem(key);
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
                <option value="curriculum">Curriculum tasks</option>
                <option value="problems">Roadmap problems</option>
                <option value="leetcode">Total LeetCode problems</option>
              </Select>
            </Field>
            {form.measure === "curriculum" && (
              <Field label="Curriculum scope">
                <Select
                  value={form.scope}
                  onChange={(event) => set({ scope: event.target.value })}
                >
                  <option value="">All weeks</option>
                  {weeks.map((week) => (
                    <option key={week.week} value={week.week}>
                      {week.title}
                    </option>
                  ))}
                </Select>
              </Field>
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
