import {
  addDays,
  field,
  localDate,
  type WorkRecord,
} from "../../../shared/model";
import { goalProgress, type Goal } from "../../../shared/goals";
import { applicationStatus } from "../../../shared/applications";

export interface TimelineItem {
  id: string;
  date: string;
  title: string;
  detail: string;
  kind: "interview" | "deadline" | "milestone" | "progress" | "followup";
  record?: WorkRecord;
  goal?: Goal;
  completed: boolean;
  sortAt?: string;
}
export function timelineItems(
  records: WorkRecord[],
  goals: Goal[],
  timezone: string,
  today = localDate(new Date(), timezone),
): TimelineItem[] {
  const result: TimelineItem[] = [];
  const add = (item: TimelineItem) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(item.date)) result.push(item);
  };
  for (const record of records) {
    if (record.kind === "interview") {
      const at = field(record, "startsAt");
      if (!at || !Number.isFinite(Date.parse(at))) continue;
      const date = localDate(new Date(at), timezone),
        status = field(record, "status");
      if (status === "Cancelled" && date >= today) continue;
      add({
        id: `${record.id}:interview`,
        date,
        sortAt: at,
        title: record.title,
        detail: `${status === "Cancelled" ? "Cancelled · " : ""}${new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(at))}`,
        kind: "interview",
        record,
        completed: status === "Completed",
      });
    }
    if (record.kind === "application") {
      const closed = ["Rejected", "Withdrawn", "Accepted"].includes(
        applicationStatus(record),
      );
      for (const [key, label, kind] of [
        ["deadline", "Apply by", "deadline"],
        ["followUp", "Follow-up", "followup"],
      ] as const) {
        const date = field(record, key);
        if (!date || (closed && date >= today)) continue;
        add({
          id: `${record.id}:${key}`,
          date,
          title: record.title,
          detail: label,
          kind,
          record,
          completed: closed,
        });
      }
    }
    if (["path", "rotation", "decision", "company"].includes(record.kind)) {
      const date =
        field(record, "reviewDate") ||
        (record.kind === "rotation" ? field(record, "endDate") : "");
      if (date)
        add({
          id: `${record.id}:review`,
          date,
          title: record.title,
          detail:
            record.kind === "company"
              ? "Radar review"
              : field(record, "reviewDate")
                ? "Direction review"
                : "Experience milestone",
          kind: "followup",
          record,
          completed: field(record, "status") === "Completed",
        });
    }
  }
  for (const goal of goals) {
    if (goal.targetDate)
      add({
        id: `${goal.id}:target`,
        date: goal.targetDate,
        title: goal.title,
        detail: goalProgress(goal).complete ? "Complete" : "Target",
        kind: "milestone",
        goal,
        completed: goalProgress(goal).complete,
      });
    for (const milestone of goal.milestones) {
      const date =
        milestone.done && milestone.completedAt
          ? localDate(new Date(milestone.completedAt), timezone)
          : milestone.date;
      if (date)
        add({
          id: `${goal.id}:${milestone.id}`,
          date,
          title: milestone.title,
          detail: goal.title,
          kind: "milestone",
          goal,
          completed: milestone.done,
        });
    }
  }
  return result.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.sortAt ?? "").localeCompare(b.sortAt ?? "") ||
      a.id.localeCompare(b.id),
  );
}
export function windowItems(items: TimelineItem[], start: string, end: string) {
  return items.filter((item) => item.date >= start && item.date <= end);
}
export function dayDistance(a: string, b: string) {
  return (
    (Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000
  );
}
export function timelineLayout(
  items: TimelineItem[],
  start: string,
  end: string,
  width: number,
) {
  const cardWidth = Math.min(180, width * 0.35),
    span = Math.max(1, dayDistance(start, end));
  const lanes: number[] = [];
  return items.map((item) => {
    const x = (dayDistance(start, item.date) / span) * width;
    const markerX = Math.max(6, Math.min(width - 6, x));
    const left = Math.max(0, Math.min(width - cardWidth, x - cardWidth * 0.25));
    let lane = lanes.findIndex((right) => right + 12 <= left);
    if (lane < 0) lane = lanes.length;
    lanes[lane] = left + cardWidth;
    return { item, x, markerX, left, lane, cardWidth };
  });
}
export function timelineWeeks(start: string, end: string) {
  const result: string[] = [];
  for (let date = start; date <= end; date = addDays(date, 7))
    result.push(date);
  return result;
}
