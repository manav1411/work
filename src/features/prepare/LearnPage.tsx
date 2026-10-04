import { useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { learningUsername } from "../../../shared/learning";
import {
  Button,
  Card,
  Field,
  Input,
  Modal,
  PageHeader,
  Textarea,
} from "../../components/ui";
import { useWorkspace } from "../../lib/workspace";
import { Pomodoro } from "../learn/Pomodoro";
import { useLearningData } from "../learn/useLearningData";
import Roadmap from "../learn/foundations/Roadmap";
import { roadmapTopics } from "../../content/problems";
import {
  learningSubjects,
  learningTopics,
  type EditableLearningTopic,
  type LearningSubject,
} from "../learn/topics";
import { ContentPanel } from "../content/ContentPanel";
import { DeleteControl } from "../content/DeleteControl";
import "../learn/learn.css";

export function LearnPage() {
  const { records, preferences, mode, create, update, remove } = useWorkspace();
  const learning = useLearningData();
  const [params, setParams] = useSearchParams();
  const tabRef = useRef<HTMLDivElement>(null);
  const subjects = learningSubjects(records);
  const track = subjects.some((item) => item.id === params.get("track"))
    ? params.get("track")!
    : "dsa";
  const subject = subjects.find((item) => item.id === track)!;
  const [editor, setEditor] = useState<{
    type: "track" | "topic";
    item?: LearningSubject | EditableLearningTopic;
  } | null>(null);
  const [error, setError] = useState("");
  const problemTopic = roadmapTopics.find((topic) =>
    topic.problems.some((problem) => problem.slug === params.get("problem")),
  )?.id;
  const topics = learningTopics(records, track);
  const hiddenTopics = learningTopics(records, track, true).filter(
    (item) => item.record?.data.hidden,
  );
  const hiddenSubjects = learningSubjects(records, true).filter(
    (item) => item.record?.data.hidden && item.id !== "dsa",
  );
  const selectTrack = (id: string) =>
    setParams(id === "dsa" ? {} : { track: id });
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
  const saveItem = async (
    type: "track" | "topic",
    item: LearningSubject | EditableLearningTopic,
    patch: Record<string, unknown>,
  ) => {
    const data = {
      ...item.record?.data,
      category: type === "track" ? "learn-track" : "learn-topic",
      ...(type === "topic" ? { track } : {}),
      ...(item.seedId ? { seedId: item.seedId } : {}),
      ...patch,
    };
    return item.record
      ? update(item.record.id, { data })
      : create({
          kind: "topic",
          title: item.title,
          body: "description" in item ? item.description : item.summary,
          data,
        });
  };
  const reorder = async (
    type: "track" | "topic",
    index: number,
    offset: number,
  ) => {
    const next = [...(type === "track" ? subjects : topics)];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    for (const [order, item] of next.entries())
      await saveItem(type, item, { order });
  };
  return (
    <div className="page learn-page">
      <PageHeader
        title="Learn"
        action={
          <Button onClick={() => setEditor({ type: "track" })}>
            <Plus size={16} />
            Add topic
          </Button>
        }
      />
      <div
        className="learn-track-tabs"
        ref={tabRef}
        role="tablist"
        aria-label="Learning topics"
      >
        {subjects.map((item, index) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={track === item.id}
            aria-controls="learn-track-content"
            id={`learn-track-${item.id}`}
            tabIndex={track === item.id ? 0 : -1}
            className={track === item.id ? "active" : ""}
            onClick={() => selectTrack(item.id)}
            onFocus={(event) =>
              event.currentTarget.scrollIntoView({
                block: "nearest",
                inline: "nearest",
              })
            }
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
                    ? subjects.length - 1
                    : (index +
                        (event.key === "ArrowRight" ? 1 : -1) +
                        subjects.length) %
                      subjects.length;
              selectTrack(subjects[next].id);
              (tabRef.current?.children[next] as HTMLElement)?.focus();
            }}
          >
            {item.title}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="content-save-error">
          {error}
        </p>
      )}
      <div
        id="learn-track-content"
        role="tabpanel"
        aria-labelledby={`learn-track-${track}`}
      >
        <div className="learn-subject-heading">
          <p>{subject.description}</p>
          <div className="content-item-actions">
            <Button
              variant="ghost"
              onClick={() => setEditor({ type: "track", item: subject })}
            >
              <Pencil size={15} />
              Edit topic
            </Button>
            <Button
              variant="ghost"
              aria-label="Move topic left"
              disabled={subjects.indexOf(subject) === 0}
              onClick={() =>
                void perform(() =>
                  reorder("track", subjects.indexOf(subject), -1),
                )
              }
            >
              <ArrowUp size={15} />
            </Button>
            <Button
              variant="ghost"
              aria-label="Move topic right"
              disabled={subjects.indexOf(subject) === subjects.length - 1}
              onClick={() =>
                void perform(() =>
                  reorder("track", subjects.indexOf(subject), 1),
                )
              }
            >
              <ArrowDown size={15} />
            </Button>
            {track !== "dsa" && (
              <DeleteControl
                label={subject.seedId ? "Hide topic" : "Delete topic"}
                onDelete={async () => {
                  if (subject.seedId)
                    await saveItem("track", subject, { hidden: true });
                  else if (subject.record) await remove(subject.record.id);
                  selectTrack("dsa");
                }}
              />
            )}
          </div>
        </div>
        {track === "dsa" && (
          <>
            <div className="learn-context-bar">
              <h2>DSA & Python roadmap</h2>
              <Pomodoro />
            </div>
            {learning.error && (
              <div className="learn-source-error" role="alert">
                <span>{learning.error}</span>
                <Button
                  variant="ghost"
                  disabled={learning.loading}
                  onClick={() => void learning.reload()}
                >
                  <RefreshCw size={15} />
                  Retry
                </Button>
              </div>
            )}
            {learning.loading && !learning.stats && (
              <p className="muted" role="status">
                Loading confirmed solves…
              </p>
            )}
            <Roadmap
              solved={learning.solvedSlugs}
              personalised={learning.configured && Boolean(learning.stats)}
              initialTopic={problemTopic}
            />
            <footer className="learn-source-footer">
              {!learning.configured && !learning.loading && (
                <Link to="/settings">Set LeetCode username</Link>
              )}
              {mode !== "demo" && learning.configured && (
                <details>
                  <summary>
                    {learning.username ||
                      learningUsername(preferences.leetcode)}
                    {learning.source.stats.stale ? " · Cached data" : ""}
                  </summary>
                  <div className="learn-source-details">
                    <a
                      href={`https://leetcode.com/u/${encodeURIComponent(learning.username)}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      LeetCode profile
                      <ExternalLink size={13} />
                    </a>
                    {learning.source.stats.fetchedAt && (
                      <span>
                        Progress fetched{" "}
                        {new Date(
                          learning.source.stats.fetchedAt,
                        ).toLocaleString(undefined, {
                          timeZone: preferences.timezone,
                        })}
                      </span>
                    )}
                    <p>
                      Confirmed solves use accumulated history from the learning
                      source. Earlier solves may be missing; an empty circle
                      means a solve has not been observed.
                    </p>
                    <Button
                      variant="ghost"
                      disabled={learning.loading}
                      onClick={() => void learning.reload()}
                    >
                      <RefreshCw size={14} />
                      Refresh
                    </Button>
                  </div>
                </details>
              )}
            </footer>
            <ContentPanel
              context={{
                scope: "learn",
                track: "dsa",
                seedId: "dsa-resources",
              }}
              seeds={[
                {
                  id: "leetcode",
                  title: "LeetCode problems",
                  url: "https://leetcode.com/problemset/",
                  body: "Practise a pattern from the roadmap.",
                },
                {
                  id: "python-tutorial",
                  title: "Python tutorial",
                  url: "https://docs.python.org/3/tutorial/",
                  body: "Language fundamentals with runnable examples.",
                },
                {
                  id: "python-library",
                  title: "Python standard library",
                  url: "https://docs.python.org/3/library/",
                  body: "Collections, heaps, iteration and useful building blocks.",
                },
              ]}
            />
          </>
        )}
        {track !== "dsa" && (
          <Button
            variant="secondary"
            onClick={() => setEditor({ type: "topic" })}
          >
            <Plus size={15} />
            Add section
          </Button>
        )}
        <div className="learn-editable-topics">
          {topics.map((topic, index) => (
            <Card key={topic.id} className="learn-reading-card">
              <header className="content-section-heading">
                <h2>{topic.title}</h2>
                <div className="content-item-actions">
                  <Button
                    variant="ghost"
                    onClick={() => setEditor({ type: "topic", item: topic })}
                    aria-label={`Edit ${topic.title}`}
                  >
                    <Pencil size={15} />
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={index === 0}
                    aria-label={`Move ${topic.title} up`}
                    onClick={() =>
                      void perform(() => reorder("topic", index, -1))
                    }
                  >
                    <ArrowUp size={15} />
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={index === topics.length - 1}
                    aria-label={`Move ${topic.title} down`}
                    onClick={() =>
                      void perform(() => reorder("topic", index, 1))
                    }
                  >
                    <ArrowDown size={15} />
                  </Button>
                  <DeleteControl
                    label={topic.seedId ? "Hide section" : "Delete section"}
                    onDelete={async () => {
                      if (topic.seedId)
                        await saveItem("topic", topic, { hidden: true });
                      else if (topic.record) await remove(topic.record.id);
                    }}
                  />
                </div>
              </header>
              {topic.summary && <p>{topic.summary}</p>}
              <ContentPanel
                context={{
                  scope: "learn",
                  track,
                  ...(topic.seedId
                    ? { seedId: topic.seedId }
                    : { topicId: topic.id }),
                }}
                seeds={
                  topic.url
                    ? [
                        {
                          id: `${topic.id}-reading`,
                          title: topic.resource,
                          url: topic.url,
                        },
                      ]
                    : []
                }
              />
            </Card>
          ))}
        </div>
        {(hiddenTopics.length > 0 || hiddenSubjects.length > 0) && (
          <Button
            variant="ghost"
            onClick={() =>
              void perform(async () => {
                for (const item of [...hiddenSubjects, ...hiddenTopics])
                  if (item.record)
                    await update(item.record.id, {
                      data: { ...item.record.data, hidden: false },
                    });
              })
            }
          >
            <RotateCcw size={15} />
            Restore hidden defaults
          </Button>
        )}
      </div>
      {editor && (
        <TopicEditor
          key={editor.item?.id ?? editor.type}
          type={editor.type}
          item={editor.item}
          track={track}
          order={editor.type === "track" ? subjects.length : topics.length}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
function TopicEditor({
  type,
  item,
  track,
  order,
  onClose,
}: {
  type: "track" | "topic";
  item?: LearningSubject | EditableLearningTopic;
  track: string;
  order: number;
  onClose: () => void;
}) {
  const { create, update } = useWorkspace();
  const [title, setTitle] = useState(item?.title ?? "");
  const [body, setBody] = useState(
    item ? ("description" in item ? item.description : item.summary) : "",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      title={`${item ? "Edit" : "Add"} ${type === "track" ? "topic" : "section"}`}
    >
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!title.trim()) return;
          setBusy(true);
          setError("");
          const data = {
            ...item?.record?.data,
            category: type === "track" ? "learn-track" : "learn-topic",
            ...(type === "topic" ? { track } : {}),
            ...(item?.seedId ? { seedId: item.seedId } : {}),
            order: item?.record?.data.order ?? item?.order ?? order,
          };
          try {
            if (item?.record)
              await update(item.record.id, { title: title.trim(), body, data });
            else
              await create({ kind: "topic", title: title.trim(), body, data });
            onClose();
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : "Topic could not be saved.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Name">
          <Input
            autoFocus
            required
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label="Description (optional)">
          <Textarea
            rows={4}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </Field>
        {error && <p role="alert">{error}</p>}
        <Button disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
      </form>
    </Modal>
  );
}
