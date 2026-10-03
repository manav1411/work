import { describe, expect, it } from "vitest";
import { roadmapTopics, roadmapTotalProblems } from "../src/content/problems";
import {
  calendarFile,
  isoToZonedInput,
  nextReview,
  reviewInterval,
  splitTags,
  zonedDateTimeToISO,
} from "../src/features/prepare/helpers";

describe("practice review scheduling", () => {
  it("revisits weak recall promptly and spaces independent recall", () => {
    expect(reviewInterval(1, 4)).toBe(1);
    expect(reviewInterval(3, 4)).toBe(3);
    expect(reviewInterval(4, 0)).toBe(7);
    expect(reviewInterval(5, 1)).toBe(14);
    expect(reviewInterval(5, 20)).toBe(30);
    expect(nextReview("2026-12-29", 4)).toBe("2027-01-05");
  });
  it("preserves the full imported 150 catalogue without duplicate slugs", () => {
    const slugs = roadmapTopics.flatMap((topic) =>
      topic.problems.map((problem) => problem.slug),
    );
    expect(roadmapTotalProblems).toBe(150);
    expect(new Set(slugs).size).toBe(150);
  });
});
describe("interview timezone handling", () => {
  it("converts Melbourne daylight saving and winter offsets", () => {
    expect(zonedDateTimeToISO("2026-11-10T09:30", "Australia/Melbourne")).toBe(
      "2026-11-09T22:30:00.000Z",
    );
    expect(zonedDateTimeToISO("2026-07-10T09:30", "Australia/Melbourne")).toBe(
      "2026-07-09T23:30:00.000Z",
    );
  });
  it("round-trips a Pacific interview independently of the browser timezone", () => {
    const iso = zonedDateTimeToISO("2026-12-02T15:00", "America/Los_Angeles");
    expect(iso).toBe("2026-12-02T23:00:00.000Z");
    expect(isoToZonedInput(iso, "America/Los_Angeles")).toBe(
      "2026-12-02T15:00",
    );
  });
  it("rejects impossible, ambiguous and invalid wall times", () => {
    expect(() =>
      zonedDateTimeToISO("2026-10-04T02:30", "Australia/Melbourne"),
    ).toThrow("does not exist");
    expect(() =>
      zonedDateTimeToISO("2026-11-01T01:30", "America/Los_Angeles"),
    ).toThrow("occurs twice");
    expect(() => zonedDateTimeToISO("2026-02-30T15:00", "UTC")).toThrow(
      "valid calendar",
    );
    expect(() => zonedDateTimeToISO("broken", "UTC")).toThrow();
    expect(() => zonedDateTimeToISO("2026-12-02T15:00", "Not/AZone")).toThrow();
  });
  it("exports a timed UTC calendar event and escapes control characters", () => {
    const value = calendarFile(
      "Interview, round 1",
      "2026-12-02T23:00:00.000Z",
      45,
      "Notes\nA;B",
    );
    expect(value).toContain("DTSTART:20261202T230000Z");
    expect(value).toContain("DTEND:20261202T234500Z");
    expect(value).toContain("SUMMARY:Interview\\, round 1");
    expect(value).toContain("DESCRIPTION:Notes\\nA\\;B");
  });
});
it("normalises tags without losing meaningful words", () => {
  expect(splitTags("python, ownership, python, , system design")).toEqual([
    "python",
    "ownership",
    "system design",
  ]);
});
