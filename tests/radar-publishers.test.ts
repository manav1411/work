import { describe, expect, it } from "vitest";
import { radarPublisherLinks } from "../shared/radar-publishers";
import type { RadarJob } from "../shared/radar";

const source = (
  publisher: string,
  url: string,
): RadarJob["sources"][number] => ({
  publisher,
  url,
  provider: "jsearch",
  sourceId: url,
  applyUrl: "",
  observedAt: "2026-10-17T00:00:00Z",
});
describe("Radar publisher links", () => {
  it("keeps one logo per publisher and a listing link for each different site", () => {
    expect(
      radarPublisherLinks([
        source("LinkedIn", "https://www.linkedin.com/jobs/view/1"),
        source("Linkedin jobs", "https://au.linkedin.com/jobs/view/2"),
        source("Indeed", "https://au.indeed.com/viewjob?jk=3"),
        source("Glassdoor", "https://www.glassdoor.com.au/job-listing/4"),
        source("SEEK", "https://seek.com.au/job/5"),
      ]),
    ).toEqual([
      {
        key: "linkedin",
        name: "LinkedIn",
        url: "https://www.linkedin.com/jobs/view/1",
      },
      {
        key: "indeed",
        name: "Indeed",
        url: "https://au.indeed.com/viewjob?jk=3",
      },
      {
        key: "glassdoor",
        name: "Glassdoor",
        url: "https://www.glassdoor.com.au/job-listing/4",
      },
      { key: "seek", name: "SEEK", url: "https://seek.com.au/job/5" },
    ]);
  });
  it("prefers the actual site over a mismatched publisher label", () => {
    expect(
      radarPublisherLinks([
        source("LinkedIn", "https://indeed.com/viewjob?jk=123"),
      ])[0].name,
    ).toBe("Indeed");
  });
  it("deduplicates other sites by host and ignores unsafe destinations", () => {
    expect(
      radarPublisherLinks([
        source("Job listing", "https://careers.example.com/jobs/1"),
        source("Example", "https://careers.example.com/jobs/2"),
        source("Unsafe", "javascript:alert(1)"),
        source("Unsafe", "https://user:pass@example.com/job/1"),
        source("Broken", "invalid"),
      ]),
    ).toEqual([
      {
        key: "careers.example.com",
        name: "careers.example.com",
        url: "https://careers.example.com/jobs/1",
      },
    ]);
  });
});
