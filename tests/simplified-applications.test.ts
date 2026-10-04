import { describe, expect, it } from "vitest";
import type { WorkRecord } from "../shared/model";
import {
  documentUrl,
  getDocumentLinks,
  webDestination,
} from "../src/features/assets/documentLinks";
import {
  applicationCompany,
  applicationContact,
  associatedInterviews,
  nextScheduledDate,
} from "../src/features/search/applicationRecords";

const record = (input: Partial<WorkRecord>): WorkRecord => ({
  id: "record",
  kind: "asset",
  title: "Document",
  body: "",
  tags: [],
  links: [],
  data: {},
  version: 1,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  deletedAt: null,
  ...input,
});

describe("document destinations", () => {
  it("reads existing résumé and letter links without changing legacy content", () => {
    const resume = record({
      id: "resume",
      body: "Submitted text",
      data: {
        type: "resume",
        overleaf: "https://www.overleaf.com/project/resume",
        primaryAttachmentId: "pdf",
      },
    });
    const letter = record({
      id: "letter",
      data: {
        type: "cover-letter",
        sourceUrl: "https://www.overleaf.com/read/letter",
      },
    });
    expect(getDocumentLinks([resume, letter], { overleaf: "" })).toEqual({
      resume: {
        url: "https://www.overleaf.com/project/resume",
        record: resume,
      },
      coverLetter: {
        url: "https://www.overleaf.com/read/letter",
        record: letter,
      },
    });
    expect(resume.body).toBe("Submitted text");
    expect(resume.data.primaryAttachmentId).toBe("pdf");
  });
  it("uses an existing preference only for the résumé and honours a cleared default", () => {
    const preferences = { overleaf: "https://www.overleaf.com/project/resume" };
    expect(getDocumentLinks([], preferences)).toEqual({
      resume: { url: preferences.overleaf },
      coverLetter: { url: "" },
    });
    const cleared = record({
      data: {
        type: "resume",
        sourceUrl: "",
        overleaf: "",
        documentDefault: true,
      },
    });
    const older = record({
      id: "older",
      data: { type: "resume", overleaf: preferences.overleaf },
    });
    expect(getDocumentLinks([older, cleared], preferences).resume).toEqual({
      record: cleared,
      url: "",
    });
  });
  it("ignores deleted or unrelated records and rejects unsafe or ambiguous destinations", () => {
    expect(
      getDocumentLinks(
        [
          record({
            deletedAt: "2026-10-01",
            data: {
              type: "resume",
              overleaf: "https://www.overleaf.com/project/resume",
            },
          }),
          record({
            data: {
              type: "profile",
              overleaf: "https://www.overleaf.com/project/profile",
            },
          }),
        ],
        { overleaf: "https://www.overleaf.com" },
      ).resume.url,
    ).toBe("");
    for (const url of [
      "javascript:alert(1)",
      "http://overleaf.com/project/resume",
      "https://overleaf.com.evil.test/project/resume",
      "https://overleaf.com/project",
      "https://user:secret@overleaf.com/project/resume",
    ])
      expect(documentUrl(url)).toBe("");
    expect(webDestination("https://user:secret@example.com/meeting")).toBe("");
    expect(webDestination("https://example.com/meeting")).toBe(
      "https://example.com/meeting",
    );
  });
});

describe("application dates and associations", () => {
  it("keeps an existing application's linked contact available without a separate contact collection", () => {
    const contact = record({
      id: "recruiter",
      kind: "contact",
      title: "Recruiter",
      data: { email: "recruiter@example.com" },
    });
    expect(applicationContact(record({ links: [contact.id] }), [contact])).toBe(
      "Recruiter · recruiter@example.com",
    );
    expect(
      applicationContact(
        record({
          data: { contact: "Current recruiter", contactId: contact.id },
        }),
        [contact],
      ),
    ).toBe("Current recruiter");
    expect(
      applicationContact(record({ links: [contact.id, "other"] }), [
        contact,
        record({ id: "other", kind: "contact", title: "Other" }),
      ]),
    ).toBe("");
  });
  it("uses display company data with a backwards-compatible company-record fallback", () => {
    const company = record({
      id: "company",
      kind: "company",
      title: "Existing Company",
    });
    expect(
      applicationCompany(record({ data: { companyId: company.id } }), [
        company,
      ]),
    ).toBe("Existing Company");
    expect(
      applicationCompany(
        record({ data: { company: "Current Company", companyId: company.id } }),
        [company],
      ),
    ).toBe("Current Company");
  });
  it("links each interview once and treats an explicit application ID as authoritative", () => {
    const linked = record({
      id: "linked",
      kind: "interview",
      links: ["app"],
      data: { startsAt: "2026-10-10T00:00:00Z" },
    });
    const current = record({
      id: "current",
      kind: "interview",
      links: ["app", "previous"],
      data: { applicationId: "app", startsAt: "2026-10-09T00:00:00Z" },
    });
    const deleted = record({
      kind: "interview",
      links: ["app"],
      deletedAt: "2026-10-01",
    });
    expect(
      associatedInterviews([linked, current, deleted], "app").map(
        (item) => item.id,
      ),
    ).toEqual(["current", "linked"]);
    expect(associatedInterviews([current], "previous")).toEqual([]);
  });
  it("keeps date-only deadlines and excludes cancelled, completed, and elapsed interviews", () => {
    const app = record({
      id: "app",
      kind: "application",
      data: { deadline: "2026-10-05", followUp: "2026-10-08" },
    });
    const interviews = ["Cancelled", "Completed", "Scheduled"].map(
      (status, index) =>
        record({
          id: String(index),
          kind: "interview",
          links: ["app"],
          data: { status, startsAt: "2026-10-03T01:00:00Z" },
        }),
    );
    expect(
      nextScheduledDate(
        app,
        interviews,
        "Australia/Melbourne",
        new Date("2026-10-04T02:00:00Z"),
      ),
    ).toBe("2026-10-05");
  });
  it("includes upcoming local-day interviews whose UTC date is the previous day", () => {
    const app = record({ id: "app", kind: "application" });
    const interview = record({
      kind: "interview",
      links: ["app"],
      data: { status: "Scheduled", startsAt: "2026-12-14T23:00:00Z" },
    });
    expect(
      nextScheduledDate(
        app,
        [interview],
        "Australia/Melbourne",
        new Date("2026-12-14T22:00:00Z"),
      ),
    ).toBe("2026-12-14T23:00:00Z");
  });
});
