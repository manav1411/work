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
import { learningSubjects, type LearningSubject } from "../learn/topics";
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
    item: LearningSubject,
    patch: Record<string, unknown>,
    title = item.title,
    expectedVersion?: number,
  ) => {
    const data = {
      ...item.record?.data,
      category: "learn-track",
      ...(item.seedId ? { seedId: item.seedId } : {}),
      ...patch,
    };
    return item.record
      ? update(item.record.id, { title, data }, expectedVersion)
      : create({
          kind: "topic",
          title,
          body: item.description,
          data,
        });
  };
  const addTrack = async () => {
    const record = await create({
      kind: "topic",
      title: "Untitled",
      data: {
        category: "learn-track",
        order: subjects.length,
      },
    });
    setNewId(record.id);
    continueCreation();
    selectTrack(record.id);
  };
  return (
    <div
      className={`page learn-page ${track === "dsa" ? "" : "learn-notes-page"}`}
    >
      <PageHeader
        title="Learn"
        action={
          editing && (
            <Button onClick={() => void perform(addTrack)}>
              <Plus size={16} />
              Add tab
            </Button>
          )
        }
      />
      <SortableList
        className="section-tabs learn-track-tabs editable-tabs"
        horizontal
        label="Learning tabs"
        items={subjects}
        onReorder={async (ids) => {
          const ordered = [];
          for (const id of ids) {
            const item = subjects.find((subject) => subject.id === id)!;
            ordered.push(item.record ?? (await saveItem(item, {})));
          }
          await reorderRecords(ordered, workspace);
        }}
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
              draftKey={`learn-title:${item.id}`}
              version={item.record?.version}
              value={item.title}
              label="Topic name"
              autoFocus={newId === item.id}
              onSave={(title, version) => saveItem(item, {}, title, version)}
            />
          </div>
        )}
      </SortableList>
      {editing && track !== "dsa" && (
        <div className="selected-tab-actions">
          <DeleteControl
            label="Delete tab"
            actionVariant="danger"
            onDelete={async () => {
              const item = subjects.find((subject) => subject.id === track);
              if (item?.seedId) await saveItem(item, { hidden: true });
              else if (item?.record) await remove(item.record.id);
              selectTrack("dsa");
            }}
          />
        </div>
      )}
      {error && (
        <p role="alert" className="content-save-error">
          {error}
        </p>
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
            allowBlockReordering={false}
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
      {track !== "dsa" && (
        <ContentPanel
          context={{ scope: "learn", track }}
          allowBlockReordering={false}
        />
      )}
    </div>
  );
}
