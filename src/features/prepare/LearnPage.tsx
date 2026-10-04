import { useRef } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { learningUsername } from "../../../shared/learning";
import { Badge, Button, Card, PageHeader } from "../../components/ui";
import { LEARNING_TOPICS, TRACKS } from "../../content/learning";
import { useWorkspace } from "../../lib/workspace";
import { field, safeUrl } from "../../../shared/model";
import { Pomodoro } from "../learn/Pomodoro";
import { useLearningData } from "../learn/useLearningData";
import WeekBoard from "../learn/foundations/WeekBoard";
import Roadmap from "../learn/foundations/Roadmap";
import { roadmapTopics } from "../learn/foundations/roadmapData";
import "../learn/learn.css";

export function LearnPage() {
  const { records, preferences, mode } = useWorkspace();
  const learning = useLearningData();
  const [params, setParams] = useSearchParams();
  const tabRef = useRef<HTMLDivElement>(null);
  const track = TRACKS.some((item) => item.id === params.get("track"))
    ? params.get("track")!
    : "dsa";
  const view =
    params.get("view") === "roadmap" || params.has("problem")
      ? "roadmap"
      : "curriculum";
  const problemTopic = roadmapTopics.find((topic) =>
    topic.problems.some((problem) => problem.slug === params.get("problem")),
  )?.id;
  const personalise = learning.configured && !learning.loading;
  const showSource =
    mode !== "demo" &&
    (learning.configured || learning.source.content.fetchedAt);
  const selectTrack = (id: string) =>
    setParams(id === "dsa" ? {} : { track: id });
  const customTopics = records.filter(
    (record) =>
      record.kind === "topic" &&
      field(record, "track") === track &&
      !record.deletedAt,
  );
  const topics = LEARNING_TOPICS.filter((topic) => topic.track === track).map(
    (topic) => {
      const override = customTopics.find(
        (record) => field(record, "seedId") === topic.id,
      );
      return override
        ? {
            ...topic,
            title: override.title,
            summary: override.body,
            resource: field(override, "resource", topic.resource),
            url: field(override, "url", topic.url),
          }
        : topic;
    },
  );
  for (const topic of customTopics.filter((record) => !field(record, "seedId")))
    topics.push({
      id: topic.id,
      title: topic.title,
      track,
      summary: topic.body,
      resource: field(topic, "resource", "Open resource"),
      url: field(topic, "url"),
      exercise: "",
      recall: "",
      prerequisites: "",
    });

  return (
    <div className="page learn-page">
      <PageHeader title="Learn" />
      <div
        className="learn-track-tabs"
        ref={tabRef}
        role="tablist"
        aria-label="Learning topics"
      >
        {TRACKS.map((item) => (
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
              const index = TRACKS.findIndex(
                (candidate) => candidate.id === item.id,
              );
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? TRACKS.length - 1
                    : (index +
                        (event.key === "ArrowRight" ? 1 : -1) +
                        TRACKS.length) %
                      TRACKS.length;
              selectTrack(TRACKS[next].id);
              (tabRef.current?.children[next] as HTMLElement)?.focus();
            }}
          >
            {item.title}
          </button>
        ))}
      </div>
      <div
        id="learn-track-content"
        role="tabpanel"
        aria-labelledby={`learn-track-${track}`}
      >
        {track === "dsa" ? (
          <>
            <div className="learn-context-bar">
              <div className="learn-view-controls" aria-label="Curriculum view">
                <button
                  className={view === "curriculum" ? "active" : ""}
                  aria-pressed={view === "curriculum"}
                  onClick={() => setParams({})}
                >
                  Weeks
                </button>
                <button
                  className={view === "roadmap" ? "active" : ""}
                  aria-pressed={view === "roadmap"}
                  onClick={() => setParams({ view: "roadmap" })}
                >
                  Roadmap
                </button>
              </div>
              <Pomodoro />
            </div>
            {learning.error && (
              <div className="learn-source-error" role="alert">
                <span>{learning.error}</span>
                <Button
                  variant="ghost"
                  disabled={learning.loading || learning.pendingTasks.size > 0}
                  onClick={() => void learning.reload()}
                >
                  <RefreshCw size={15} />
                  Retry
                </Button>
              </div>
            )}
            {learning.loading && !learning.weeks.length && (
              <p className="muted" role="status">
                Loading curriculum…
              </p>
            )}
            {view === "curriculum" ? (
              <WeekBoard
                weeks={learning.weeks}
                solvedSlugs={learning.solvedSlugs}
                personalised={personalise}
                taskProgress={learning.tasks}
                pendingTasks={learning.pendingTasks}
                onToggleTask={(id, done) => void learning.toggleTask(id, done)}
              />
            ) : (
              <Roadmap
                solved={learning.solvedSlugs}
                personalised={personalise}
                initialTopic={problemTopic}
              />
            )}
            <footer className="learn-source-footer">
              {!learning.configured && !learning.loading && (
                <Link to="/settings">Set LeetCode username</Link>
              )}
              {showSource && (
                <details>
                  <summary>
                    {learning.username ||
                      learningUsername(preferences.leetcode) ||
                      "Learning source"}
                    {Object.values(learning.source).some(
                      (source) => source.stale,
                    )
                      ? " · Cached data"
                      : ""}
                  </summary>
                  <div className="learn-source-details">
                    <a
                      href="https://manavdodia.com/learn"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Personal-site curriculum
                      <ExternalLink size={13} />
                    </a>
                    {learning.username && (
                      <a
                        href={`https://leetcode.com/u/${encodeURIComponent(learning.username)}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        LeetCode profile
                        <ExternalLink size={13} />
                      </a>
                    )}
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
                      Confirmed solves use the personal site's accumulated
                      history. Earlier solves may be missing; an empty circle
                      means a solve has not been observed.
                    </p>
                    <Button
                      variant="ghost"
                      disabled={
                        learning.loading || learning.pendingTasks.size > 0
                      }
                      onClick={() => void learning.reload()}
                    >
                      <RefreshCw size={14} />
                      Refresh
                    </Button>
                  </div>
                </details>
              )}
              {mode === "demo" && (
                <Badge tone="muted">Demo curriculum and progress</Badge>
              )}
            </footer>
          </>
        ) : (
          <div className="learn-reading-grid">
            {topics.map((topic) => {
              const url = safeUrl(topic.url);
              return (
                <Card key={topic.id} className="learn-reading-card">
                  <h2>{topic.title}</h2>
                  <p>{topic.summary}</p>
                  {url && (
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      {topic.resource || "Open resource"}
                      <ExternalLink size={15} />
                    </a>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
