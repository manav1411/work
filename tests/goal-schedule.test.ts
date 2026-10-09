import { actionOrder, EMPTY_GOAL, eventStatus, newGoal } from "../shared/goals";
import { describe, expect, it } from "vitest";
import {
  actionDateSpan,
  goalDateAxis,
  todayOnAxis,
} from "../src/features/direction/goalSchedule";

describe("relative action schedules", () => {
  const axis = goalDateAxis("2030-01-01", "2030-01-11", [])!;
  it("positions actions against the goal dates without stretching the scale", () => {
    expect(actionDateSpan("2030-01-03", "2030-01-07", axis)).toMatchObject({
      kind: "scaled",
      left: 20,
      width: 40,
      before: false,
      after: false,
    });
    expect(actionDateSpan("2029-12-31", "2030-01-05", axis)).toMatchObject({
      left: 0,
      width: 40,
      before: true,
    });
    expect(actionDateSpan("2030-01-08", "2030-01-15", axis)).toMatchObject({
      left: 70,
      width: 30,
      after: true,
    });
    expect(actionDateSpan("2030-01-15", "2030-01-16", axis)).toMatchObject({
      left: 100,
      width: 0,
      label: "After goal range",
    });
    expect(actionDateSpan("2029-12-20", "2029-12-21", axis)).toMatchObject({
      left: 0,
      width: 0,
      label: "Before goal range",
    });
  });
  it("positions today only inside the goal range", () => {
    expect(todayOnAxis(axis, "2030-01-06")).toBe(50);
    expect(todayOnAxis(axis, "2029-12-31")).toBeNull();
    expect(todayOnAxis(axis, "2030-01-12")).toBeNull();
    expect(todayOnAxis(null, "2030-01-06")).toBeNull();
  });
  it("handles single dates, missing dates and invalid ranges explicitly", () => {
    expect(actionDateSpan("", "2030-01-05", axis)).toMatchObject({
      point: true,
      left: 40,
      label: "End date only",
    });
    expect(actionDateSpan("2030-01-05", "", axis)).toMatchObject({
      point: true,
      label: "Start date only",
    });
    expect(actionDateSpan("2030-01-05", "2030-01-05", axis)).toMatchObject({
      point: true,
      label: "One day",
    });
    expect(actionDateSpan("", "", axis).kind).toBe("missing");
    expect(actionDateSpan("2030-01-07", "2030-01-03", axis).kind).toBe(
      "invalid",
    );
    expect(actionDateSpan("2030-02-30", "", axis).kind).toBe("invalid");
    expect(actionDateSpan("2030-01-05", "", null).kind).toBe("unscaled");
  });
  it("infers missing goal bounds and supports same-day and cross-year goals", () => {
    expect(goalDateAxis("", "", [])).toBeNull();
    expect(goalDateAxis("2030-01-11", "2030-01-01", [])).toBeNull();
    const inferred = goalDateAxis("", "", [
      { startDate: "2030-01-01", targetDate: "2030-01-11" },
    ])!;
    expect(inferred).toEqual({ ...axis, inferred: true });
    expect(actionDateSpan("2030-01-03", "2030-01-07", inferred)).toMatchObject({
      left: 20,
      width: 40,
    });
    const single = goalDateAxis("2030-01-01", "2030-01-01", [])!;
    expect(single.end - single.start).toBe(1);
    expect(actionDateSpan("2030-01-01", "2030-01-01", single)).toMatchObject({
      point: true,
      left: 0,
      width: 0,
    });
    expect(
      goalDateAxis("2029-12-31", "2030-01-02", [])!.end -
        goalDateAxis("2029-12-31", "2030-01-02", [])!.start,
    ).toBe(2);
  });
});

describe("action order and event status", () => {
  it("sorts by start dates, with undated actions last", () => {
    const action = (title: string, startDate: string) =>
      newGoal({ ...EMPTY_GOAL, title, startDate });
    expect(
      [
        action("Undated", ""),
        action("Later", "2030-06-01"),
        action("First", "2030-01-01"),
      ]
        .sort(actionOrder)
        .map((item) => item.title),
    ).toEqual(["First", "Later", "Undated"]);
  });
  it("uses calendar status for events", () => {
    expect(eventStatus("2030-04-02", "2030-04-01")).toBe("Upcoming");
    expect(eventStatus("2030-03-31", "2030-04-01")).toBe("Passed");
    expect(eventStatus("2030-04-01", "2030-04-01")).toBe("Today");
    expect(eventStatus("", "2030-04-01")).toBe("Date not set");
  });
});
