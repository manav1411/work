import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ExternalLink, Flame } from "lucide-react";
import { Link } from "react-router-dom";
import { useLearningData } from "./useLearningData";
import {
  AEST_OFFSET_SECONDS,
  buildSolvedByDay,
  countByDifficulty,
  DAY_SECONDS,
  solvedLast30,
  streakFromSolves,
  todayAestMidnight,
} from "./foundations/leetcodeMetrics";

const formatDay = (seconds: number) =>
  new Date((seconds + AEST_OFFSET_SECONDS) * 1000).toLocaleDateString(
    undefined,
    {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
    },
  );

export default function LeetCodeCalendar() {
  const { stats, configured, loading, error, source, reload } =
    useLearningData();
  const [today, setToday] = useState(todayAestMidnight);
  const [selected, setSelected] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const dismissing = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const cancelClose = () => clearTimeout(closeTimer.current);
  const leave = () => {
    if (window.matchMedia("(hover: hover)").matches)
      closeTimer.current = setTimeout(() => setSelected(null), 140);
  };
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      setToday(todayAestMidnight());
      clearTimeout(timer);
      timer = setTimeout(
        update,
        (todayAestMidnight() + DAY_SECONDS) * 1000 - Date.now() + 50,
      );
    };
    update();
    const visible = () => {
      if (document.visibilityState === "visible") {
        update();
        void reload();
      }
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [reload]);
  useEffect(() => {
    if (!selected) return;
    const dismiss = (event: PointerEvent) => {
      if (
        !(event.target as HTMLElement).closest(
          ".learn-calendar-day,.learn-calendar-popover",
        )
      )
        setSelected(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelected(null);
        dismissing.current = true;
        trigger.current?.focus();
        dismissing.current = false;
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [selected]);
  const derived = useMemo(() => {
    if (!stats) return null;
    const days = buildSolvedByDay(stats);
    return {
      days,
      streak: streakFromSolves(days),
      month: solvedLast30(days, Boolean(stats.solvedDays)),
    };
    // Recompute streak and month at the same fixed AEST midnight as the cells.
  }, [stats, today]);
  const cells = Array.from({ length: 30 }, (_, i) =>
    String(today - (29 - i) * DAY_SECONDS),
  );
  if (!configured && !loading)
    return (
      <section className="learn-calendar">
        <Link to="/settings">Connect your LeetCode username</Link>
      </section>
    );
  if (!stats || !derived)
    return (
      <section className="learn-calendar" aria-busy={loading}>
        {loading
          ? "Loading LeetCode progress…"
          : error || "No LeetCode progress yet."}
        {!loading && (
          <button
            type="button"
            className="button button-ghost"
            onClick={() => void reload()}
          >
            Retry
          </button>
        )}
      </section>
    );
  const selectedProblems = selected ? (derived.days[selected] ?? []) : [];
  return (
    <section
      ref={root}
      className="learn-calendar"
      aria-label="LeetCode progress"
      onBlur={(event) => {
        if (
          !(event.relatedTarget as HTMLElement | null)?.closest(
            ".learn-calendar-day,.learn-calendar-popover",
          )
        )
          setSelected(null);
      }}
    >
      <a
        className="learn-calendar-profile"
        href={`https://leetcode.com/u/${stats.username}/`}
        target="_blank"
        rel="noreferrer"
      >
        {stats.profile.userAvatar &&
          /^https:\/\/(?:assets\.leetcode\.com|leetcode\.com|s3-us-west-1\.amazonaws\.com)\//i.test(
            stats.profile.userAvatar,
          ) && (
            <img
              className="learn-calendar-avatar"
              src={stats.profile.userAvatar}
              alt=""
              referrerPolicy="no-referrer"
            />
          )}
        <strong>
          @{stats.username} <ExternalLink size={13} />
        </strong>
        {stats.profile.ranking !== null && (
          <small>Rank #{stats.profile.ranking.toLocaleString()}</small>
        )}
      </a>
      <div className="learn-calendar-history">
        <div className="learn-calendar-grid" aria-label="Last 30 days in AEST">
          {cells.map((key) => {
            const count = derived.days[key]?.length ?? 0;
            return (
              <button
                key={key}
                type="button"
                className={`learn-calendar-day ${count ? "is-solved" : ""} ${Number(key) === today ? "is-today" : ""}`}
                aria-label={`${formatDay(Number(key))}: ${count} solved`}
                aria-expanded={selected === key}
                aria-controls={
                  selected === key ? "leetcode-day-details" : undefined
                }
                onMouseEnter={() => {
                  cancelClose();
                  setSelected(key);
                }}
                onMouseLeave={leave}
                onFocus={(event) => {
                  trigger.current = event.currentTarget;
                  if (!dismissing.current) setSelected(key);
                }}
                onClick={(event) => {
                  trigger.current = event.currentTarget;
                  cancelClose();
                  setSelected(key);
                }}
              />
            );
          })}
        </div>
        <small>30 days · AEST{!stats.solvedDays ? " · recent feed" : ""}</small>
      </div>
      <div className="learn-calendar-metric">
        <strong>
          <Flame size={17} />
          {derived.streak}
        </strong>
        <small>day streak</small>
      </div>
      <div className="learn-calendar-metric">
        <strong>
          <Check size={17} />
          {derived.month.count}
          {derived.month.capped ? "+" : ""}
        </strong>
        <small>solved · 30d</small>
      </div>
      <div className="learn-calendar-total">
        <strong>
          {countByDifficulty(stats.solved, "All")}{" "}
          <small>/ {countByDifficulty(stats.totalQuestions, "All")}</small>
        </strong>
        <div>
          {(["Easy", "Medium", "Hard"] as const).map((difficulty) => (
            <span
              key={difficulty}
              className={`learn-calendar-${difficulty.toLowerCase()}`}
            >
              {difficulty} <b>{countByDifficulty(stats.solved, difficulty)}</b>
            </span>
          ))}
        </div>
      </div>
      {(source.stats.stale || error) && (
        <div className="learn-calendar-freshness" role="status">
          Cached
          {source.stats.fetchedAt
            ? ` · ${new Date(source.stats.fetchedAt).toLocaleString()}`
            : ""}
        </div>
      )}
      {selected && (
        <div
          id="leetcode-day-details"
          className="learn-calendar-popover"
          onMouseEnter={cancelClose}
          onMouseLeave={leave}
        >
          <header>
            <strong>{formatDay(Number(selected))}</strong>
          </header>
          {selectedProblems.length ? (
            <ul>
              {selectedProblems.map((problem, index) => (
                <li key={`${problem.titleSlug}-${index}`}>
                  <a
                    href={`https://leetcode.com/problems/${problem.titleSlug}/`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {problem.title}
                    <ExternalLink size={11} />
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p>No solves on record.</p>
          )}
        </div>
      )}
    </section>
  );
}
