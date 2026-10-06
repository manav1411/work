import { describe, expect, it, vi } from "vitest";
import {
  contentDataError,
  contentMatches,
  interviewPreparation,
  legacyInterviewPreparation,
  orderedRecords,
} from "../shared/content";
import type { RecordInput, RecordPatch, WorkRecord } from "../shared/model";
import { dataReferences, detachDataReferences } from "../shared/references";
import { learningSubjects, learningTopics } from "../src/features/learn/topics";
import {
  interviewTabs,
  storyMatches,
  upcomingInterviews,
} from "../src/features/interviews/domain";
import { contentRecordWriter } from "../src/features/content/recordWriter";
import { loadRoadmapStatistics } from "../src/features/learn/useLearningData";
import { DEMO_STATS } from "../src/features/learn/demo";
import { roadmapTopics } from "../src/content/problems";
import { roadmapTopics as adapterTopics } from "../src/features/learn/foundations/roadmapData";

const record = (changes: Partial<WorkRecord> = {}): WorkRecord => ({
  id: "synthetic",
  kind: "note",
  title: "Synthetic",
  body: "",
  tags: [],
  links: [],
  data: {},
  version: 1,
  createdAt: "2026-10-05T00:00:00.000Z",
  updatedAt: "2026-10-05T00:00:00.000Z",
  deletedAt: null,
  ...changes,
});

