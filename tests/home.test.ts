import { describe, expect, it } from "vitest";
import { recordUrl, type WorkRecord } from "../shared/model";
import {
  EMPTY_GOAL,
  goalInputSchema,
  goalProgress,
  newGoal,
  sourceCheckpointHistory,
} from "../shared/goals";
import {
  timelineItems,
  windowItems,
  timelineLayout,
  dayDistance,
} from "../src/features/home/timeline";
import { remapReference } from "../src/lib/outbox";
function record(
  kind: WorkRecord["kind"],
  data: WorkRecord["data"] = {},
): WorkRecord {
  return {
    id: crypto.randomUUID(),
    kind,
    title: "Synthetic record",
    body: "",
    tags: [],
    links: [],
    data,
    version: 1,
    createdAt: "2026-10-02T00:00:00Z",
    updatedAt: "2026-10-02T00:00:00Z",
    deletedAt: null,
  };
}
describe("factual timeline and goal progress", () => {
  it("keeps date-only deadlines independent of timezone and uses local interview days", () => {
    const deadline = record("application", { deadline: "2026-10-04" });
    const interview = record("interview", {
      startsAt: "2026-10-04T00:30:00Z",
      status: "Scheduled",
    });
    const items = timelineItems(
      [deadline, interview],
      [],
      "America/Los_Angeles",
      "2026-10-01",
    );
    expect(items.find((item) => item.record?.id === deadline.id)?.date).toBe(
      "2026-10-04",
    );
    expect(items.find((item) => item.record?.id === interview.id)?.date).toBe(
      "2026-10-03",
    );
  });
  it("orders same-day appointments by actual time, hides upcoming cancellations and preserves cancelled history", () => {
    const later = record("interview", { startsAt: "2026-10-04T04:00:00Z" });
    const earlier = record("interview", { startsAt: "2026-10-04T01:00:00Z" });
    const cancelled = record("interview", {
      startsAt: "2026-10-03T01:00:00Z",
      status: "Cancelled",
    });
    const future = record("interview", {
      startsAt: "2026-10-05T01:00:00Z",
      status: "Cancelled",
    });
    const items = timelineItems(
      [later, earlier, cancelled, future],
      [],
      "UTC",
      "2026-10-04",
    );
    expect(items.map((item) => item.record?.id)).toEqual([
      cancelled.id,
      earlier.id,
      later.id,
    ]);
    expect(items[0].detail).toContain("Cancelled");
    expect(items.every((item) => !item.completed)).toBe(true);
  });
  it("never turns elapsed time or a completion label into measured progress", () => {
    const goal = newGoal({
      ...EMPTY_GOAL,
      title: "A goal",
      measure: "manual",
      value: 2,
      target: 10,
      status: "completed",
      targetDate: "2020-01-01",
    });
    expect(goalProgress(goal)).toMatchObject({
      value: 2,
      target: 10,
      percent: 20,
      complete: true,
    });
    const milestoneGoal = newGoal({
      ...EMPTY_GOAL,
      title: "Milestones",
      measure: "milestones",
      status: "completed",
      milestones: [
        {
          id: crypto.randomUUID(),
          title: "A",
          date: "",
          done: true,
          completedAt: null,
        },
        {
          id: crypto.randomUUID(),
          title: "B",
          date: "",
          done: false,
          completedAt: null,
        },
      ],
    });
    expect(goalProgress(milestoneGoal)).toMatchObject({
      value: 1,
      target: 2,
      percent: 50,
    });
  });
  it("uses confirmed measurements, clamps bars, and ignores removed goals", () => {
    const goal = newGoal({
      ...EMPTY_GOAL,
      title: "Problems",
      measure: "problems",
      target: 5,
      value: 1,
    });
    expect(goalProgress(goal, 8)).toMatchObject({
      value: 8,
      target: 5,
      percent: 100,
    });
    expect(
      timelineItems(
        [],
        [
          {
            ...goal,
            targetDate: "2026-10-04",
            deletedAt: "2026-10-03T00:00:00Z",
          },
        ],
        "UTC",
      ),
    ).toEqual([]);
  });
  it("derives unique events from sources, including actual progress and milestones", () => {
    const goal = newGoal({
      ...EMPTY_GOAL,
      title: "Project",
      targetDate: "2026-10-20",
      measure: "milestones",
      milestones: [
        {
          id: crypto.randomUUID(),
          title: "Release",
          date: "2026-10-20",
          done: true,
          completedAt: "2026-10-19T23:30:00Z",
        },
      ],
    });
    goal.checkpoints = [{ value: 1, at: "2026-10-19T23:30:00Z" }];
    const items = timelineItems([], [goal], "Australia/Melbourne");
    expect(items).toHaveLength(3);
    expect(new Set(items.map((item) => item.id)).size).toBe(3);
    expect(items.every((item) => item.date === "2026-10-20")).toBe(true);
    expect(windowItems(items, "2026-10-01", "2026-10-10")).toEqual([]);
  });
  it("keeps overlapping cards within the viewport and stacks collisions", () => {
    const items = timelineItems(
      [
        record("application", { deadline: "2026-10-20" }),
        record("application", { deadline: "2026-10-20" }),
        record("application", { deadline: "2026-10-20" }),
      ],
      [],
      "UTC",
    );
    const layout = timelineLayout(items, "2026-10-01", "2026-10-20", 700);
    expect(layout.map((item) => item.lane)).toEqual([0, 1, 2]);
    expect(new Set(layout.map((item) => item.markerX)).size).toBe(3);
    expect(layout.every((item) => item.markerX >= 6 && item.markerX <= 694)).toBe(
      true,
    );
    expect(
      layout.every(
        (item) => item.left >= 0 && item.left + item.cardWidth <= 700,
      ),
    ).toBe(true);
    expect(dayDistance("2026-10-03", "2026-10-05")).toBe(2);
  });
  it("keeps daily progress readable while retaining the complete source history", () => {
    const goal = newGoal({
      ...EMPTY_GOAL,
      title: "Problems",
      measure: "problems",
      scope: "arrays",
      value: 2,
    });
    goal.checkpoints = [
      {
        value: 1,
        at: "2026-10-04T01:00:00Z",
        measure: "problems",
        scope: "arrays",
      },
      {
        value: 2,
        at: "2026-10-04T02:00:00Z",
        measure: "problems",
        scope: "arrays",
      },
      {
        value: 3,
        at: "2026-10-05T01:00:00Z",
        measure: "problems",
        scope: "arrays",
      },
    ];
    expect(timelineItems([], [goal], "UTC").map((item) => item.detail)).toEqual(
      ["2", "3"],
    );
    expect(goal.checkpoints).toHaveLength(3);
    expect(
      sourceCheckpointHistory(goal, { value: 4, at: "2026-10-04T03:00:00Z" }),
    ).toBeNull();
    const changedScope = { ...goal, scope: "graphs" };
    expect(
      sourceCheckpointHistory(changedScope, {
        value: 4,
        at: "2026-10-04T03:00:00Z",
      })?.at(-1),
    ).toMatchObject({ value: 4, scope: "graphs" });
  });
  it("routes current records to their contextual pages and retired records to recovery", () => {
    const interview = record("interview"),
      note = record("note"),
      attempt = record("practice", { problemSlug: "two-sum" });
    expect(recordUrl(interview)).toBe(
      `/applications?interview=${interview.id}`,
    );
    expect(recordUrl(note)).toBe(
      `/settings?legacy=note&record=${note.id}#recovery`,
    );
    expect(recordUrl(attempt)).toBe("/learn?view=roadmap&problem=two-sum");
    expect(
      recordUrl(
        record("asset", {
          type: "resume",
          sourceUrl: "https://overleaf.com/project/example",
        }),
      ),
    ).toMatch(/^\/documents\?record=/);
  });
  it("rejects impossible dates, inverted goal ranges and unsafe sources", () => {
    expect(
      goalInputSchema.safeParse({
        ...EMPTY_GOAL,
        title: "X",
        targetDate: "2026-02-30",
      }).success,
    ).toBe(false);
    expect(
      goalInputSchema.safeParse({
        ...EMPTY_GOAL,
        title: "X",
        targetDate: "2026-10-01",
        startDate: "2026-10-02",
      }).success,
    ).toBe(false);
    expect(
      goalInputSchema.safeParse({
        ...EMPTY_GOAL,
        title: "X",
        sourceUrl: "javascript:alert(1)",
      }).success,
    ).toBe(false);
  });
});
describe("offline record graph acknowledgement", () => {
  it("rewrites nested references and deep links without rewriting ordinary prose", () => {
    const value = {
      recordId: "offline-123",
      input: {
        links: ["offline-123"],
        data: {
          actionId: "offline-123",
          assetVersions: [{ assetId: "offline-123" }],
        },
        body: "[note](/notes?record=offline-123) but ordinary text offline-123 stays",
      },
    };
    expect(remapReference(value, "offline-123", "server-456")).toEqual({
      recordId: "server-456",
      input: {
        links: ["server-456"],
        data: {
          actionId: "server-456",
          assetVersions: [{ assetId: "server-456" }],
        },
        body: "[note](/notes?record=server-456) but ordinary text offline-123 stays",
      },
    });
    expect(value.recordId).toBe("offline-123");
  });
});
