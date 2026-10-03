import { afterEach, describe, expect, it, vi } from "vitest";
import { recordUrl, type WorkRecord } from "../shared/model";
import {
  agendaItems,
  rankedActions,
  weeklyStats,
  weekStart,
} from "../src/features/home/domain";
import { remapReference } from "../src/lib/outbox";

function record(
  kind: WorkRecord["kind"],
  data: WorkRecord["data"] = {},
  createdAt = "2026-10-02T00:00:00Z",
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
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
  };
}
afterEach(() => vi.useRealTimers());
describe("useful, factual home summaries", () => {
  it("ranks pinned, urgent and time-sized actions with understandable reasons", () => {
    const pinned = record("action", { pinned: true, estimatedMinutes: 30 });
    const done = record("action", { status: "done" });
    const urgent = record("action", {
      dueDate: "2026-10-02",
      estimatedMinutes: 5,
    });
    const ranked = rankedActions([urgent, done, pinned], 5, "2026-10-02");
    expect(ranked.map((item) => item.record.id)).toEqual([
      pinned.id,
      urgent.id,
    ]);
    expect(ranked[0].reason).toContain("You pinned");
    expect(ranked[1].reason).toContain("Due today");
  });
  it("starts the week on Monday, including a Sunday across month boundaries", () => {
    expect(weekStart("2026-11-01")).toBe("2026-10-26");
  });
  it("counts actual attempt dates and ignores invalid or future dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T02:00:00Z"));
    const rows = [
      record("practice", { attemptedAt: "2026-09-10" }),
      record("practice", { attemptedAt: "2026-10-02" }),
      record("practice", {}, "2030-01-01T00:00:00Z"),
      record("application", { submittedAt: "2030-01-01" }),
      record("action", { status: "done", completedAt: "invalid" }),
      record("focus", {
        status: "completed",
        elapsedSeconds: 600,
        completedAt: "2026-09-10T00:00:00Z",
      }),
    ];
    expect(weeklyStats(rows, "Australia/Melbourne")).toMatchObject({
      practice: 1,
      applications: 0,
      actions: 0,
      minutes: 0,
    });
  });
  it("includes due learning reviews and keeps date-only deadlines unchanged", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T02:00:00Z"));
    const review = record("progress", {
      category: "problem",
      problemId: "two-sum",
      nextReview: "2026-10-03",
    });
    const application = record("application", {
      stage: "Applied",
      deadline: "2026-10-03",
    });
    const cancelled = record("interview", {
      status: "Cancelled",
      startsAt: "2026-10-03T08:00:00Z",
    });
    expect(
      agendaItems([review, application, cancelled], "America/Los_Angeles"),
    ).toHaveLength(2);
    expect(recordUrl(review)).toBe("/practice?record=two-sum");
    expect(recordUrl(record("progress", { topicId: "dsa-week-1" }))).toBe(
      "/learn?record=dsa-week-1",
    );
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