describe("private scoped learning and preparation", () => {
  it("keeps generic imported notes and other parents out of a content panel", () => {
    expect(
      contentMatches(
        record({
          data: { scope: "learn", track: "backend" },
        }),
        { scope: "learn", track: "databases" },
      ),
    ).toBe(false);
    expect(
      contentMatches(
        record({
          data: { scope: "learn", track: "databases" },
        }),
        { scope: "learn", track: "databases" },
      ),
    ).toBe(true);
    const context = {
      scope: "interviews" as const,
      tabKey: "technical" as const,
    };
    expect(
      contentMatches(
        record({ data: { collection: "Interview prep" } }),
        context,
      ),
    ).toBe(false);
    expect(
      contentMatches(
        record({ data: { category: "content-section", ...context } }),
        context,
      ),
    ).toBe(true);
    expect(
      contentMatches(
        record({ data: { scope: "interviews", tabKey: "behavioural" } }),
        context,
      ),
    ).toBe(false);
    expect(
      contentMatches(
        record({ data: { ...context, interviewId: "appointment" } }),
        context,
      ),
    ).toBe(false);
    expect(
      contentMatches(
        record({ deletedAt: "2026-10-06", data: context }),
        context,
      ),
    ).toBe(false);
  });
  it("validates context exclusivity, resource destinations, and record kinds without restricting unrelated old content", () => {
    expect(
      contentDataError("note", {
        category: "content-document",
        scope: "learn",
        track: "databases",
        migratedRecordIds: [],
        richContent: {
          version: 1,
          document: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "PostgreSQL tutorial",
                    marks: [
                      {
                        type: "link",
                        attrs: {
                          href: "https://www.postgresql.org/docs/current/tutorial.html",
                          target: "_blank",
                          rel: "noopener noreferrer",
                          class: null,
                          title: null,
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      }),
    ).toBeNull();
    expect(
      contentDataError("note", {
        category: "content-section",
        scope: "learn",
        seedId: "db-sql",
      }),
    ).toBeNull();
    expect(
      contentDataError("note", {
        category: "content-section",
        scope: "learn",
        tabKey: "technical",
      }),
    ).toMatch(/Learning content/);
    expect(
      contentDataError("note", {
        category: "content-section",
        scope: "interviews",
        tabKey: "technical",
        interviewId: "one",
      }),
    ).toMatch(/one topic/);
    expect(
      contentDataError("resource", {
        category: "content-resource",
        scope: "learn",
        seedId: "db-sql",
        url: "javascript:alert(1)",
      }),
    ).toBeTruthy();
    expect(
      contentDataError("resource", {
        category: "content-resource",
        scope: "learn",
        seedId: "db-sql",
        url: "https://secret:password@example.invalid/",
      }),
    ).toBeTruthy();
    expect(
      contentDataError("note", {
        category: "content-resource",
        scope: "learn",
        url: "https://example.invalid/",
      }),
    ).toBeTruthy();
    expect(
      contentDataError("note", {
        collection: "Imported page",
        originalMarkdown: "Preserved",
      }),
    ).toBeNull();
    expect(
      contentDataError("note", {
        category: "interview-preparation",
        interviewId: "",
        storyIds: [],
      }),
    ).toBeNull();
    expect(
      contentDataError("resource", {
        category: "profile-link",
        scope: "documents",
        url: "https://example.invalid/",
      }),
    ).toBeNull();
  });
  it("retains seeded hide/rename overrides across recalculation and keeps old custom topics", () => {
    const hide = record({
      kind: "topic",
      data: {
        category: "learn-topic",
        track: "databases",
        seedId: "db-sql",
        hidden: true,
      },
    });
    const renamed = record({
      id: "renamed",
      kind: "topic",
      title: "Concurrency readings",
      body: "My notes",
      data: { track: "databases", seedId: "db-transactions" },
    });
    const custom = record({
      id: "custom",
      kind: "topic",
      title: "Query optimisation",
      data: { track: "databases" },
    });
    expect(
      learningTopics([hide, renamed, custom], "databases").map(
        (topic) => topic.title,
      ),
    ).toEqual(["Concurrency readings", "Query optimisation"]);
    expect(
      learningTopics([hide, renamed, custom], "databases", true),
    ).toHaveLength(3);
    const hiddenTrack = record({
      kind: "topic",
      data: { category: "learn-track", seedId: "backend", hidden: true },
    });
    expect(
      learningSubjects([hiddenTrack]).some(
        (subject) => subject.id === "backend",
      ),
    ).toBe(false);
    expect(
      learningSubjects([hiddenTrack], true).some(
        (subject) => subject.id === "backend",
      ),
    ).toBe(true);
    expect(
      learningSubjects([
        record({
          kind: "topic",
          data: { category: "learn-track", seedId: "dsa", hidden: true },
        }),
      ]).some((subject) => subject.id === "dsa"),
    ).toBe(true);
  });
  it("maintains default/custom interview tabs and deterministic order without importing generic notes", () => {
    const generic = record({
      title: "Imported unrelated page",
      data: { collection: "Interview prep" },
    });
    const custom = record({
      id: "custom-tab",
      title: "System design",
      data: { category: "interview-tab", order: -1 },
    });
    const rename = record({
      id: "rename",
      title: "People interviews",
      data: { category: "interview-tab", tabKey: "behavioural" },
    });
    expect(
      interviewTabs([generic, custom, rename]).map((tab) => tab.title),
    ).toEqual(["System design", "People interviews", "Technical"]);
    expect(
      orderedRecords([record({ id: "b" }), record({ id: "a" })]).map(
        (item) => item.id,
      ),
    ).toEqual(["a", "b"]);
  });
  it("excludes cancelled/completed/invalid appointments but keeps saved preparation tied to its stable appointment", () => {
    const interview = record({
      id: "appointment",
      kind: "interview",
      data: { startsAt: "2026-10-06T00:00:00Z", status: "Scheduled" },
    });
    const cancelled = record({
      ...interview,
      id: "cancelled",
      data: { ...interview.data, status: "Cancelled" },
    });
    const completed = record({
      ...interview,
      id: "completed",
      data: { ...interview.data, status: "Completed" },
    });
    const invalid = record({
      ...interview,
      id: "invalid",
      data: { startsAt: "not-a-date" },
    });
    expect(
      upcomingInterviews(
        [interview, cancelled, completed, invalid],
        Date.parse("2026-10-05"),
      ),
    ).toEqual([interview]);
    const prep = record({
      data: {
        category: "interview-preparation",
        interviewId: "cancelled",
        storyIds: ["story"],
      },
    });
    expect(interviewPreparation([prep], cancelled)).toBe(prep);
  });
  it("exposes identifiable old STAR reflections and appointment questions/checks without claiming generic meeting notes", () => {
    const story = record({
      kind: "story",
      tags: ["ownership"],
      data: { reflection: "What I learned" },
    });
    expect(storyMatches(story, "learned", "ownership")).toBe(true);
    expect(storyMatches(story, "learned", "conflict")).toBe(false);
    expect(
      legacyInterviewPreparation(
        record({ kind: "interview", body: "Meeting address only" }),
      ),
    ).toBe("");
    expect(
      legacyInterviewPreparation(
        record({
          kind: "interview",
          data: {
            questions: "Ask about mentoring",
            reflection: "Good discussion",
            checklist: ["Read the role"],
          },
        }),
      ),
    ).toContain("- [x] Read the role");
  });
  it("includes appointment, tab, topic and STAR relations in backups and detaches references without deleting authored text", () => {
    const data = {
      category: "interview-preparation",
      interviewId: "appointment",
      applicationId: "application",
      storyIds: ["story-a", "story-b"],
      prose: "story-a is a quoted identifier",
    };
    expect(dataReferences(data).records.sort()).toEqual([
      "application",
      "appointment",
      "story-a",
      "story-b",
    ]);
    expect(
      detachDataReferences(data, new Set(["story-a"]), new Set()),
    ).toMatchObject({ storyIds: ["story-b"], prose: data.prose });
    expect(
      dataReferences({
        category: "content-section",
        scope: "interviews",
        tabId: "custom-tab",
      }).records,
    ).toEqual(["custom-tab"]);
    expect(
      dataReferences({
        category: "content-section",
        scope: "learn",
        seedId: "db-sql",
      }).records,
    ).toEqual([]);
  });
});

describe("lazy note writes and roadmap source isolation", () => {
  it("serializes intro autosave with first story selection instead of creating two preparation records", async () => {
    let stored: WorkRecord | undefined;
    const create = vi.fn(async (input: RecordInput) => {
      await Promise.resolve();
      stored = record({
        ...input,
        id: "saved-prep",
        body: input.body ?? "",
        data: input.data ?? {},
      });
      return stored;
    });
    const update = vi.fn(async (_id: string, patch: RecordPatch) => {
      stored = record({
        ...stored,
        ...patch,
        version: (stored?.version ?? 1) + 1,
      });
      return stored;
    });
    const write = contentRecordWriter({
      read: () => stored,
      input: () => ({
        kind: "note",
        title: "Preparation",
        data: {
          category: "interview-preparation",
          interviewId: "appointment",
          storyIds: [],
        },
      }),
      create,
      update,
    });
    await Promise.all([
      write({ body: "My latest notes" }),
      write({ data: { storyIds: ["story"] } }),
    ]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(stored).toMatchObject({
      body: "My latest notes",
      data: { interviewId: "appointment", storyIds: ["story"] },
    });
    update.mockRejectedValueOnce(new Error("Conflict"));
    await expect(write({ body: "Unsent edit" })).rejects.toThrow("Conflict");
    await write({ body: "Retried edit" });
    expect(stored).toMatchObject({
      body: "Retried edit",
      data: { storyIds: ["story"] },
    });
    const baseVersion = stored!.version;
    stored = record({
      ...stored,
      body: "New text from another editor",
      version: baseVersion + 1,
    });
    const calls = update.mock.calls.length;
    await expect(
      write({ body: "Stale local draft" }, baseVersion),
    ).rejects.toMatchObject({ status: 409 });
    expect(update.mock.calls.length).toBe(calls);
    expect(stored.body).toBe("New text from another editor");
  });
  it("loads only statistics for the roadmap/Home and shares one stable problem definition", async () => {
    const read = vi.fn(async () => ({
      data: DEMO_STATS,
      source: {
        fetchedAt: "2026-10-05T00:00:00Z",
        stale: true,
        error: "Cached",
      },
    }));
    expect(await loadRoadmapStatistics(read)).toMatchObject({
      data: DEMO_STATS,
      source: { stale: true },
    });
    expect(read.mock.calls).toEqual([["/api/learning/stats"]]);
    expect(adapterTopics).toBe(roadmapTopics);
    expect(
      new Set(
        roadmapTopics.flatMap((topic) =>
          topic.problems.map((problem) => problem.slug),
        ),
      ).size,
    ).toBe(150);
  });
});
