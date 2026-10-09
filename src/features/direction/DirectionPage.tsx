import { useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowUpRight, Check, ChevronRight, Plus, Trash2 } from "lucide-react";
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
import { useAutosave } from "../../lib/autosave";
import { RichDocumentEditor } from "../content/RichDocumentEditor";
import { SortableList } from "../content/SortableList";
import { normalizeWebUrl } from "../../../shared/urls";
import { reorderRecords } from "../content/reorderRecords";
const STATUSES = ["Future", "Exploring", "Pursuing", "Achieved"];
import "../home/timeline.css";
import "./direction.css";
export function DirectionPage() {
  const workspace = useWorkspace();
  const { editing } = useEditMode();
  const model = useGoals();
  const learning = useLearningData();
  const [params, setParams] = useSearchParams();
  const [scale, setScale] = useState<"quarter" | "year">("quarter");
  const [error, setError] = useState("");
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
                      <ChevronRight size={17} />
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
                      researchLinkTitles: [],
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
                onRefresh={model.refresh}
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
          title: value.title.trim() || "Untitled direction",
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
  return (
    <Card className="stack direction-card">
      <div className="section-heading">
        {editing ? (
          <CompactSelect
            aria-label="Direction status"
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
      {conflict && (
        <div className="notice notice-warning" role="alert">
          {error || "This direction changed elsewhere."}
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
      <h4 className="direction-field-heading">Notes</h4>
      <RichDocumentEditor
        compact
        allowBlockReordering={false}
        record={record}
        input={{ kind: record.kind, title: record.title, data: record.data }}
        draftKey={`direction:${record.id}`}
        persist={(patch) =>
          persist({
            body: patch.body,
            data: {
              richContent: patch.data?.richContent,
            },
          })
        }
      />
      {(editing || form.links.length > 0) && (
        <div className="stack direction-links">
          <h4 className="direction-field-heading">Links</h4>
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
                    setPendingLink({ ...pendingLink, url: event.target.value })
                  }
                  onBlur={(event) => {
                    const target = event.relatedTarget;
                    const row = event.currentTarget.closest(
                      ".direction-link-editor",
                    );
                    if (target instanceof Node && row?.contains(target)) return;
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
