import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type MutableRefObject,
} from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  ListChecks,
  Plus,
  Target,
  Trash2,
} from "lucide-react";
import {
  goalProgress,
  EMPTY_GOAL,
  actionGoalIds,
  actionLinks,
  actionInput,
  actionOrder,
  type Goal,
} from "../../../shared/goals";
import {
  DIRECTION_KINDS,
  directionDataSchema,
} from "../../../shared/direction";
import {
  field,
  niceDate,
  localDate,
  type RecordPatch,
  type WorkRecord,
} from "../../../shared/model";
import {
  Button,
  Card,
  CompactSelect,
  Field,
  Input,
  PageHeader,
  SectionTabs,
} from "../../components/ui";
import { useWorkspace } from "../../lib/workspace";
import { useEditMode } from "../../lib/edit-mode";
import { useGoals } from "../../lib/goals";
import { useLearningData } from "../learn/useLearningData";
import { observedProgress } from "./goalMetrics";
import { GoalEditor } from "./GoalEditor";
import { GoalDateBar } from "./ScheduleBars";
import { goalDateAxis, scheduleDate } from "./goalSchedule";
import { flushAutosaves, useAutosave } from "../../lib/autosave";
import { RichDocumentEditor } from "../content/RichDocumentEditor";
import { SortableList } from "../content/SortableList";
import { normalizeWebUrl } from "../../../shared/urls";
import { reorderRecords } from "../content/reorderRecords";
import "../home/timeline.css";
import "./direction.css";

const STATUSES = ["Future", "Exploring", "Pursuing", "Achieved"];

