import {
  actionDateSpan,
  scheduleDate,
  todayOnAxis,
  type DateAxis,
} from "./goalSchedule";

function DateLabels({ start, end }: { start: string; end: string }) {
  return (
    <div className="schedule-labels">
      <time>{start ? scheduleDate(start) : "Start not set"}</time>
      <time>{end ? scheduleDate(end) : "End not set"}</time>
    </div>
  );
}
export function GoalDateBar({
  start,
  end,
  axis,
  today,
}: {
  start: string;
  end: string;
  axis: DateAxis | null;
  today: string;
}) {
  const todayPosition = todayOnAxis(axis, today);
  return (
    <div
      className="goal-schedule"
      aria-label={`Goal schedule: ${start || "start not set"} to ${end || "end not set"}`}
    >
      <DateLabels start={start} end={end} />
      <div
        className={`schedule-track goal-schedule-track ${axis ? "" : "is-undated"}`}
        aria-hidden="true"
      >
        <span />
      </div>
      {todayPosition !== null && (
        <div className="schedule-today-label">
          <span
            className="schedule-today"
            style={{
              left: `${todayPosition}%`,
              transform:
                todayPosition < 10
                  ? "none"
                  : todayPosition > 90
                    ? "translateX(-100%)"
                    : "translateX(-50%)",
            }}
            aria-label={`Today: ${today}`}
          >
            <i
              aria-hidden="true"
              style={{
                left:
                  todayPosition < 10
                    ? "0"
                    : todayPosition > 90
                      ? "100%"
                      : "50%",
              }}
            />
            Today
          </span>
        </div>
      )}
      {axis?.inferred ? (
        <small>Scale inferred from action dates</small>
      ) : !axis ? (
        <small>
          {start && end
            ? "Check goal dates"
            : "Set goal dates to compare timing"}
        </small>
      ) : null}
    </div>
  );
}
export function ActionDateBar({
  start,
  end,
  axis,
}: {
  start: string;
  end: string;
  axis: DateAxis | null;
}) {
  const span = actionDateSpan(start, end, axis);
  return (
    <div
      className={`action-schedule ${span.kind === "scaled" && !span.point && span.width < 40 ? "has-narrow-dates" : ""}`}
      aria-label={`Action schedule: ${start || "start not set"} to ${end || "end not set"}. ${span.label}`}
    >
      {span.kind === "scaled" ? (
        <div
          className={`action-date-labels ${!span.point && span.width < 40 ? "is-narrow" : ""}`}
        >
          {span.point ? (
            <time
              className="action-date-point"
              style={{
                left: `${span.left}%`,
                transform:
                  span.left < 20
                    ? "none"
                    : span.left > 80
                      ? "translateX(-100%)"
                      : "translateX(-50%)",
              }}
            >
              {scheduleDate(start || end)}
            </time>
          ) : (
            <>
              <time
                className="action-date-start"
                style={{
                  left: `${span.left}%`,
                  transform: span.left > 70 ? "translateX(-100%)" : "none",
                }}
              >
                {scheduleDate(start)}
              </time>
              <time
                className="action-date-end"
                style={{
                  left: `${span.left + span.width}%`,
                  transform:
                    span.left + span.width < 20 ? "none" : "translateX(-100%)",
                }}
              >
                {scheduleDate(end)}
              </time>
            </>
          )}
        </div>
      ) : (
        <DateLabels start={start} end={end} />
      )}
      <div
        className={`schedule-track ${span.kind === "scaled" ? "" : "is-undated"}`}
        aria-hidden="true"
      >
        {span.kind === "scaled" && (
          <span
            className={`schedule-span ${span.point || span.width === 0 ? "is-point" : ""}`}
            style={{ left: `${span.left}%`, width: `${span.width}%` }}
          />
        )}
        {span.kind === "scaled" && span.before && (
          <span className="schedule-overflow before">‹</span>
        )}
        {span.kind === "scaled" && span.after && (
          <span className="schedule-overflow after">›</span>
        )}
      </div>
      {(span.kind !== "scaled" || span.label !== "Within goal range") && (
        <small>{span.label}</small>
      )}
    </div>
  );
}
