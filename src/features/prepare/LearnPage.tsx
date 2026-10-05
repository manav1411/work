import { useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Button, PageHeader } from "../../components/ui";
import { useWorkspace } from "../../lib/workspace";
import { useEditMode } from "../../lib/edit-mode";
import { CompanyGlyph } from "../../components/CompanyGlyph";
import { Pomodoro } from "../learn/Pomodoro";
import { useLearningData } from "../learn/useLearningData";
import Roadmap from "../learn/foundations/Roadmap";
import LeetCodeCalendar from "../learn/LeetCodeCalendar";
import { roadmapTopics } from "../../content/problems";
import {
  learningSubjects,
  learningTopics,
  type EditableLearningTopic,
  type LearningSubject,
} from "../learn/topics";
import { ContentPanel } from "../content/ContentPanel";
import { DeleteControl } from "../content/DeleteControl";
import { InlineTitle } from "../content/InlineTitle";
import { SortableList } from "../content/SortableList";
import { reorderRecords } from "../content/reorderRecords";
import "../learn/learn.css";

export function LearnPage() {
  const { editing, continueCreation } = useEditMode();
  const workspace = useWorkspace();
  const { records, create, update, remove } = workspace;
  const learning = useLearningData({ revalidateOnEntry: true });
  const [params, setParams] = useSearchParams();
  const [error, setError] = useState("");
  const [newId, setNewId] = useState("");
  const subjects = learningSubjects(records);
  const track = subjects.some((item) => item.id === params.get("track"))
    ? params.get("track")!
    : "dsa";
  const subject = subjects.find((item) => item.id === track)!;
  const topics = learningTopics(records, track);
  const problemTopic = roadmapTopics.find((topic) =>
    topic.problems.some((problem) => problem.slug === params.get("problem")),
  )?.id;
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
    title = item.title,
  ) => {
    const data = {
      ...item.record?.data,
      category: type === "track" ? "learn-track" : "learn-topic",
      ...(type === "topic" ? { track } : {}),
      ...(item.seedId ? { seedId: item.seedId } : {}),
      ...patch,
    };
    return item.record
      ? update(item.record.id, { title, data })
      : create({
          kind: "topic",
          title,
          body: "description" in item ? item.description : item.summary,
          data,
        });
  };
  const reorder = async (type: "track" | "topic", ids: string[]) => {
    const ordered = [];
    for (const [order, id] of ids.entries()) {
      const item = (type === "track" ? subjects : topics).find(
        (item) => item.id === id,
      )!;
      ordered.push(
        item.record ??
          (await saveItem(type, item, { order: item.order ?? order })),
      );
    }
    await reorderRecords(ordered, workspace);
  };
  const add = async (type: "track" | "topic") => {
    const record = await create({
      kind: "topic",
      title: "Untitled",
      data: {
        category: type === "track" ? "learn-track" : "learn-topic",
        ...(type === "topic" ? { track } : {}),
        order: type === "track" ? subjects.length : topics.length,
      },
    });
    setNewId(record.id);
    if (type === "track") {
      continueCreation();
      selectTrack(record.id);
    }
  };
  return (
    <div className="page learn-page">
      <PageHeader
        title="Learn"
        action={
          editing && (
            <Button onClick={() => void perform(() => add("track"))}>
              <Plus size={16} />
              Add topic
            </Button>
          )
        }
      />
      <SortableList
        className="section-tabs learn-track-tabs editable-tabs"
        horizontal
        label="Learning topics"
        items={subjects}
        onReorder={(ids) => reorder("track", ids)}
      >
        {(item, handle) => (
          <div
            className={`editable-tab ${track === item.id ? "active" : ""}`}
            role="tab"
            id={`learn-track-${item.id}`}
            aria-label={item.title}
            aria-selected={track === item.id}
            tabIndex={track === item.id ? 0 : -1}
            onClick={() => selectTrack(item.id)}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                selectTrack(item.id);
              }
              if (
                ["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)
              ) {
                event.preventDefault();
                const index = subjects.findIndex(
                  (value) => value.id === item.id,
                );
                const next =
                  subjects[
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? subjects.length - 1
                        : (index +
                            (event.key === "ArrowRight" ? 1 : -1) +
                            subjects.length) %
                          subjects.length
                  ];
                selectTrack(next.id);
                document.getElementById(`learn-track-${next.id}`)?.focus();
              }
            }}
          >
            {handle}
            <CompanyGlyph name={item.title} />
            <InlineTitle
              value={item.title}
              label="Topic name"
              autoFocus={newId === item.id}
              onSave={(title) => saveItem("track", item, {}, title)}
            />
          </div>
        )}
      </SortableList>
      {error && (
        <p role="alert" className="content-save-error">
          {error}
        </p>
      )}
      {editing && track !== "dsa" && (
        <div className="content-item-actions">
          <DeleteControl
            label="Delete topic"
            onDelete={async () => {
              if (subject.seedId)
                await saveItem("track", subject, { hidden: true });
              else if (subject.record) await remove(subject.record.id);
              selectTrack("dsa");
            }}
          />
        </div>
      )}
      {track === "dsa" && (
        <>
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
          <div className="learn-progress-row">
            <LeetCodeCalendar />
            <Pomodoro />
          </div>
          <Roadmap
            solved={learning.solvedSlugs}
            personalised={learning.configured && Boolean(learning.stats)}
            initialTopic={problemTopic}
          />
          <ContentPanel
            context={{ scope: "learn", track: "dsa", seedId: "dsa-resources" }}
            seeds={[
              {
                id: "leetcode",
                title: "LeetCode problems",
                url: "https://leetcode.com/problemset/",
              },
              {
                id: "python-tutorial",
                title: "Python tutorial",
                url: "https://docs.python.org/3/tutorial/",
              },
              {
                id: "python-library",
                title: "Python standard library",
                url: "https://docs.python.org/3/library/",
              },
            ]}
          />
        </>
      )}
      {editing && track !== "dsa" && (
        <Button
          variant="secondary"
          onClick={() => void perform(() => add("topic"))}
        >
          <Plus size={15} />
          Add section
        </Button>
      )}
      <SortableList
        className="learn-editable-topics"
        items={topics}
        onReorder={(ids) => reorder("topic", ids)}
      >
        {(topic, handle) => (
          <section className="learn-reading-card">
            <header className="content-section-heading">
              <h2>
                {handle}
                <CompanyGlyph name={topic.title} />
                <InlineTitle
                  value={topic.title}
                  autoFocus={newId === topic.id}
                  label="Section name"
                  onSave={(title) => saveItem("topic", topic, {}, title)}
                />
              </h2>
              {editing && (
                <DeleteControl
                  label="Delete section"
                  onDelete={async () => {
                    if (topic.seedId)
                      await saveItem("topic", topic, { hidden: true });
                    else if (topic.record) await remove(topic.record.id);
                  }}
                />
              )}
            </header>
            <ContentPanel
              context={{
                scope: "learn",
                track,
                ...(topic.seedId
                  ? { seedId: topic.seedId }
                  : { topicId: topic.id }),
              }}
              initialBody={topic.record?.body ?? ""}
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
          </section>
        )}
      </SortableList>
    </div>
  );
}
