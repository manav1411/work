import {
  addDays,
  boolField,
  field,
  localDate,
  numberField,
  type WorkRecord,
} from "../../../shared/model";

export function rankedActions(
  records: WorkRecord[],
  minutes: number,
  date: string,
): { record: WorkRecord; reason: string; score: number }[] {
  return records
    .filter(
      (record) =>
        record.kind === "action" && field(record, "status", "todo") !== "done",
    )
    .map((record) => {
      let score = 0;
      const reasons: string[] = [];
      if (boolField(record, "pinned")) {
        score += 100;
        reasons.push("You pinned this");
      }
      const due = field(record, "dueDate");
      if (due && due <= date) {
        score += 65;
        reasons.push(due < date ? "Ready to revisit" : "Due today");
      } else if (due && due <= addDays(date, 3)) {
        score += 40;
        reasons.push("A deadline is approaching");
      }
      if (field(record, "priority") === "high") {
        score += 30;
        reasons.push("A priority for your next move");
      }
      if (field(record, "status") === "doing") {
        score += 25;
        reasons.push("Continue where you left off");
      }
      const duration = numberField(record, "estimatedMinutes", 15);
      if (duration <= minutes) {
        score += 20;
        reasons.push(`Fits ${minutes} minutes`);
      } else reasons.push("Start with the first step");
      return {
        record,
        score,
        reason: reasons.slice(0, 2).join(" · ") || "A useful next move",
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.record.createdAt.localeCompare(b.record.createdAt),
    );
}

export interface AgendaItem {
  id: string;
  title: string;
  date: string;
  kind: string;
  record: WorkRecord;
}
export function agendaItems(
  records: WorkRecord[],
  timezone: string,
): AgendaItem[] {
  const today = localDate(new Date(), timezone);
  const items: AgendaItem[] = [];
  for (const record of records) {
    const values: [string, string][] =
      record.kind === "interview" &&
      !["Completed", "Cancelled"].includes(field(record, "status"))
        ? [["startsAt", "Interview"]]
        : record.kind === "application" &&
            !["Rejected", "Withdrawn", "Accepted"].includes(
              field(record, "stage"),
            )
          ? [
              ["deadline", "Apply by"],
              ["followUp", "Follow-up"],
            ]
          : record.kind === "contact"
            ? [["followUp", "Follow-up"]]
            : record.kind === "resource"
              ? [["date", "Event"]]
              : record.kind === "progress"
                ? [
                    [
                      "nextReview",
                      record.data.category === "problem"
                        ? "Problem review"
                        : "Learning review",
                    ],
                  ]
                : record.kind === "action" && field(record, "status") !== "done"
                  ? [["dueDate", "Action"]]
                  : [];
    for (const [key, kind] of values) {
      const date = field(record, key);
      if (
        !date ||
        !Number.isFinite(
          new Date(date.length === 10 ? `${date}T12:00:00Z` : date).getTime(),
        )
      )
        continue;
      const calendarDate =
        date.length === 10 ? date : localDate(new Date(date), timezone);
      if (calendarDate >= today && calendarDate <= addDays(today, 14))
        items.push({
          id: `${record.id}:${key}`,
          title: record.title,
          date,
          kind,
          record,
        });
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 12);
}

export function weekStart(date: string): string {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDays(date, -(day === 0 ? 6 : day - 1));
}

export function weeklyStats(records: WorkRecord[], timezone: string) {
  const today = localDate(new Date(), timezone);
  const start = weekStart(today);
  const recent = (date: string) => {
    if (!date || !Number.isFinite(new Date(date).getTime())) return false;
    const day = date.length === 10 ? date : localDate(new Date(date), timezone);
    return day >= start && day <= today;
  };
  return {
    actions: records.filter(
      (record) =>
        record.kind === "action" &&
        field(record, "status") === "done" &&
        recent(field(record, "completedAt", record.updatedAt)),
    ).length,
    practice: records.filter(
      (record) =>
        record.kind === "practice" &&
        recent(field(record, "attemptedAt", record.createdAt)),
    ).length,
    applications: records.filter(
      (record) =>
        record.kind === "application" && recent(field(record, "submittedAt")),
    ).length,
    evidence: records.filter(
      (record) => record.kind === "achievement" && recent(record.createdAt),
    ).length,
    minutes: Math.round(
      records
        .filter(
          (record) =>
            record.kind === "focus" &&
            field(record, "status") === "completed" &&
            recent(field(record, "completedAt", record.updatedAt)),
        )
        .reduce(
          (sum, record) => sum + numberField(record, "elapsedSeconds") / 60,
          0,
        ),
    ),
  };
}