export function DirectionPage() {
  const workspace = useWorkspace();
  const { editing } = useEditMode();
  const model = useGoals();
  const learning = useLearningData();
  const [params, setParams] = useSearchParams();
  const [scale, setScale] = useState<"quarter" | "year">("quarter");
  const [error, setError] = useState("");
  const beforeLeave = useRef<(() => boolean) | null>(null);
  const [detailHost, setDetailHost] = useState<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState(() =>
    window.innerWidth <= 600 ? 1 : window.innerWidth <= 1000 ? 2 : 3,
  );
  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 600px)");
    const tablet = window.matchMedia("(max-width: 1000px)");
    const update = () =>
      setColumns(mobile.matches ? 1 : tablet.matches ? 2 : 3);
    mobile.addEventListener("change", update);
    tablet.addEventListener("change", update);
    update();
    return () => {
      mobile.removeEventListener("change", update);
      tablet.removeEventListener("change", update);
    };
  }, []);
  const directions = workspace.records
    .filter((record) =>
      DIRECTION_KINDS.includes(record.kind as (typeof DIRECTION_KINDS)[number]),
    )
    .sort(
      (a, b) =>
        Number(a.data.directionOrder ?? 0) -
          Number(b.data.directionOrder ?? 0) ||
        a.createdAt.localeCompare(b.createdAt),
    );
  const selectedGoal = model.goals.find(
    (goal) => goal.id === params.get("action"),
  );
  const selected =
    directions.find((record) => record.id === params.get("goal")) ||
    directions.find(
      (record) =>
        selectedGoal && actionGoalIds(selectedGoal).includes(record.id),
    );
  const today = localDate(new Date(), workspace.preferences.timezone);
  const entries = [
    ...model.goals
      .filter((goal) => goal.targetDate)
      .map((goal) => ({
        id: goal.id,
        targetId: goal.id,
        date: goal.targetDate,
        title: goal.title,
        done: goalProgress(goal, observedProgress(goal, learning), today)
          .complete,
        goal: true,
        kind: "action" as const,
      })),
    ...model.goals.flatMap((goal) =>
      goal.milestones
        .filter((item) => item.date)
        .map((item) => ({
          id: `${goal.id}:${item.id}`,
          targetId: goal.id,
          date: item.date,
          title: item.title,
          done: item.done,
          goal: true,
          kind: "task" as const,
        })),
    ),
    ...directions
      .filter(
        (record) => field(record, "endDate") || field(record, "reviewDate"),
      )
      .map((record) => ({
        id: record.id,
        targetId: record.id,
        date: field(record, "endDate") || field(record, "reviewDate"),
        title: record.title,
        done: ["Achieved", "Completed"].includes(field(record, "status")),
        goal: false,
        kind: "goal" as const,
      })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const groups = new Map<string, typeof entries>();
  entries.forEach((entry) => {
    const group = `${entry.date.slice(0, 4)}${scale === "quarter" ? ` · Q${Math.ceil(Number(entry.date.slice(5, 7)) / 3)}` : ""}`;
    groups.set(group, [...(groups.get(group) ?? []), entry]);
  });
  const act = (action: () => Promise<unknown>) =>
    void action().catch((failure) =>
      setError(failure instanceof Error ? failure.message : "Could not save."),
    );
  const flushEdits = async () => {
    if (beforeLeave.current && !beforeLeave.current())
      throw new Error("Finish the new link before changing focus.");
    if (!(await flushAutosaves()))
      throw new Error("Resolve the unsaved edits before changing focus.");
  };
  const selectDirection = async (id: string, toggle = false) => {
    await flushEdits();
    setParams(toggle && id === selected?.id ? {} : { goal: id });
  };
  useEffect(() => {
    if (!selected) return;
    const snapshot = params.toString();
    const dismiss = () => {
      void (async () => {
        if (beforeLeave.current && !beforeLeave.current())
          throw new Error("Finish the new link before changing focus.");
        if (!(await flushAutosaves()))
          throw new Error("Resolve the unsaved edits before changing focus.");
      })()
        .then(() =>
          setParams((current) =>
            current.toString() === snapshot ? new URLSearchParams() : current,
          ),
        )
        .catch((failure) =>
          setError(
            failure instanceof Error ? failure.message : "Could not save.",
          ),
        );
    };
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (
        !(target instanceof Element) ||
        target.closest(
          ".direction-choice, #direction-detail, .direction-timeline-item, [data-goal-tools], [role=dialog], [role=listbox], [data-radix-popper-content-wrapper], a[href]",
        )
      )
        return;
      dismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !(
          event.target instanceof Element &&
          event.target.closest("[role=dialog], [role=listbox]")
        )
      )
        dismiss();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [params, selected, setParams]);
  const goalSection = (
    goals: Goal[],
    directionId: string,
    dates: { startDate: string; endDate: string },
  ) => (
    <section className="direction-goals" aria-label="Actions">
      <div className="section-heading">
        <h2>
          Actions
          <span className="direction-count" aria-hidden="true">
            {goals.length}
          </span>
        </h2>
        <GoalDateBar
          start={dates.startDate}
          end={dates.endDate}
          axis={goalDateAxis(dates.startDate, dates.endDate, goals)}
          today={today}
        />
        {editing && (
          <div className="action-tools" data-goal-tools>
            <CompactSelect
              aria-label="Link existing action"
              value=""
              onChange={(event) => {
                const action = model.goals.find(
                  (item) => item.id === event.target.value,
                );
                if (action)
                  act(async () => {
                    await flushEdits();
                    await model.save(
                      {
                        ...actionInput(action),
                        ...actionLinks([...actionGoalIds(action), directionId]),
                      },
                      action,
                    );
                  });
              }}
            >
              <option value="">Link action…</option>
              {model.goals
                .filter(
                  (action) => !actionGoalIds(action).includes(directionId),
                )
                .map((action) => (
                  <option key={action.id} value={action.id}>
                    {action.title}
                  </option>
                ))}
            </CompactSelect>
            <Button
              variant="secondary"
              onClick={() =>
                act(async () => {
                  await flushEdits();
                  const goal = await model.save({
                    ...EMPTY_GOAL,
                    title: "Untitled action",
                    ...actionLinks(directionId ? [directionId] : []),
                  });
                  setParams({
                    ...(directionId ? { goal: directionId } : {}),
                    action: goal.id,
                  });
                })
              }
            >
              <Plus size={15} />
              Add action
            </Button>
          </div>
        )}
      </div>
      {model.loading ? (
        <p className="muted" role="status">
          Loading actions…
        </p>
      ) : goals.length ? (
        <div className="direction-goal-list">
          {goals.map((goal) => (
            <GoalEditor
              key={goal.id}
              goal={goal}
              owner={workspace.user?.id ?? ""}
              directions={directions}
              onSave={model.save}
              onRefresh={model.refresh}
              onDelete={() => model.remove(goal)}
              observed={observedProgress(goal, learning)}
              today={today}
              dateAxis={goalDateAxis(dates.startDate, dates.endDate, goals)}
            />
          ))}
        </div>
      ) : (
        <p className="direction-empty">
          Add an action to give this goal a concrete next step.
        </p>
      )}
    </section>
  );
  return (
    <div className="page-stack direction-page">
      <PageHeader title="Goals" />
      {(error || model.error) && (
        <p className="form-error" role="alert">
          {error || model.error}
        </p>
      )}
      <Card className="direction-overview">
        <div className="section-heading">
          <h2>Long-term timeline</h2>
          <SectionTabs role="group" aria-label="Timeline scale">
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
                    key={entry.id}
                    className={`direction-timeline-item ${entry.done ? "is-complete" : ""}`}
                    onClick={() =>
                      act(async () => {
                        await flushEdits();
                        const action = entry.goal
                          ? model.goals.find(
                              (goal) => goal.id === entry.targetId,
                            )
                          : undefined;
                        const ids = action ? actionGoalIds(action) : [];
                        const context =
                          selected && ids.includes(selected.id)
                            ? selected.id
                            : ids[0];
                        setParams(
                          entry.goal
                            ? {
                                ...(context ? { goal: context } : {}),
                                action: entry.targetId,
                              }
                            : { goal: entry.targetId },
                        );
                      })
                    }
                  >
                    <time>{niceDate(entry.date)}</time>
                    <span>
                      <span
                        className="direction-timeline-kind"
                        data-kind={entry.kind}
                      >
                        {entry.kind === "goal" ? (
                          <Target size={12} aria-hidden="true" />
                        ) : entry.kind === "action" ? (
                          <ArrowUpRight size={12} aria-hidden="true" />
                        ) : (
                          <ListChecks size={12} aria-hidden="true" />
                        )}
                        {entry.kind === "goal"
                          ? "Goal"
                          : entry.kind === "action"
                            ? "Action"
                            : "Task"}
                      </span>
                      <strong>{entry.title}</strong>
                    </span>
                    {entry.done ? (
                      <Check size={17} />
                    ) : (
                      <ChevronRight size={17} />
                    )}
                  </button>
                ))}
              </section>
            ))}
          </div>
        ) : (
          <p className="direction-empty">
            Dated goals, actions and milestones appear here.
          </p>
        )}
      </Card>
      <section className="direction-picker" aria-label="Choose a goal">
        <div className="section-heading">
          <p className="direction-picker-caption">Goals</p>
          {editing && (
            <Button
              variant="secondary"
              onClick={() =>
                act(async () => {
                  await flushEdits();
                  const record = await workspace.create({
                    kind: "path",
                    title: "Untitled goal",
                    body: "",
                    data: {
                      category: "direction",
                      status: "Future",
                      startDate: "",
                      endDate: "",
                      researchLinks: [],
                      researchLinkTitles: [],
                    },
                  });
                  setParams({ goal: record.id });
                })
              }
            >
              <Plus size={15} />
              Add goal
            </Button>
          )}
        </div>
        {directions.length ? (
          <SortableList
            items={directions}
            grid
            className="direction-selector"
            label="Goals"
            afterItem={(_, index, visible) => {
              const focusedIndex = visible.findIndex(
                (item) => item.id === selected?.id,
              );
              if (
                !selected ||
                focusedIndex < 0 ||
                index !==
                  Math.min(
                    visible.length - 1,
                    Math.floor(focusedIndex / columns) * columns + columns - 1,
                  )
              )
                return null;
              return (
                <div
                  id="direction-detail"
                  className="goal-detail-row"
                  role="tabpanel"
                  aria-labelledby={`direction-tab-${selected.id}`}
                  tabIndex={0}
                  ref={setDetailHost}
                />
              );
            }}
            onReorder={async (ids) => {
              await reorderRecords(
                ids.map((id) => directions.find((record) => record.id === id)!),
                workspace,
                "directionOrder",
              );
            }}
          >
            {(record, handle) => {
              return (
                <div
                  className="direction-choice"
                  data-selected={selected?.id === record.id}
                  data-editing={editing}
                  data-goal-id={record.id}
                >
                  <button
                    type="button"
                    role="tab"
                    id={`direction-tab-${record.id}`}
                    aria-label={record.title}
                    aria-selected={selected?.id === record.id}
                    aria-controls="direction-detail"
                    tabIndex={
                      selected?.id === record.id ||
                      (!selected && record.id === directions[0]?.id)
                        ? 0
                        : -1
                    }
                    className="direction-choice-button"
                    onClick={() => act(() => selectDirection(record.id, true))}
                    onKeyDown={(event) => {
                      if (
                        ![
                          "ArrowLeft",
                          "ArrowRight",
                          "ArrowUp",
                          "ArrowDown",
                          "Home",
                          "End",
                        ].includes(event.key)
                      )
                        return;
                      event.preventDefault();
                      const index = directions.findIndex(
                        (item) => item.id === record.id,
                      );
                      const next =
                        event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? directions.length - 1
                            : event.key === "ArrowUp" ||
                                event.key === "ArrowDown"
                              ? Math.max(
                                  0,
                                  Math.min(
                                    directions.length - 1,
                                    index +
                                      (event.key === "ArrowDown"
                                        ? columns
                                        : -columns),
                                  ),
                                )
                              : (index +
                                  (event.key === "ArrowRight" ? 1 : -1) +
                                  directions.length) %
                                directions.length;
                      const tab = document.getElementById(
                        `direction-tab-${directions[next].id}`,
                      );
                      tab?.focus({ preventScroll: true });
                      tab?.scrollIntoView({
                        block: "nearest",
                        inline: "nearest",
                      });
                      act(() => selectDirection(directions[next].id));
                    }}
                  >
                    {editing ? (
                      <span className="goal-focus-label">
                        {selected?.id === record.id
                          ? "Hide details"
                          : "Show actions"}
                        <ChevronRight size={14} />
                      </span>
                    ) : (
                      <>
                        <span className="direction-choice-status">
                          <span
                            data-status={field(record, "status").toLowerCase()}
                          />
                          {field(record, "status") || "Exploring"}
                        </span>
                        <strong title={record.title}>{record.title}</strong>
                        <span className="direction-choice-date">
                          <time>
                            {field(record, "startDate")
                              ? scheduleDate(field(record, "startDate"))
                              : "Start not set"}
                          </time>
                          <span aria-hidden="true"> → </span>
                          <time>
                            {field(record, "endDate")
                              ? scheduleDate(field(record, "endDate"))
                              : "End not set"}
                          </time>
                        </span>
                      </>
                    )}
                  </button>
                  <DirectionCard
                    record={record}
                    focused={selected?.id === record.id}
                    detailHost={detailHost}
                    beforeLeave={beforeLeave}
                    onRemove={async () => {
                      await flushEdits();
                      await workspace.remove(record.id);
                      await model.refresh();
                    }}
                  >
                    {(dates) =>
                      goalSection(
                        model.goals
                          .filter((action) =>
                            actionGoalIds(action).includes(record.id),
                          )
                          .sort(actionOrder),
                        record.id,
                        dates,
                      )
                    }
                  </DirectionCard>
                  {handle && (
                    <div className="direction-choice-handle">{handle}</div>
                  )}
                </div>
              );
            }}
          </SortableList>
        ) : (
          <p className="direction-empty">
            Add a goal to bring your actions, notes and research together.
          </p>
        )}
      </section>
    </div>
  );
}

