import { describe, expect, it } from "vitest";
import type { WorkRecord } from "../shared/model";
import { directionDataSchema } from "../shared/direction";
import { webDestination, profileLinkDataSchema } from "../shared/documents";
import { directionNotes } from "../src/features/direction/directionAdapter";
const record = (id: string, data: WorkRecord["data"] = {}): WorkRecord => ({
  id,
  kind: "asset",
  title: id,
  body: "Authored notes",
  tags: [],
  links: [],
  data,
  version: 1,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  deletedAt: null,
});
describe("document and direction compatibility", () => {
  it("preserves authored legacy direction fields in the notes adapter without mutating the record", () => {
    const old = record("direction", {
      focus: "Security",
      priority: "High",
      nextStep: "Speak to mentor",
      status: "Committed",
      options: ["Software", "Cyber"],
    });
    const before = structuredClone(old);
    const notes = directionNotes(old);
    expect(notes).toContain("Authored notes");
    expect(notes).toContain("Security");
    expect(notes).toContain("Speak to mentor");
    expect(notes).toContain("Committed");
    expect(notes).toContain("Cyber");
    expect(old).toEqual(before);
    expect(
      directionNotes({
        ...old,
        data: {
          ...old.data,
          richContent: { version: 1, document: { type: "doc", content: [] } },
        },
      }),
    ).toBe(old.body);
  });
  it("normalizes research domains while retaining removed historical metadata", () => {
    expect(webDestination("manavdodia.com")).toBe("https://manavdodia.com/");
    expect(
      profileLinkDataSchema.parse({
        scope: "documents",
        category: "profile-link",
        url: "github.com/manav1411",
      }).url,
    ).toBe("https://github.com/manav1411");
    const data = directionDataSchema.parse({
      category: "direction",
      status: "Pursuing",
      researchLinks: ["example.com/jobs"],
      focus: "Retained historical focus",
    });
    expect(data.researchLinks).toEqual(["https://example.com/jobs"]);
    expect(data.focus).toBe("Retained historical focus");
    expect(
      directionDataSchema.safeParse({
        category: "direction",
        researchLinks: ["javascript:alert(1)"],
      }).success,
    ).toBe(false);
  });
});
