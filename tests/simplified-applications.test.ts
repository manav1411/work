import { describe, expect, it } from "vitest";
import type { WorkRecord } from "../shared/model";
import {
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

describe("document families", () => {
  it("selects the existing résumé and legacy letter without changing their content", () => {
    const resume = record({
      id: "resume",
      body: "Submitted text",
      data: { type: "resume", primaryAttachmentId: "pdf" },
    });
    const letter = record({ id: "letter", data: { type: "cover-letter" } });
    expect(getDocumentLinks([resume, letter])).toEqual({
      resume: { record: resume },
      coverLetter: { record: letter },
    });
    expect(resume.body).toBe("Submitted text");
    expect(resume.data.primaryAttachmentId).toBe("pdf");
  });
  it("prefers native projects and ignores the retired main designation", () => {
    const uploaded = record({
      id: "uploaded",
      updatedAt: "2026-10-02T00:00:00Z",
      data: {
        type: "resume",
        documentDefault: true,
        primaryAttachmentId: "pdf",
      },
    });
    const variant = record({
      id: "variant",
      data: { type: "resume", latexProject: { revisionId: "source" } },
    });
    expect(getDocumentLinks([variant, uploaded]).resume).toEqual({
      record: variant,
    });
    expect(getDocumentLinks([uploaded, variant]).resume).toEqual({
      record: variant,
    });
    expect(getDocumentLinks([])).toEqual({ resume: {}, coverLetter: {} });
  });
  it("ignores deleted and unrelated records and retains safe generic profile destinations", () => {
    expect(
      getDocumentLinks([
        record({ deletedAt: "2026-10-01", data: { type: "resume" } }),
        record({ data: { type: "profile" } }),
      ]).resume,
    ).toEqual({});
    expect(webDestination("javascript:alert(1)")).toBe("");
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
