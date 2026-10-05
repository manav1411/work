import { describe, expect, it } from "vitest";
import {
  ApplicationDataSchema,
  InterviewAppointmentDataSchema,
  applicationStatusLabel,
  archiveRecruitmentStep,
  changeRecruitmentStep,
  commonRecruitmentProcess,
  currentRecruitmentStep,
  editableApplicationData,
  recruitmentSteps,
  remapRecruitmentSteps,
  selectApplicationStatus,
} from "../shared/applications";
import type { WorkRecord } from "../shared/model";
import { zonedDateTimeToISO } from "../src/features/prepare/helpers";

function record(data: WorkRecord["data"] = {}): WorkRecord {
  return {
    id: "app",
    kind: "application",
    title: "Engineer",
    body: "",
    tags: [],
    links: [],
    data,
    version: 1,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    deletedAt: null,
  };
}
function application() {
  const endpoints = commonRecruitmentProcess();
  const steps = [
    endpoints[0],
    {
      id: "oa",
      title: "Online assessment",
      kind: "assessment" as const,
      state: "Planned" as const,
      date: "",
    },
    {
      id: "tech",
      title: "Technical interview",
      kind: "interview" as const,
      state: "Planned" as const,
      date: "",
    },
    endpoints[1],
  ];
  return record(
    selectApplicationStatus(
      record({ recruitmentSteps: steps }),
      "Applied",
      "2026-10-05",
    ),
  );
}

