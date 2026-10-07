import { afterEach, expect, it, vi } from "vitest";
import { createDemoStore } from "../src/lib/demo";
import { recordDataError } from "../shared/record-contract";
import type { LatexProject } from "../shared/latex";
import type { Attachment } from "../shared/model";
import { learningStatsSchema } from "../shared/learning";
import { DEMO_STATS } from "../src/features/learn/demo";
import { todayAestMidnight } from "../src/features/learn/foundations/leetcodeMetrics";

afterEach(() => vi.unstubAllGlobals());

it("seeds a valid populated demo with native PDF documents and connected preparation", async () => {
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => {} });
  const demo = createDemoStore();
  const records = demo.getRecords();
  for (const record of records)
    expect(recordDataError(record.kind, record.data)).toBeNull();
  expect(
    records.filter((record) => record.kind === "application"),
  ).toHaveLength(5);
  expect(
    records
      .filter((record) => record.kind === "story")
      .every((record) =>
        ["situation", "task", "action", "result", "lessons"].every(
          (key) => typeof record.data[key] === "string" && record.data[key],
        ),
      ),
  ).toBe(true);
  expect(
    records.some(
      (record) =>
        record.title === "My next direction" ||
        record.title === "A challenge I solved",
    ),
  ).toBe(false);
  const natives = records.filter((record) => record.data.nativeDocument);
  expect(
    natives.filter((record) => record.data.type === "resume"),
  ).toHaveLength(2);
  expect(
    natives.filter((record) => record.data.type === "letter"),
  ).toHaveLength(1);
  for (const record of natives) {
    const response = (await demo.adapter(`/api/latex/${record.id}`)) as {
      project: LatexProject;
    };
    const job = response.project.latestSuccessfulJob!;
    expect(job.status).toBe("succeeded");
    expect(job.pdfUrl).toMatch(/^data:application\/pdf;base64,/);
    const files = (await demo.adapter(
      `/api/records/${record.id}/attachments`,
    )) as { attachments: Attachment[] };
    expect(files.attachments.map((file) => file.id)).toContain(
      job.pdfAttachmentId,
    );
    expect(
      atob((await demo.fileUrl(job.pdfAttachmentId!)).split(",")[1]),
    ).toContain("Alex Morgan");
  }
  const preparation = records.find(
    (record) => record.data.category === "interview-preparation",
  )!;
  expect(
    records.some((record) => record.id === preparation.data.interviewId),
  ).toBe(true);
  expect(
    (preparation.data.storyIds as string[]).every((id) =>
      records.some((record) => record.id === id && record.kind === "story"),
    ),
  ).toBe(true);
  expect(
    records.filter((record) => record.data.scope === "learn"),
  ).toHaveLength(7);
});

it("keeps demo learning totals and recent activity consistent with its calendar", () => {
  expect(learningStatsSchema.safeParse(DEMO_STATS).success).toBe(true);
  expect(
    DEMO_STATS.solvedDays![String(todayAestMidnight())].length,
  ).toBeGreaterThan(0);
  const total = Object.values(DEMO_STATS.solvedDays!).flat().length;
  expect(
    DEMO_STATS.solved.find((item) => item.difficulty === "All")!.count,
  ).toBe(total);
  expect(
    DEMO_STATS.solved
      .filter((item) => item.difficulty !== "All")
      .reduce((sum, item) => sum + item.count, 0),
  ).toBe(total);
});
