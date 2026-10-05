import { useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Check, Plus, Trash2, ArrowUpRight } from "lucide-react";
import { goalProgress, EMPTY_GOAL } from "../../../shared/goals";
import {
  DIRECTION_KINDS,
  directionDataSchema,
} from "../../../shared/direction";
import {
  field,
  niceDate,
  type RecordPatch,
  type WorkRecord,
} from "../../../shared/model";
import {
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  SectionTabs,
} from "../../components/ui";
import { useWorkspace } from "../../lib/workspace";
import { useEditMode } from "../../lib/edit-mode";
import { useGoals } from "../../lib/goals";
import { useLearningData } from "../learn/useLearningData";
import { observedProgress, useGoalMeasurements } from "./goalMetrics";
import { GoalEditor } from "./GoalEditor";
import { useInlineAutosave } from "./useInlineAutosave";
import { RichDocumentEditor } from "../content/RichDocumentEditor";
import { markdownDocument } from "../content/markdownDocument";
import { SortableList } from "../content/SortableList";
import { normalizeWebUrl } from "../../../shared/urls";
import { reorderRecords } from "../content/reorderRecords";
import {
  DIRECTION_STATUSES as STATUSES,
  directionNotes,
} from "./directionAdapter";
import "../home/timeline.css";
import "./direction.css";
export function DirectionPage() {
  const workspace = useWorkspace();
  const { editing } = useEditMode();
  const model = useGoals();
  const learning = useLearningData();
  useGoalMeasurements(model, learning, workspace.user?.id ?? "");
  const [params, setParams] = useSearchParams();
  const [scale, setScale] = useState<"quarter" | "year">("quarter");
  const [error, setError] = useState("");
  const directions = workspace.records
    .filter(
      (record) =>
        DIRECTION_KINDS.includes(
          record.kind as (typeof DIRECTION_KINDS)[number],
        ) && !record.deletedAt,
    )
    .sort(
      (a, b) =>
        Number(a.data.directionOrder ?? 0) -
          Number(b.data.directionOrder ?? 0) ||
        a.createdAt.localeCompare(b.createdAt),
    );
  const entries = [
    ...model.goals
      .filter((goal) => goal.targetDate)
      .map((goal) => ({
        id: goal.id,
        targetId: goal.id,
        date: goal.targetDate,
        title: goal.title,
        done: goalProgress(goal, observedProgress(goal, learning)).complete,
        goal: true,
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
  return (
    <div className="page-stack direction-page">
      <PageHeader title="Your Direction" />
      {(error || model.error) && (
        <p className="form-error" role="alert">
          {error || model.error}
        </p>
      )}
      <Card className="direction-overview">
        <div className="section-heading">
          <h2>Longer-term timeline</h2>
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
                    onClick={() => {
                      setParams(
                        entry.goal
                          ? { goal: entry.targetId }
                          : { record: entry.targetId },
                      );
                      document
                        .getElementById(`direction-item-${entry.targetId}`)
                        ?.scrollIntoView({
                          behavior: "smooth",
                          block: "center",
                        });
                    }}
                  >
                    <time>{niceDate(entry.date)}</time>
                    <span>
                      <strong>{entry.title}</strong>
                    </span>
                    {entry.done ? (
                      <Check size={17} />
                    ) : (
                      <ArrowUpRight size={17} />
                    )}
                  </button>
                ))}
              </section>
            ))}
          </div>
        ) : (
          <p className="muted">Dated goals and directions appear here.</p>
        )}
      </Card>
      <section className="stack">
        <div className="section-heading">
          <h2>Directions</h2>
          {editing && (
            <Button
              variant="secondary"
              onClick={() =>
                act(async () => {
                  const record = await workspace.create({
                    kind: "path",
                    title: "Untitled direction",
                    body: "",
                    data: {
                      category: "direction",
                      status: "Future",
                      startDate: "",
                      endDate: "",
                      researchLinks: [],
                    },
                  });
                  setParams({ record: record.id });
                })
              }
            >
              <Plus size={16} />
              Add direction
            </Button>
          )}
        </div>
        <SortableList
          items={directions}
          className="direction-grid"
          onReorder={async (ids) => {
            await reorderRecords(
              ids.map((id) => directions.find((record) => record.id === id)!),
              workspace,
              "directionOrder",
            );
          }}
        >
          {(record, handle) => (
            <div
              id={`direction-item-${record.id}`}
              data-selected={params.get("record") === record.id}
            >
              <DirectionCard
                key={`${record.id}:${record.data.directionOrder ?? 0}`}
                record={record}
                handle={handle}
              />
            </div>
          )}
        </SortableList>
      </section>
      <section className="stack">
        <div className="section-heading">
          <h2>Goals</h2>
          {editing && (
            <Button
              variant="secondary"
              onClick={() =>
                act(async () => {
                  const goal = await model.save({
                    ...EMPTY_GOAL,
                    title: "Untitled goal",
                  });
                  setParams({ goal: goal.id });
                })
              }
            >
              <Plus size={16} />
              Add goal
            </Button>
          )}
        </div>
        <div className="goal-grid">
          {model.goals.map((goal) => (
            <div
              id={`direction-item-${goal.id}`}
              key={goal.id}
              data-selected={params.get("goal") === goal.id}
            >
              <GoalEditor
                goal={goal}
                owner={workspace.user?.id ?? ""}
                directions={directions}
                onSave={model.save}
                onDelete={async () => {
                  await model.remove(goal);
                }}
                observed={observedProgress(goal, learning)}
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
function DirectionCard({
  record,
  handle,
}: {
  record: WorkRecord;
  handle: ReactNode;
}) {
  const workspace = useWorkspace();
  const { editing } = useEditMode();
  const current = useRef(record);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const persist = async (patch: RecordPatch) => {
    const task = queue.current
      .catch(() => undefined)
      .then(async () => {
        const next = await workspace.update(
          record.id,
          {
            ...patch,
            ...(patch.data
              ? { data: { ...current.current.data, ...patch.data } }
              : {}),
          },
          current.current.version,
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
  };
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
    `work:direction-draft:${workspace.user?.id ?? ""}:${record.id}`,
    async (value) => {
      const data = directionDataSchema.parse({
        ...current.current.data,
        category: "direction",
        status: value.status,
        startDate: value.startDate,
        endDate: value.endDate,
        researchLinks: value.links.map(normalizeWebUrl).filter(Boolean),
        legacyDirection: current.current.data.legacyDirection ?? record.data,
      });
      await persist({
        title: value.title.trim() || "Untitled direction",
        data,
      });
    },
  );
  const set = (patch: Partial<typeof initial>) =>
    setValue((previous) => ({ ...previous, ...patch }));
  return (
    <Card className="stack direction-card">
      <div className="section-heading">
        {editing ? (
          <Select
            aria-label="Direction status"
            value={form.status}
            onChange={(event) => set({ status: event.target.value })}
          >
            {STATUSES.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </Select>
        ) : (
          <span className="badge">{form.status}</span>
        )}
        <div className="inline-actions">
          {handle}
          {editing && (
            <Button
              variant="ghost"
              aria-label={`Delete ${form.title}`}
              onClick={() =>
                void workspace
                  .remove(record.id)
                  .catch((failure) =>
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
      {recovered && (
        <div className="notice notice-warning">
          Recovered device draft. Review before saving.
          <div className="inline-actions">
            <Button variant="secondary" onClick={acceptDraft}>
              Save recovered draft
            </Button>
            <Button variant="ghost" onClick={discardDraft}>
              Load saved direction
            </Button>
          </div>
        </div>
      )}
      {editing ? (
        <Input
          className="inline-title"
          aria-label="Direction name"
          placeholder="Direction name"
          value={form.title === "Untitled direction" ? "" : form.title}
          onChange={(event) => set({ title: event.target.value })}
          onBlur={flush}
        />
      ) : (
        <h3>{form.title}</h3>
      )}
      {editing ? (
        <div className="form-grid">
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
      ) : (
        (form.startDate || form.endDate) && (
          <small>
            {form.startDate ? niceDate(form.startDate) : "No start date"} →{" "}
            {form.endDate ? niceDate(form.endDate) : "No end date"}
          </small>
        )
      )}
      <RichDocumentEditor
        record={record}
        input={{ kind: record.kind, title: record.title, data: record.data }}
        draftKey={`direction:${record.id}`}
        initialDocument={markdownDocument(directionNotes(record))}
        persist={(patch) =>
          persist({
            body: patch.body,
            data: {
              richContent: patch.data?.richContent,
              legacyBody: patch.data?.legacyBody,
            },
          })
        }
      />
      {(editing || form.links.length > 0) && (
        <div className="stack direction-links">
          {form.links.map((url, index) =>
            editing ? (
              <div className="inline-actions" key={index}>
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
                <Button
                  variant="ghost"
                  aria-label="Delete research link"
                  onClick={() =>
                    set({ links: form.links.filter((_, i) => i !== index) })
                  }
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
                {url}
                <ArrowUpRight size={14} />
              </a>
            ),
          )}
          {editing && (
            <Button
              variant="ghost"
              onClick={() => set({ links: [...form.links, ""] })}
            >
              <Plus size={14} />
              Add research link
            </Button>
          )}
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
    </Card>
  );
}