describe("unified application process", () => {
  it("starts with fixed endpoints and uses stable step IDs as combined status", () => {
    const app = application();
    expect(recruitmentSteps(app.data).map((step) => step.state)).toEqual([
      "Completed",
      "Planned",
      "Planned",
      "Planned",
    ]);
    expect(currentRecruitmentStep(app)?.id).toBe("oa");
    const active = record(selectApplicationStatus(app, "step:tech"));
    expect(recruitmentSteps(active.data).map((step) => step.state)).toEqual([
      "Completed",
      "Completed",
      "Planned",
      "Planned",
    ]);
    expect(applicationStatusLabel(active)).toBe("Technical interview");
    const renamed = record({
      ...active.data,
      recruitmentSteps: recruitmentSteps(active.data).map((step) =>
        step.id === "tech" ? { ...step, title: "Platform interview" } : step,
      ),
    });
    expect(renamed.data.selectedStepId).toBe("tech");
    expect(applicationStatusLabel(renamed)).toBe("Platform interview");
    expect(ApplicationDataSchema.safeParse(renamed.data).success).toBe(true);
  });
  it("advances only on explicit completion and moving backwards resets later steps", () => {
    const app = application();
    const advanced = record(changeRecruitmentStep(app, "oa", "Completed"));
    expect(currentRecruitmentStep(advanced)?.id).toBe("tech");
    expect(applicationStatusLabel(advanced)).toBe("Technical interview");
    const waiting = record(
      changeRecruitmentStep(advanced, "tech", "Completed"),
    );
    expect(currentRecruitmentStep(waiting)?.kind).toBe("offer");
    expect(applicationStatusLabel(waiting)).toBe("Awaiting offer");
    const backward = selectApplicationStatus(waiting, "step:oa");
    expect(recruitmentSteps(backward).map((step) => step.state)).toEqual([
      "Completed",
      "Planned",
      "Planned",
      "Planned",
    ]);
    expect(ApplicationDataSchema.safeParse(backward).success).toBe(true);
  });
  it("offers and acceptance complete the prefix while rejection preserves actual reached steps", () => {
    const app = record(selectApplicationStatus(application(), "step:tech"));
    const rejected = record(selectApplicationStatus(app, "Rejected"));
    expect(recruitmentSteps(rejected.data).map((step) => step.state)).toEqual(
      recruitmentSteps(app.data).map((step) => step.state),
    );
    expect(
      changeRecruitmentStep(rejected, "tech", "Completed").applicationStatus,
    ).toBe("Rejected");
    const offer = record(selectApplicationStatus(app, "Offer"));
    expect(
      recruitmentSteps(offer.data).every((step) => step.state === "Completed"),
    ).toBe(true);
    const accepted = record(selectApplicationStatus(offer, "Accepted"));
    expect(accepted.data.terminalOutcome).toBe("Accepted");
    expect(() => changeRecruitmentStep(accepted, "tech", "Planned")).toThrow(
      "Change Accepted",
    );
  });
  it("preserves saved, withdrawal and ambiguous history until explicit editing", () => {
    for (const status of ["Saved", "Withdrawn"]) {
      const old = record({
        applicationStatus: status,
        recruitmentSteps: [
          {
            id: "legacy",
            title: "Round",
            kind: "interview",
            state: "Skipped",
            date: "2026-09-01",
          },
        ],
      });
      const converted = editableApplicationData(old);
      expect(converted.applicationStatus).toBe(status);
      expect((converted.legacyProcess as { steps: unknown[] }).steps).toEqual(
        old.data.recruitmentSteps,
      );
      expect(ApplicationDataSchema.safeParse(converted).success).toBe(true);
      expect(selectApplicationStatus(old, "Rejected").applicationDate).toBe("");
    }
    const ambiguous = record({
      applicationStatus: "In progress",
      stage: "Interview",
    });
    const migrated = record(editableApplicationData(ambiguous));
    expect(applicationStatusLabel(migrated)).toBe("Interview");
    expect(
      applicationStatusLabel(
        record(selectApplicationStatus(migrated, "Applied")),
      ),
    ).toBe("Applied");
  });
  it("retains deleted step membership and remaps selected step references", () => {
    expect(
      ApplicationDataSchema.safeParse(
        archiveRecruitmentStep(application(), "oa"),
      ).success,
    ).toBe(true);
    const app = record(selectApplicationStatus(application(), "step:tech"));
    const copied = remapRecruitmentSteps(
      {
        ...app.data,
        stageHistory: [
          {
            from: "Applied",
            to: "Technical interview",
            fromStepId: "oa",
            toStepId: "tech",
            at: "2026-10-05T00:00:00Z",
          },
        ],
      },
      new Map([["tech", "copied-tech"]]),
    );
    expect(copied.selectedStepId).toBe("copied-tech");
    expect(copied.stageHistory).toMatchObject([
      { fromStepId: "oa", toStepId: "copied-tech" },
    ]);
    expect(
      recruitmentSteps(archiveRecruitmentStep(app, "tech"), true).find(
        (step) => step.id === "tech",
      )?.archived,
    ).toBe(true);
    expect(() =>
      archiveRecruitmentStep(app, recruitmentSteps(app.data)[0].id),
    ).toThrow("fixed endpoints");
  });
  it("rejects contradictory processes and requires step/time for new appointments", () => {
    const app = application();
    expect(
      ApplicationDataSchema.safeParse({
        ...app.data,
        recruitmentSteps: recruitmentSteps(app.data).map((step) =>
          step.id === "tech" ? { ...step, state: "Completed" } : step,
        ),
      }).success,
    ).toBe(false);
    expect(
      ApplicationDataSchema.safeParse({
        ...app.data,
        selectedStepId: "foreign",
      }).success,
    ).toBe(false);
    expect(
      InterviewAppointmentDataSchema.safeParse({
        appointmentVersion: 2,
        applicationId: "app",
        startsAt: "2026-10-06T01:00:00Z",
      }).success,
    ).toBe(false);
    expect(
      InterviewAppointmentDataSchema.safeParse({
        appointmentVersion: 2,
        applicationId: "app",
        stepId: "oa",
        startsAt: "2026-10-06T01:00:00Z",
        timezone: "Australia/Melbourne",
      }).success,
    ).toBe(true);
    expect(ApplicationDataSchema.parse({ url: "example.com/jobs" }).url).toBe(
      "https://example.com/jobs",
    );
  });
  it("rejects daylight-saving gaps and resolves repeated times only with explicit choice", () => {
    expect(() =>
      zonedDateTimeToISO("2026-10-04T02:30", "Australia/Melbourne"),
    ).toThrow("does not exist");
    expect(() =>
      zonedDateTimeToISO("2026-04-05T02:30", "Australia/Melbourne"),
    ).toThrow("occurs twice");
    expect(
      zonedDateTimeToISO("2026-04-05T02:30", "Australia/Melbourne", "earlier"),
    ).toBe("2026-04-04T15:30:00.000Z");
    expect(
      zonedDateTimeToISO("2026-04-05T02:30", "Australia/Melbourne", "later"),
    ).toBe("2026-04-04T16:30:00.000Z");
  });
});
