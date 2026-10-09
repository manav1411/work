import type { Goal } from "../../../shared/goals";

const DAY = 86_400_000;
function day(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const value = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(value) &&
    new Date(value).toISOString().slice(0, 10) === date
    ? value / DAY
    : null;
}
export interface DateAxis {
  start: number;
  end: number;
  inferred: boolean;
}
/** Keep complete goal dates fixed. Infer only missing bounds from action dates. */
export function goalDateAxis(
  start: string,
  end: string,
  actions: Pick<Goal, "startDate" | "targetDate">[],
): DateAxis | null {
  const from = day(start),
    to = day(end);
  if (
    (start && from === null) ||
    (end && to === null) ||
    (from !== null && to !== null && from > to)
  )
    return null;
  const dates = actions
    .flatMap((action) => [day(action.startDate), day(action.targetDate)])
    .filter((value): value is number => value !== null);
  if (from !== null) dates.push(from);
  if (to !== null) dates.push(to);
  if (!dates.length) return null;
  const first = from ?? Math.min(...dates),
    last = to ?? Math.max(...dates);
  return {
    start: Math.min(first, last),
    end: Math.max(first + 1, last),
    inferred: from === null || to === null,
  };
}
export function actionDateSpan(
  start: string,
  end: string,
  axis: DateAxis | null,
) {
  const from = day(start),
    to = day(end);
  if (
    (start && from === null) ||
    (end && to === null) ||
    (from !== null && to !== null && from > to)
  )
    return { kind: "invalid" as const, label: "Check dates" };
  if (from === null && to === null)
    return { kind: "missing" as const, label: "Dates not set" };
  if (!axis)
    return {
      kind: "unscaled" as const,
      label: "Set goal dates to compare timing",
    };
  const first = from ?? to!,
    last = to ?? from!;
  const position = (value: number) =>
    Math.max(
      0,
      Math.min(100, ((value - axis.start) / (axis.end - axis.start)) * 100),
    );
  const left = position(first),
    right = position(last);
  const before = first < axis.start,
    after = last > axis.end;
  return {
    kind: "scaled" as const,
    left,
    width: right - left,
    point: from === null || to === null || from === to,
    before,
    after,
    label:
      last < axis.start
        ? "Before goal range"
        : first > axis.end
          ? "After goal range"
          : before && after
            ? "Extends beyond goal range"
            : before
              ? "Starts before goal"
              : after
                ? "Ends after goal"
                : from === null
                  ? "End date only"
                  : to === null
                    ? "Start date only"
                    : from === to
                      ? "One day"
                      : "Within goal range",
  };
}

export function scheduleDate(value: string): string {
  const date = day(value);
  return date === null
    ? value
    : new Intl.DateTimeFormat("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(date * DAY));
}

export function todayOnAxis(
  axis: DateAxis | null,
  today: string,
): number | null {
  const value = day(today);
  if (!axis || value === null || value < axis.start || value > axis.end)
    return null;
  return ((value - axis.start) / (axis.end - axis.start)) * 100;
}
