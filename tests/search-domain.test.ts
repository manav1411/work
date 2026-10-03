import { describe, expect, it } from "vitest";
import {
  applicationCSV,
  captureAssetVersion,
  checklistFromText,
  csvCell,
  stageHistory,
  transitionApplication,
} from "../src/features/search/domain";
import type { WorkRecord } from "../shared/model";

const record = (changes: Partial<WorkRecord> = {}): WorkRecord => ({
  id: "record-1",
  kind: "application",
  title: "Software engineer",
  body: "",
  tags: [],
  links: [],
  data: { stage: "Saved" },
  version: 1,
  createdAt: "2026-10-02T00:00:00Z",
  updatedAt: "2026-10-02T00:00:00Z",
  deletedAt: null,
  ...changes,
});

describe("application records", () => {
  it("persists a stage event and submission date together without mutating the original", () => {
    const original = record();
    const next = transitionApplication(
      original,
      "Applied",
      "2026-12-01T09:00:00Z",
    );
    expect(next).toMatchObject({
      stage: "Applied",
      submittedAt: "2026-12-01",
      history: [
        { stage: "Applied", previous: "Saved", at: "2026-12-01T09:00:00Z" },
      ],
    });
    expect(original.data).toEqual({ stage: "Saved" });
    expect(transitionApplication(record({ data: next }), "Applied")).toBe(next);
    expect(
      transitionApplication(
        record({ data: next }),
        "Interview",
        "2026-12-05T09:00:00Z",
      ).submittedAt,
    ).toBe("2026-12-01");
  });
  it("captures the submitted asset body and version independently of later edits", () => {
    const asset = record({
      id: "resume",
      kind: "asset",
      title: "Backend résumé",
      body: "Actual experience",
      version: 4,
      data: { versionLabel: "December" },
    });
    const snapshot = captureAssetVersion(asset, "2026-12-01T00:00:00Z");
    asset.body = "Later edit";
    asset.version = 5;
    expect(snapshot).toMatchObject({
      assetId: "resume",
      version: 4,
      label: "December",
      body: "Actual experience",
    });
  });
  it("uses authoritative server transitions without duplicating the initial captured stage", () => {
    expect(
      stageHistory({
        history: [
          { previous: "", stage: "Saved", at: "one" },
          { previous: "Saved", stage: "Applied", at: "client" },
        ],
        stageHistory: [{ from: "Saved", to: "Applied", at: "server" }],
      }),
    ).toEqual([
      { previous: "", stage: "Saved", at: "one" },
      { previous: "Saved", stage: "Applied", at: "server" },
    ]);
  });
  it("retains preparation completion when other checklist lines change", () => {
    expect(
      checklistFromText("Read job description\nExplain project", [
        { id: "old", text: "Read job description", done: true },
      ]),
    ).toMatchObject([
      { id: "old", done: true },
      { text: "Explain project", done: false },
    ]);
  });
  it("escapes CSV fields and prevents spreadsheet formula execution", () => {
    expect(csvCell('=HYPERLINK("evil")')).toBe('"\'=HYPERLINK(""evil"")"');
    expect(csvCell("\t=SUM(1,2)")).toBe('"\'\t=SUM(1,2)"');
    expect(csvCell('hello, "world"')).toBe('"hello, ""world"""');
    const output = applicationCSV(
      [
        record({
          data: {
            stage: "Applied",
            deadline: "2026-12-01",
            companyId: "company",
          },
        }),
      ],
      [record({ id: "company", kind: "company", title: "Example company" })],
    );
    expect(output).toContain('"Example company","Applied"');
    expect(output).toContain('"2026-12-01"');
  });
});
