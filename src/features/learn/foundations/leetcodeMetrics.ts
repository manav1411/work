// Shared, presentation-agnostic helpers for turning raw LeetCode stats into the
// numbers we show (streaks, difficulty counts, recent-solve rollups). Used by
// both the detailed LeetCodeStats card and the compact CohortLeaderboard rows.

import type {
  Difficulty,
  DifficultyCount,
  LeetCodeStats,
  SolvedProblem,
} from "../../../../shared/learning";

export const DAY_SECONDS = 86400;

// Day boundaries are anchored to AEST (fixed UTC+10, deliberately ignoring
// daylight saving) rather than UTC, so "today" rolls over at local midnight
// instead of 10am. Keeping it a fixed offset means every day is exactly
// DAY_SECONDS long, so the streak/heatmap arithmetic below stays exact.
export const AEST_OFFSET_SECONDS = 10 * 3600;

export function countByDifficulty(
  list: DifficultyCount[] | undefined,
  difficulty: Difficulty,
): number {
  return list?.find((d) => d.difficulty === difficulty)?.count ?? 0;
}

/** Floor a timestamp to the start of its AEST day, in unix seconds (UTC epoch). */
export function aestDayStart(ts: number): number {
  return (
    Math.floor((ts + AEST_OFFSET_SECONDS) / DAY_SECONDS) * DAY_SECONDS -
    AEST_OFFSET_SECONDS
  );
}

/** Unix seconds for the start of today in AEST. */
export function todayAestMidnight(): number {
  return aestDayStart(Math.floor(Date.now() / 1000));
}

/** Floor a timestamp to its AEST-day key (as used in the calendar map). */
export function dayKeyForTimestamp(ts: number): string {
  return String(aestDayStart(ts));
}

export type SolvedByDay = Record<string, SolvedProblem[]>;

/**
 * Day -> solves map. Prefers the accumulated KV history (stats.solvedDays, built
 * up past LeetCode's 20-item cap) and falls back to deriving days from the live
 * recent-AC feed when it's absent. This is the single source of truth for the
 * heatmap, streak, and 30-day count so they always agree.
 *
 * When falling back to `recent`, each slug is kept on its earliest AEST day only
 * — LeetCode's feed can include multiple ACs of the same problem (re-solves).
 */
export function buildSolvedByDay(
  stats: Pick<LeetCodeStats, "solvedDays" | "recent">,
): SolvedByDay {
  if (stats.solvedDays) return stats.solvedDays;
  const map: SolvedByDay = {};
  const seen = new Set<string>();
  const ordered = [...stats.recent].sort(
    (a, b) => Number(a.timestamp) - Number(b.timestamp),
  );
  for (const submission of ordered) {
    if (seen.has(submission.titleSlug)) continue;
    seen.add(submission.titleSlug);
    const key = dayKeyForTimestamp(Number(submission.timestamp));
    (map[key] ??= []).push({
      title: submission.title,
      titleSlug: submission.titleSlug,
    });
  }
  return map;
}

/** Current day-streak of solves, from a day -> solves map. */
export function streakFromSolves(solvedByDay: SolvedByDay): number {
  return currentStreak(new Set(Object.keys(solvedByDay)));
}

/** Consecutive days of activity ending today or yesterday; 0 if broken. */
export function currentStreak(active: Set<string>): number {
  if (active.size === 0) return 0;
  let cursor = todayAestMidnight();
  if (!active.has(String(cursor)) && active.has(String(cursor - DAY_SECONDS))) {
    cursor -= DAY_SECONDS;
  } else if (!active.has(String(cursor))) {
    return 0;
  }
  let streak = 0;
  while (active.has(String(cursor))) {
    streak += 1;
    cursor -= DAY_SECONDS;
  }
  return streak;
}

/**
 * Distinct problems solved in the last 30 days, from a day -> solves map. With
 * the accumulated KV history the count is authoritative; when we've fallen back
 * to the raw 20-item feed (`accurate = false`) it may still be undercounting, so
 * `capped` is reported.
 */
export function solvedLast30(
  solvedByDay: SolvedByDay,
  accurate: boolean,
): { count: number; capped: boolean } {
  const cutoff = todayAestMidnight() - 29 * DAY_SECONDS;
  const slugs = new Set<string>();
  for (const [key, list] of Object.entries(solvedByDay)) {
    if (Number(key) < cutoff) continue;
    for (const problem of list) slugs.add(problem.titleSlug);
  }
  const count = slugs.size;
  return { count, capped: !accurate && count >= 20 };
}

/**
 * Every slug the user has solved, from a day -> solves map. Backed by the
 * accumulated KV history when available (so it isn't limited to the last ~20
 * accepted submissions), else the live feed. Powers the homework "solved" ticks.
 */
export function solvedSlugs(solvedByDay: SolvedByDay): Set<string> {
  const slugs = new Set<string>();
  for (const list of Object.values(solvedByDay)) {
    for (const problem of list) slugs.add(problem.titleSlug);
  }
  return slugs;
}
