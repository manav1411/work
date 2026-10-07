import { field, localDate, type WorkRecord } from "../../../shared/model";

export function applicationCompany(
  record: WorkRecord,
  _records: WorkRecord[],
): string {
  return field(record, "company");
}

export function applicationContact(
  record: WorkRecord,
  _records: WorkRecord[],
): string {
  return field(record, "contact");
}

export function associatedInterviews(
  records: WorkRecord[],
  applicationId: string,
): WorkRecord[] {
  return records
    .filter((record) => {
      const owner = field(record, "applicationId");
      return record.kind === "interview" && owner === applicationId;
    })
    .sort(
      (a, b) =>
        field(a, "startsAt").localeCompare(field(b, "startsAt")) ||
        a.id.localeCompare(b.id),
    );
}

export function nextScheduledDate(
  record: WorkRecord,
  records: WorkRecord[],
  timezone: string,
  now = new Date(),
): string {
  const today = localDate(now, timezone);
  const dateOnly = [
    field(record, "deadline"),
    field(record, "followUp"),
  ].filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= today);
  const interviews = associatedInterviews(records, record.id)
    .filter(
      (item) => !["Cancelled", "Completed"].includes(field(item, "status")),
    )
    .map((item) => field(item, "startsAt"))
    .filter(
      (value) =>
        value &&
        !Number.isNaN(new Date(value).getTime()) &&
        new Date(value).getTime() >= now.getTime(),
    );
  return (
    [...interviews, ...dateOnly].sort((a, b) => {
      const day = (value: string) =>
        value.length === 10 ? value : localDate(new Date(value), timezone);
      return day(a).localeCompare(day(b));
    })[0] || ""
  );
}

export function interviewTime(record: WorkRecord, timezone: string): string {
  const value = field(record, "startsAt");
  if (!value || Number.isNaN(new Date(value).getTime())) return "Time not set";
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}