function DirectionCard({
  record,
  children,
  onRemove,
  detailHost,
  focused,
  beforeLeave,
}: {
  record: WorkRecord;
  children: (dates: { startDate: string; endDate: string }) => ReactNode;
  detailHost: HTMLElement | null;
  focused: boolean;
  beforeLeave: MutableRefObject<(() => boolean) | null>;
  onRemove: () => Promise<void>;
}) {
  const workspace = useWorkspace();
  const { editing } = useEditMode();
  const current = useRef(record);
  if (record.version > current.current.version) current.current = record;
  const queue = useRef<Promise<WorkRecord>>(Promise.resolve(record));
  const persist = async (
    patch: RecordPatch,
    expectedVersion?: number,
  ): Promise<WorkRecord> => {
    const task = queue.current
      .catch(() => current.current)
      .then(async () => {
        const next = await workspace.update(
          record.id,
          {
            ...patch,
            ...(patch.data
              ? { data: { ...current.current.data, ...patch.data } }
              : {}),
          },
          expectedVersion ?? current.current.version,
        );
        current.current = next;
        return next;
      });
    queue.current = task;
    return task;
  };
  const initial = {
    title: record.title,
    status: STATUSES.includes(
      field(record, "status") as (typeof STATUSES)[number],
    )
      ? field(record, "status")
      : "Exploring",
    startDate: field(record, "startDate"),
    endDate: field(record, "endDate"),
    links: Array.isArray(record.data.researchLinks)
      ? record.data.researchLinks.filter(
          (link): link is string => typeof link === "string",
        )
      : [],
    linkTitles: Array.isArray(record.data.researchLinkTitles)
      ? record.data.researchLinkTitles.filter(
          (title): title is string => typeof title === "string",
        )
      : [],
  };
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
    version: record.version,
    storageKey: `work:direction-draft:${workspace.user?.id ?? ""}:${record.id}`,
    pending: workspace.isPending(record.id),
    refresh: workspace.refresh,
    persist: async (value, expectedVersion) => {
      const links = value.links
        .map((url, index) => ({
          url: normalizeWebUrl(url),
          title: value.linkTitles?.[index] ?? "",
        }))
        .filter((link) => Boolean(link.url));
      const data = directionDataSchema.parse({
        ...current.current.data,
        category: "direction",
        status: value.status,
        startDate: value.startDate,
        endDate: value.endDate,
        researchLinks: links.map((link) => link.url),
        researchLinkTitles: links.map((link) => link.title),
      });
      const saved = await persist(
        {
          title: value.title.trim() || "Untitled goal",
          data,
        },
        expectedVersion,
      );
      return {
        version: saved.version,
        value: {
          title: saved.title,
          status: field(saved, "status"),
          startDate: field(saved, "startDate"),
          endDate: field(saved, "endDate"),
          links: Array.isArray(saved.data.researchLinks)
            ? saved.data.researchLinks.filter(
                (link): link is string => typeof link === "string",
              )
            : [],
          linkTitles: Array.isArray(saved.data.researchLinkTitles)
            ? saved.data.researchLinkTitles.filter(
                (title): title is string => typeof title === "string",
              )
            : [],
        },
        offline: workspace.isPending(record.id),
      };
    },
  });
  const set = (patch: Partial<typeof initial>) =>
    setValue((previous) => ({ ...previous, ...patch }));
  const [pendingLink, setPendingLink] = useState<{
    title: string;
    url: string;
  } | null>(null);
  const pendingLinkInput = useRef<HTMLInputElement>(null);
  const commitPendingLink = () => {
    if (!pendingLink) return false;
    const url = normalizeWebUrl(pendingLink.url);
    try {
      const parsed = new URL(url);
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        !parsed.hostname ||
        parsed.username ||
        parsed.password
      )
        return false;
    } catch {
      return false;
    }
    setValue((previous) => ({
      ...previous,
      links: [...previous.links, url],
      linkTitles: [...(previous.linkTitles ?? []), pendingLink.title],
    }));
    setPendingLink(null);
    void flush();
    return true;
  };
  useEffect(() => {
    if (!focused) return;
    const leave = () =>
      !pendingLink ||
      (!pendingLink.url && !pendingLink.title) ||
      commitPendingLink();
    beforeLeave.current = leave;
    return () => {
      if (beforeLeave.current === leave) beforeLeave.current = null;
    };
  });
  return (
    <>
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
      {editing && (
        <div className="stack goal-preview-edit">
          <div className="section-heading">
            {editing ? (
              <CompactSelect
                aria-label="Goal status"
                value={form.status}
                onChange={(event) => set({ status: event.target.value })}
              >
                {STATUSES.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </CompactSelect>
            ) : (
              <span className="badge">{form.status}</span>
            )}
            <div className="inline-actions">
              {editing && (
                <Button
                  variant="ghost"
                  aria-label={`Delete ${form.title}`}
                  onClick={() =>
                    void onRemove().catch((failure) =>
                      workspace.notify(
                        failure instanceof Error
                          ? failure.message
                          : "Delete failed.",
                        "error",
                      ),
                    )
                  }
                >
                  <Trash2 size={15} />
                </Button>
              )}
            </div>
          </div>
          <Input
            className="inline-title"
            aria-label="Goal name"
            placeholder="Goal name"
            value={form.title === "Untitled goal" ? "" : form.title}
            onChange={(event) => set({ title: event.target.value })}
            onBlur={flush}
          />
          <div className="direction-date-fields">
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
                value={form.endDate}
                onChange={(event) => set({ endDate: event.target.value })}
              />
            </Field>
          </div>
          <small role="status">{state}</small>
        </div>
      )}
      {error && !conflict && (
        <p className="form-error" role="alert">
          {error}
          <Button variant="ghost" onClick={flush}>
            Retry
          </Button>
        </p>
      )}
      {focused &&
        detailHost &&
        createPortal(
          <Card className="stack direction-card">
            <section className="direction-notes">
              <h3>Notes</h3>
              <RichDocumentEditor
                compact
                allowBlockReordering={false}
                record={record}
                input={{
                  kind: record.kind,
                  title: record.title,
                  data: record.data,
                }}
                draftKey={`direction:${record.id}`}
                initialBody={record.body}
                persist={(patch) =>
                  persist({
                    body: patch.body,
                    data: {
                      richContent: patch.data?.richContent,
                    },
                  })
                }
              />
            </section>
            <section className="goal-links">
              <h3>
                Links{" "}
                <span className="direction-count" aria-hidden="true">
                  {form.links.length}
                </span>
              </h3>
              {!editing && !form.links.length && (
                <p className="muted">No links yet.</p>
              )}
              <div className="stack direction-links">
                {form.links.map((url, index) =>
                  editing ? (
                    <div className="direction-link-editor" key={index}>
                      <div className="stack direction-link-fields">
                        <Input
                          aria-label={`Research link title ${index + 1}`}
                          value={form.linkTitles?.[index] ?? ""}
                          placeholder={researchLinkTitle(url)}
                          onChange={(event) =>
                            set({
                              linkTitles: form.links.map((_, i) =>
                                i === index
                                  ? event.target.value
                                  : (form.linkTitles?.[i] ?? ""),
                              ),
                            })
                          }
                          onBlur={flush}
                        />
                        <Input
                          aria-label={`Research link ${index + 1}`}
                          value={url}
                          placeholder="example.com"
                          onChange={(event) =>
                            set({
                              links: form.links.map((item, i) =>
                                i === index ? event.target.value : item,
                              ),
                            })
                          }
                          onBlur={() => {
                            set({ links: form.links.map(normalizeWebUrl) });
                            flush();
                          }}
                        />
                      </div>
                      <Button
                        variant="ghost"
                        aria-label="Delete research link"
                        onClick={() => {
                          set({
                            links: form.links.filter((_, i) => i !== index),
                            linkTitles: (form.linkTitles ?? []).filter(
                              (_, i) => i !== index,
                            ),
                          });
                          flush();
                        }}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  ) : (
                    <a
                      className="text-link"
                      href={normalizeWebUrl(url)}
                      key={index}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {researchLinkTitle(url, form.linkTitles?.[index])}
                      <ArrowUpRight size={14} />
                    </a>
                  ),
                )}
                {editing && pendingLink && (
                  <div className="direction-link-editor" key="pending">
                    <div className="stack direction-link-fields">
                      <Input
                        aria-label="New link title"
                        placeholder="Link title (optional)"
                        value={pendingLink.title}
                        onChange={(event) =>
                          setPendingLink({
                            ...pendingLink,
                            title: event.target.value,
                          })
                        }
                      />
                      <Input
                        aria-label="New link"
                        ref={pendingLinkInput}
                        autoFocus
                        placeholder="example.com"
                        value={pendingLink.url}
                        onChange={(event) =>
                          setPendingLink({
                            ...pendingLink,
                            url: event.target.value,
                          })
                        }
                        onBlur={(event) => {
                          const target = event.relatedTarget;
                          const row = event.currentTarget.closest(
                            ".direction-link-editor",
                          );
                          if (target instanceof Node && row?.contains(target))
                            return;
                          if (
                            target instanceof HTMLElement &&
                            target.closest(".direction-add-link")
                          )
                            return;
                          commitPendingLink();
                        }}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      aria-label="Cancel new link"
                      onClick={() => setPendingLink(null)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                )}
                {editing && (
                  <Button
                    className="direction-add-link"
                    variant="secondary"
                    onClick={() => {
                      if (!pendingLink) setPendingLink({ title: "", url: "" });
                      else if (!commitPendingLink()) {
                        pendingLinkInput.current?.focus();
                      }
                    }}
                  >
                    <Plus size={14} />
                    Add link
                  </Button>
                )}
              </div>
            </section>
            {children({ startDate: form.startDate, endDate: form.endDate })}
          </Card>,
          detailHost,
        )}
    </>
  );
}

function researchLinkTitle(url: string, title?: string) {
  if (title?.trim()) return title.trim();
  try {
    const parsed = new URL(normalizeWebUrl(url));
    const hostname = parsed.hostname.replace(/^www\./, "");
    if (
      hostname === "thundergolfer.com" &&
      parsed.pathname.replace(/\/$/, "") === "/blog/get-to-the-states"
    )
      return "Aussie engineers, get to the states!";
    const leaf = decodeURIComponent(
      parsed.pathname.split("/").filter(Boolean).at(-1) ?? "",
    );
    return leaf
      ? leaf.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[-_]+/g, " ")
      : hostname;
  } catch {
    return "Open resource";
  }
}
