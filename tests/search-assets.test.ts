import { describe, expect, it } from "vitest";
import {
  emptyResume,
  resumeContent,
  resumeMarkdown,
  safeFilename,
} from "../src/features/assets/domain";

describe("portable career assets", () => {
  it("exports only entered résumé information without inventing achievements", () => {
    const resume = {
      ...emptyResume(),
      name: "Test Engineer",
      skills: "Python, SQL",
      experience: [
        {
          id: "one",
          title: "Software engineer",
          organisation: "Example",
          dates: "2026",
          bullets: ["Implemented a tested endpoint."],
        },
      ],
    };
    const markdown = resumeMarkdown(resume);
    expect(markdown).toContain("### Software engineer — Example");
    expect(markdown).toContain("- Implemented a tested endpoint.");
    expect(markdown).not.toContain("## Projects");
    expect(markdown).not.toContain("increased");
  });
  it("reads imported structured data with safe defaults", () => {
    expect(
      resumeContent({
        resume: {
          name: "Engineer",
          skills: 5,
          experience: [{ title: "Developer", bullets: ["Actual work", 7] }],
        },
      }),
    ).toMatchObject({
      name: "Engineer",
      skills: "",
      experience: [
        { title: "Developer", organisation: "", bullets: ["Actual work"] },
      ],
    });
    expect(resumeContent({ resume: null })).toEqual(emptyResume());
  });
  it("uses portable filenames", () => {
    expect(safeFilename("Résumé / December 2026")).toBe("Rsum-December-2026");
  });
});
