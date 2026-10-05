import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { goalProgress } from "../../../shared/goals";
import { addDays, localDate, niceDate } from "../../../shared/model";
import { Button, PageHeader } from "../../components/ui";
import { useWorkspace } from "../../lib/workspace";
import { useGoals } from "../../lib/goals";
import { useLearningData } from "../learn/useLearningData";
import {
  observedProgress,
  useGoalMeasurements,
} from "../direction/goalMetrics";
import {
  dayDistance,
  timelineItems,
  timelineLayout,
  timelineWeeks,
  windowItems,
  type TimelineItem,
} from "./timeline";
import "./timeline.css";

export function TodayPage() {
  const { records, preferences, user } = useWorkspace();
  const navigate = useNavigate();
  const model = useGoals();
  const learning = useLearningData();
  const today = localDate(new Date(), preferences.timezone);
  const [offset, setOffset] = useState(0),
    [expanded, setExpanded] = useState(false);
  const [width, setWidth] = useState(800);
  const graphRef = useRef<HTMLDivElement>(null);
  useGoalMeasurements(model, learning, user?.id ?? "");
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
  useEffect(() => {
    const node = graphRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(280, entries[0].contentRect.width)),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [model.loading]);
  const openEvent = (item: TimelineItem) => {
    if (item.goal) navigate(`/direction?goal=${item.goal.id}`);
    else if (item.record?.kind === "interview")
      navigate(`/applications?interview=${item.record.id}`);
    else if (item.record?.kind === "company")
      navigate(`/applications?tab=radar&record=${item.record.id}`);
    else if (
      item.record &&
      ["path", "rotation", "decision"].includes(item.record.kind)
    )
      navigate(`/direction?record=${item.record.id}`);
    else if (item.record) navigate(`/applications?record=${item.record.id}`);
  };
  return (
    <div className="page-stack home-page">
      <PageHeader title="Home" />
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
              {layout.map(({ item, markerX, left, lane, cardWidth }) => (
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
                      left: `${markerX - left}px`,
                      height: `${lane * 100 + 30}px`,
                      top: `-${lane * 100 + 30}px`,
                    }}
                  />
                  <button onClick={() => openEvent(item)}>
                    <span
                      className="timeline-event-point"
                      style={{
                        left: `${markerX - left - 8}px`,
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
                    className={`timeline-goal-span ${progress.complete ? "is-complete" : ""}`}
                    style={{
                      left: `${left}%`,
                      width: `${Math.max(3, right - left)}%`,
                      top: `${lanes * 100 + 64 + index * 48}px`,
                    }}
                    onClick={() => navigate(`/direction?goal=${goal.id}`)}
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
          </>
        )}
      </section>
    </div>
  );
}
