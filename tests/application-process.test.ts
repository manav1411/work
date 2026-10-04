import { describe, expect, it } from "vitest";
import {
  ApplicationDataSchema,
  InterviewAppointmentDataSchema,
  RecruitmentStepsSchema,
  applicationDate,
  applicationStatus,
  archiveRecruitmentStep,
  changeRecruitmentStep,
  currentRecruitmentStep,
  legacyApplicationStage,
  recruitmentSteps,
  remapRecruitmentSteps,
  setApplicationStatus,
  validDateOnly,
  type RecruitmentStep,
} from "../shared/applications";
import type { WorkRecord } from "../shared/model";
import { associatedInterviews } from "../src/features/search/applicationRecords";

const step = (
  id: string,
  kind: RecruitmentStep["kind"] = "interview",
  state: RecruitmentStep["state"] = "Planned",
): RecruitmentStep => ({ id, title: `Round ${id}`, kind, state, date: "" });
const record = (data: WorkRecord["data"] = {}): WorkRecord => ({
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
});

describe("application status and recruitment process", () => {
  it("maps only clear legacy labels without modifying historical meaning", () => {
    const history = [
      { stage: "Interview", previous: "Applied", at: "2026-10-01T00:00:00Z" },
    ];
    const old = record({
      stage: "Interview",
      history,
      stageHistory: [
        { from: "Applied", to: "Interview", at: "2026-10-01T00:00:00Z" },
      ],
      submittedAt: "2026-09-20",
    });
    expect(applicationStatus(old)).toBe("In progress");
    expect(legacyApplicationStage(old)).toBe("Interview");
    const data = setApplicationStatus(old, "Offer");
    expect(data.stage).toBe("Interview");
    expect(data.history).toBe(history);
    expect(data.stageHistory).toBe(old.data.stageHistory);
    expect(applicationDate(record(data))).toBe("2026-09-20");
    expect(applicationStatus(record({ stage: "Recruiter coffee" }))).toBe(
      "Saved",
    );
    expect(legacyApplicationStage(record({ stage: "Recruiter coffee" }))).toBe(
      "Recruiter coffee",
    );
  });
  it("uses explicit local submission dates and synchronises only the submission round", () => {
    const app = record({
      recruitmentSteps: [
        step("submit", "submission"),
        step("oa", "assessment"),
        step("tech"),
      ],
    });
    const data = setApplicationStatus(app, "Applied", "", "2026-10-05");
    expect(data.applicationDate).toBe("2026-10-05");
    expect(recruitmentSteps(data).map((item) => item.state)).toEqual([
      "Completed",
      "Planned",
      "Planned",
    ]);
    const edited = setApplicationStatus(
      record({ ...data, applicationDate: "2026-10-03" }),
      "Applied",
      "",
      "2026-10-06",
    );
    expect(edited.applicationDate).toBe("2026-10-03");
    expect(ApplicationDataSchema.safeParse(data).success).toBe(true);
  });
  it("moves current explicitly without claiming an earlier round was passed", () => {
    const app = record({
      applicationStatus: "Applied",
      applicationDate: "2026-10-03",
      recruitmentSteps: [
        step("submit", "submission", "Completed"),
        step("oa", "assessment", "Current"),
        step("tech"),
      ],
    });
    const changed = changeRecruitmentStep(app, "tech", "Current");
    expect(recruitmentSteps(changed).map((item) => item.state)).toEqual([
      "Completed",
      "Planned",
      "Current",
    ]);
    expect(applicationStatus(record(changed))).toBe("In progress");
    expect(currentRecruitmentStep(record(changed))?.id).toBe("tech");
    expect(() => setApplicationStatus(record(changed), "In progress")).toThrow(
      "Choose a current",
    );
    expect(() =>
      setApplicationStatus(record(changed), "Offer", "tech"),
    ).toThrow("Choose an offer");
  });
  it("keeps progress while waiting for a next round and terminal outcomes deliberate", () => {
    const active = record({
      applicationStatus: "In progress",
      recruitmentSteps: [
        step("tech", "interview", "Current"),
        step("offer", "offer"),
      ],
    });
    const completed = changeRecruitmentStep(active, "tech", "Completed");
    expect(applicationStatus(record(completed))).toBe("In progress");
    expect(currentRecruitmentStep(record(completed))).toBeUndefined();
    expect(ApplicationDataSchema.safeParse(completed).success).toBe(true);
    const offer = changeRecruitmentStep(record(completed), "offer", "Current");
    expect(applicationStatus(record(offer))).toBe("Offer");
    const rejected = setApplicationStatus(record(offer), "Rejected");
    expect(
      recruitmentSteps(rejected).find((item) => item.id === "offer")?.state,
    ).toBe("Current");
    expect(
      applicationStatus(
        record(changeRecruitmentStep(record(rejected), "offer", "Skipped")),
      ),
    ).toBe("Rejected");
  });
  it("does not change application or round status from appointment scheduling, completion or cancellation", () => {
    const app = record({
      applicationStatus: "Applied",
      recruitmentSteps: [step("tech")],
    });
    const appointments = ["Scheduled", "Completed", "Cancelled"].map(
      (status, index) => ({
        ...record(),
        kind: "interview" as const,
        id: `interview-${index}`,
        data: {
          applicationId: app.id,
          stepId: "tech",
          status,
          startsAt: "2026-10-06T00:00:00Z",
        },
      }),
    );
    expect(associatedInterviews(appointments, app.id)).toHaveLength(3);
    expect(applicationStatus(app)).toBe("Applied");
    expect(recruitmentSteps(app.data)[0].state).toBe("Planned");
  });
  it("retains stable appointment membership after reordering, repeated round names and removal", () => {
    const first = { ...step("first"), title: "Technical interview" };
    const second = { ...step("second"), title: "Technical interview" };
    const app = record({ recruitmentSteps: [second, first] });
    expect(recruitmentSteps(app.data).map((item) => item.id)).toEqual([
      "second",
      "first",
    ]);
    const archived = archiveRecruitmentStep(app, "first");
    expect(recruitmentSteps(archived).map((item) => item.id)).toEqual([
      "second",
    ]);
    expect(
      recruitmentSteps(archived, true).find((item) => item.id === "first")
        ?.archived,
    ).toBe(true);
    expect(
      RecruitmentStepsSchema.safeParse(archived.recruitmentSteps).success,
    ).toBe(true);
    const appointment = {
      ...record(),
      kind: "interview" as const,
      data: {
        applicationId: "app",
        stepId: "first",
        preparation: "Keep useful notes",
      },
    };
    expect(associatedInterviews([appointment], app.id)).toEqual([appointment]);
    expect(appointment.data.preparation).toBe("Keep useful notes");
  });
  it("rejects duplicate IDs, contradictory current steps, impossible dates and unsafe URLs", () => {
    expect(
      RecruitmentStepsSchema.safeParse([step("same"), step("same")]).success,
    ).toBe(false);
    expect(
      RecruitmentStepsSchema.safeParse([
        step("a", "interview", "Current"),
        step("b", "interview", "Current"),
      ]).success,
    ).toBe(false);
    expect(
      ApplicationDataSchema.safeParse({
        applicationStatus: "Applied",
        recruitmentSteps: [step("a", "interview", "Current")],
      }).success,
    ).toBe(false);
    expect(
      ApplicationDataSchema.safeParse({
        applicationStatus: "Saved",
        applicationDate: "2026-10-05",
      }).success,
    ).toBe(false);
    expect(validDateOnly("2026-02-29")).toBe(false);
    expect(validDateOnly("2028-02-29")).toBe(true);
    expect(
      ApplicationDataSchema.safeParse({ url: "https://user:pass@example.com" })
        .success,
    ).toBe(false);
    expect(
      InterviewAppointmentDataSchema.safeParse({ stepId: "round" }).success,
    ).toBe(false);
    expect(
      InterviewAppointmentDataSchema.safeParse({ timezone: "MadeUp/Timezone" })
        .success,
    ).toBe(false);
  });
  it("remaps archived and active step IDs with the same map as appointment references", () => {
    const mapping = new Map([
      ["round", "copied-round"],
      ["old", "copied-old"],
    ]);
    const copied = remapRecruitmentSteps(
      { recruitmentSteps: [step("round"), { ...step("old"), archived: true }] },
      mapping,
    );
    expect(recruitmentSteps(copied, true).map((item) => item.id)).toEqual([
      "copied-round",
      "copied-old",
    ]);
    const appointment = remapRecruitmentSteps(
      { stepId: "old", preparation: "Retained" },
      mapping,
    );
    expect(appointment).toEqual({
      stepId: "copied-old",
      preparation: "Retained",
    });
  });
});
