import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, RotateCcw } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { field, type WorkRecord } from "../../../shared/model";
import {
  Button,
  Card,
  Field,
  Input,
  Modal,
  PageHeader,
} from "../../components/ui";
import { useWorkspace } from "../../lib/workspace";
import { AutosaveNote } from "../content/AutosaveNote";
import { ContentPanel } from "../content/ContentPanel";
import { DeleteControl } from "../content/DeleteControl";
import { interviewTime } from "../search/applicationRecords";
import { interviewTabs, upcomingInterviews, type InterviewTab } from "./domain";
import { InterviewPreparation } from "./InterviewPreparation";
import { StoryBank, StoryEditor } from "./StoryBank";
import "./interviews.css";

export function InterviewsPage() {
  const { records, create, update, remove, preferences } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const tabs = interviewTabs(records);
  const tab = tabs.find((item) => item.id === params.get("tab")) ?? tabs[0];
  const interview = records.find(
    (record) =>
      record.kind === "interview" && record.id === params.get("interview"),
  );
  const [tabEditor, setTabEditor] = useState<InterviewTab | "new" | null>(null);
  const [storyEditor, setStoryEditor] = useState<WorkRecord | "new" | null>(
    null,
  );
  const [error, setError] = useState("");
  const tabRef = useRef<HTMLDivElement>(null);
  const upcoming = upcomingInterviews(records);
  const hiddenTabs = interviewTabs(records, true).filter(
    (item) => item.record?.data.hidden,
  );
  useEffect(() => {
    const requested = params.get("record");
    const story = records.find(
      (record) => record.kind === "story" && record.id === requested,
    );
    if (story) setStoryEditor(story);
  }, [params, records]);
  const selectTab = (id: string) => setParams({ tab: id });
  const perform = async (action: () => Promise<unknown>) => {
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Change could not be saved.",
      );
    }
  };
  const saveTabData = async (
    item: InterviewTab,
    patch: Record<string, unknown>,
  ) => {
    const data = {
      ...item.record?.data,
      category: "interview-tab",
      ...(item.key ? { tabKey: item.key } : {}),
      order: item.order,
      ...patch,
    };
    return item.record
      ? update(item.record.id, { data })
      : create({ kind: "note", title: item.title, data });
  };
  async function reorder(index: number, offset: number) {
    const next = [...tabs];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    for (const [order, item] of next.entries())
      await saveTabData(item, { order });
  }
  return (
    <div className="page interviews-page">
      <PageHeader
        title="Interviews"
        description="Keep your principles, stories and round-specific preparation together."
        action={
          <Button onClick={() => setTabEditor("new")}>
            <Plus size={16} />
            Add tab
          </Button>
        }
      />
      <div
        className="interview-tabs"
        role="tablist"
        aria-label="Interview preparation tabs"
        ref={tabRef}
      >
        {tabs.map((item, index) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={!interview && tab?.id === item.id}
            tabIndex={!interview && tab?.id === item.id ? 0 : -1}
            aria-controls="interview-tab-content"
            id={`interview-tab-${item.id}`}
            onClick={() => selectTab(item.id)}
            onKeyDown={(event) => {
              if (
                !["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? tabs.length - 1
                    : (index +
                        (event.key === "ArrowRight" ? 1 : -1) +
                        tabs.length) %
                      tabs.length;
              selectTab(tabs[next].id);
              (tabRef.current?.children[next] as HTMLElement)?.focus();
            }}
          >
            {item.title}
          </button>
        ))}
        {interview && (
          <button
            role="tab"
            aria-selected
            tabIndex={0}
            aria-controls="interview-tab-content"
            id="interview-tab-appointment"
          >
            {interview.title}
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="interview-workspace">
        <div
          id="interview-tab-content"
          role="tabpanel"
          aria-labelledby={
            interview
              ? "interview-tab-appointment"
              : tab
                ? `interview-tab-${tab.id}`
                : undefined
          }
        >
          {interview ? (
            <InterviewPreparation
              key={interview.id}
              interview={interview}
              onEditStory={(record) => setStoryEditor(record ?? "new")}
            />
          ) : tab ? (
            <>
              <Card className="interview-intro">
                <header className="content-section-heading">
                  <h2>{tab.title}</h2>
                  <div className="content-item-actions">
                    <Button
                      variant="ghost"
                      aria-label={`Rename ${tab.title}`}
                      onClick={() => setTabEditor(tab)}
                    >
                      <Pencil size={15} />
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={tabs.indexOf(tab) === 0}
                      aria-label={`Move ${tab.title} left`}
                      onClick={() =>
                        void perform(() => reorder(tabs.indexOf(tab), -1))
                      }
                    >
                      <ArrowUp size={15} />
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={tabs.indexOf(tab) === tabs.length - 1}
                      aria-label={`Move ${tab.title} right`}
                      onClick={() =>
                        void perform(() => reorder(tabs.indexOf(tab), 1))
                      }
                    >
                      <ArrowDown size={15} />
                    </Button>
                    <DeleteControl
                      label={tab.key ? "Hide tab" : "Delete tab"}
                      onDelete={async () => {
                        if (tab.key) await saveTabData(tab, { hidden: true });
                        else if (tab.record) await remove(tab.record.id);
                        setParams({});
                      }}
                    />
                  </div>
                </header>
                <AutosaveNote
                  key={tab.id}
                  record={tab.record}
                  input={{
                    kind: "note",
                    title: tab.title,
                    data: {
                      category: "interview-tab",
                      ...(tab.key ? { tabKey: tab.key } : {}),
                      order: tab.order,
                    },
                  }}
                  draftKey={`interview-tab:${tab.id}`}
                  label={`${tab.title} main text`}
                />
              </Card>
              {tab.key === "behavioural" && (
                <StoryBank
                  onEdit={(record) => setStoryEditor(record ?? "new")}
                />
              )}
              <ContentPanel
                context={{
                  scope: "interviews",
                  ...(tab.key ? { tabKey: tab.key } : { tabId: tab.id }),
                }}
              />
            </>
          ) : (
            <Card>
              <p>Add a preparation tab to begin.</p>
            </Card>
          )}
          {hiddenTabs.length > 0 && (
            <Button
              variant="ghost"
              onClick={() =>
                void perform(async () => {
                  for (const item of hiddenTabs)
                    if (item.record)
                      await update(item.record.id, {
                        data: { ...item.record.data, hidden: false },
                      });
                })
              }
            >
              <RotateCcw size={15} />
              Restore default tabs
            </Button>
          )}
          {params.has("interview") && !interview && (
            <p role="alert">
              This appointment is no longer available. Saved preparation stays
              in your backup.
            </p>
          )}
        </div>
        <aside className="interview-upcoming">
          <h2>Upcoming interviews</h2>
          {upcoming.length ? (
            upcoming.map((item) => (
              <Link
                key={item.id}
                to={`/interviews?interview=${encodeURIComponent(item.id)}`}
                className={`interview-upcoming-card ${interview?.id === item.id ? "active" : ""}`}
              >
                <strong>{item.title}</strong>
                <span>
                  {interviewTime(
                    item,
                    field(item, "timezone", preferences.timezone),
                  )}
                </span>
                <small>Prepare for this round →</small>
              </Link>
            ))
          ) : (
            <p className="muted">
              Schedule interviews in Applications. Your upcoming rounds will
              appear here.
            </p>
          )}
          <details>
            <summary>Past & other appointments</summary>
            {records
              .filter(
                (item) =>
                  item.kind === "interview" &&
                  !upcoming.some((next) => next.id === item.id),
              )
              .sort((a, b) =>
                field(b, "startsAt").localeCompare(field(a, "startsAt")),
              )
              .map((item) => (
                <Link
                  key={item.id}
                  to={`/interviews?interview=${encodeURIComponent(item.id)}`}
                  className="interview-upcoming-card"
                >
                  <strong>{item.title}</strong>
                  <span>
                    {field(item, "status", "Scheduled")} ·{" "}
                    {interviewTime(item, preferences.timezone)}
                  </span>
                </Link>
              ))}
          </details>
        </aside>
      </div>
      {tabEditor && (
        <TabEditor
          key={tabEditor === "new" ? "new" : tabEditor.id}
          tab={tabEditor === "new" ? undefined : tabEditor}
          nextOrder={tabs.length}
          onClose={() => setTabEditor(null)}
        />
      )}
      {storyEditor && (
        <StoryEditor
          key={storyEditor === "new" ? "new" : storyEditor.id}
          record={storyEditor === "new" ? undefined : storyEditor}
          onClose={() => {
            setStoryEditor(null);
            if (params.has("record")) {
              const next = new URLSearchParams(params);
              next.delete("record");
              setParams(next);
            }
          }}
        />
      )}
    </div>
  );
}
function TabEditor({
  tab,
  nextOrder,
  onClose,
}: {
  tab?: InterviewTab;
  nextOrder: number;
  onClose: () => void;
}) {
  const { records, create, update } = useWorkspace();
  const [title, setTitle] = useState(tab?.title ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      open
      onClose={onClose}
      title={tab ? "Rename preparation tab" : "Add preparation tab"}
    >
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!title.trim()) return;
          setBusy(true);
          setError("");
          const record = tab?.key
            ? records.find(
                (item) =>
                  item.kind === "note" &&
                  item.data.category === "interview-tab" &&
                  item.data.tabKey === tab.key,
              )
            : tab?.record;
          try {
            if (record) await update(record.id, { title: title.trim() });
            else
              await create({
                kind: "note",
                title: title.trim(),
                data: {
                  category: "interview-tab",
                  ...(tab?.key ? { tabKey: tab.key } : {}),
                  order: tab?.order ?? nextOrder,
                },
              });
            onClose();
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : "Tab could not be saved.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Tab name">
          <Input
            required
            autoFocus
            maxLength={200}
            placeholder="System design, technical notes…"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        {error && <p role="alert">{error}</p>}
        <Button disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
      </form>
    </Modal>
  );
}
