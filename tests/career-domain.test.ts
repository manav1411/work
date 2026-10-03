import { describe, expect, it } from "vitest";
import {
  blankOption,
  criteriaFromData,
  evidenceBullet,
  evidenceStory,
  milestonesFromText,
  optionsFromData,
  weightedRating,
  type RoleOption,
} from "../src/features/career/domain";
import type { WorkRecord } from "../shared/model";

describe("career comparison", () => {
  it("preserves unknown ratings and does not fabricate totals", () => {
    const criteria = [
      { id: "scope", label: "Scope", weight: 3 },
      { id: "mentor", label: "Mentoring", weight: 1 },
    ];
    const option: RoleOption = {
      ...blankOption("A real option"),
      scores: { scope: 4, mentor: null },
    };
    expect(weightedRating(option, criteria)).toBeNull();
    option.scores.mentor = 2;
    expect(weightedRating(option, criteria)).toBe(3.5);
    expect(
      weightedRating(option, [{ id: "scope", label: "Scope", weight: 0 }]),
    ).toBeNull();
  });
  it("converts earlier decision worksheets without inventing terms or scores", () => {
    const options = optionsFromData({
      options: "External role\nRoll-off role",
    });
    expect(options).toHaveLength(2);
    expect(options[0]).toMatchObject({
      title: "External role",
      base: "",
      confirmation: "Unknown",
      scores: {},
    });
    expect(
      criteriaFromData({ criteria: "Ownership\nMentorship" }).map(
        (item) => item.label,
      ),
    ).toEqual(["Ownership", "Mentorship"]);
  });
  it("keeps completed project milestones when adding the next step", () => {
    expect(
      milestonesFromText("Build prototype\nWrite case study", [
        { id: "m1", text: "Build prototype", done: true, dueDate: "" },
      ])[0].done,
    ).toBe(true);
  });
});

describe("reuse real evidence", () => {
  const evidence: WorkRecord = {
    id: "achievement",
    kind: "achievement",
    title: "Logging improvement",
    body: "Engineering details",
    tags: ["backend"],
    links: [],
    version: 1,
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
    data: {
      contribution: "Added request tracing.",
      outcome: "Made failures reproducible.",
      verified: false,
    },
  };
  it("links story and bullet back to the same evidence without invented measurements", () => {
    expect(evidenceStory(evidence).data).toMatchObject({
      action: "Added request tracing.",
      result: "Made failures reproducible.",
      situation: "",
    });
    expect(evidenceBullet(evidence)).toMatchObject({
      body: "Added request tracing. Made failures reproducible.",
      links: ["achievement"],
      data: { verified: false },
    });
  });
});
