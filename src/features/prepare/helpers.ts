import { addDays } from "../../../shared/model";

export function reviewInterval(confidence: number, streak = 0): number {
  if (confidence <= 2) return 1;
  if (confidence === 3) return 3;
  const intervals = [7, 14, 30];
  return intervals[Math.min(Math.max(streak, 0), intervals.length - 1)];
}
export function nextReview(
  date: string,
  confidence: number,
  streak = 0,
): string {
  return addDays(date, reviewInterval(confidence, streak));
}
export function splitTags(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
}
export function formatDuration(seconds: number): string {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}

/** Convert a wall-clock date in a named IANA zone to UTC, rejecting DST gaps. */
export function zonedDateTimeToISO(value: string, timezone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Enter a valid date and time.");
  const parts = match.slice(1).map(Number);
  const wall = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4]);
  const checkDate = new Date(wall);
  if (
    checkDate.getUTCFullYear() !== parts[0] ||
    checkDate.getUTCMonth() !== parts[1] - 1 ||
    checkDate.getUTCDate() !== parts[2] ||
    checkDate.getUTCHours() !== parts[3] ||
    checkDate.getUTCMinutes() !== parts[4]
  )
    throw new Error("Enter a valid calendar date and time.");
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  let instant = wall;
  for (let i = 0; i < 4; i++) {
    const p = Object.fromEntries(
      formatter
        .formatToParts(new Date(instant))
        .map((part) => [part.type, part.value]),
    );
    const rendered = Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
    );
    const difference = wall - rendered;
    instant += difference;
    if (!difference) break;
  }
  const p = Object.fromEntries(
    formatter
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
  if (`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` !== value)
    throw new Error(
      "This local time does not exist because of daylight saving. Choose another time.",
    );
  for (const offset of [
    -7_200_000, -3_600_000, -1_800_000, 1_800_000, 3_600_000, 7_200_000,
  ]) {
    const alternate = Object.fromEntries(
      formatter
        .formatToParts(new Date(instant + offset))
        .map((part) => [part.type, part.value]),
    );
    if (
      `${alternate.year}-${alternate.month}-${alternate.day}T${alternate.hour}:${alternate.minute}` ===
      value
    )
      throw new Error(
        "This local time occurs twice because daylight saving changes. Enter the intended time in UTC instead.",
      );
  }
  return new Date(instant).toISOString();
}

export function isoToZonedInput(value: string, timezone: string): string {
  if (!value || Number.isNaN(new Date(value).getTime())) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function calendarFile(
  title: string,
  startsAt: string,
  durationMinutes: number,
  description = "",
): string {
  const escape = (value: string) =>
    value
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");
  const date = (value: Date) =>
    value
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime()))
    throw new Error("Save an interview time before exporting.");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Work//Career workspace//EN",
    "BEGIN:VEVENT",
    `UID:${escape(startsAt + title)}@work.manavdodia.com`,
    `DTSTAMP:${date(new Date())}`,
    `DTSTART:${date(start)}`,
    `DTEND:${date(new Date(start.getTime() + durationMinutes * 60_000))}`,
    `SUMMARY:${escape(title)}`,
    `DESCRIPTION:${escape(description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
