import { z } from "zod";
import { field, type RecordData, type WorkRecord } from "./model";

export const APPLICATION_STATUSES = [
  "Saved",
  "Applied",
  "In progress",
  "Offer",
  "Accepted",
  "Rejected",
  "Withdrawn",
] as const;
export const STEP_STATES = [
  "Planned",
  "Current",
  "Completed",
  "Skipped",
  "Cancelled",
] as const;
export const STEP_KINDS = [
  "submission",
  "assessment",
  "interview",
  "offer",
  "other",
] as const;
export const APPOINTMENT_STATUSES = [
  "Scheduled",
  "Completed",
  "Cancelled",
  "Rescheduling",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export type StepState = (typeof STEP_STATES)[number];

export function validDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
export function validWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
const optionalDate = z
  .string()
  .refine(
    (value) => !value || validDateOnly(value),
    "Use a valid date in YYYY-MM-DD format.",
  );
const optionalUrl = z
  .string()
  .max(2048)
  .refine(
    (value) => !value || validWebUrl(value),
    "Use an http or https URL without embedded credentials.",
  );
export const RecruitmentStepSchema = z.object({
  id: z.string().min(1).max(120),
  title: z.string().trim().min(1).max(240),
  kind: z.enum(STEP_KINDS),
  state: z.enum(STEP_STATES),
  date: optionalDate.default(""),
  archived: z.boolean().optional(),
});
export type RecruitmentStep = z.infer<typeof RecruitmentStepSchema>;
export const RecruitmentStepsSchema = z
  .array(RecruitmentStepSchema)
  .max(80)
  .superRefine((steps, context) => {
    if (new Set(steps.map((step) => step.id)).size !== steps.length)
      context.addIssue({
        code: "custom",
        message: "Recruitment step IDs must be unique.",
      });
    if (
      steps.filter((step) => !step.archived && step.state === "Current")
        .length > 1
    )
      context.addIssue({
        code: "custom",
        message: "Choose only one current recruitment step.",
      });
  });
export const ApplicationDataSchema = z
  .object({
    applicationStatus: z.enum(APPLICATION_STATUSES).optional(),
    applicationDate: optionalDate.optional(),
    recruitmentSteps: RecruitmentStepsSchema.optional(),
    company: z.string().max(240).optional(),
    companyId: z.string().max(120).optional(),
    url: optionalUrl.optional(),
    location: z.string().max(1000).optional(),
    deadline: optionalDate.optional(),
    followUp: optionalDate.optional(),
  })
  .passthrough()
  .superRefine((data, context) => {
    if (data.applicationStatus === "Saved" && data.applicationDate)
      context.addIssue({
        code: "custom",
        message: "A submitted application must use Applied or a later status.",
      });
    if (!data.applicationStatus || !data.recruitmentSteps) return;
    const current = data.recruitmentSteps.find(
      (step) => !step.archived && step.state === "Current",
    );
    const hasProcess = data.recruitmentSteps.some((step) => !step.archived);
    const completedRound = data.recruitmentSteps.some(
      (step) =>
        !step.archived &&
        !["submission", "offer"].includes(step.kind) &&
        step.state === "Completed",
    );
    if (["Saved", "Applied"].includes(data.applicationStatus) && completedRound)
      context.addIssue({
        code: "custom",
        message:
          "Completed recruitment rounds use In progress. Reset those rounds before moving the application back.",
      });
    if (
      (["Saved", "Applied"].includes(data.applicationStatus) &&
        current &&
        current.kind !== "submission") ||
      (data.applicationStatus === "In progress" &&
        hasProcess &&
        ((!current && !completedRound) ||
          (current && ["submission", "offer"].includes(current.kind)))) ||
      (data.applicationStatus === "Offer" &&
        hasProcess &&
        current?.kind !== "offer")
    )
      context.addIssue({
        code: "custom",
        message: "Choose a current step that matches the application status.",
      });
  });
export const RadarCompanyDataSchema = z
  .object({
    radar: z.boolean().optional(),
    website: optionalUrl.optional(),
    careersUrl: optionalUrl.optional(),
    location: z.string().max(1000).optional(),
    reason: z.string().max(10000).optional(),
    reviewDate: optionalDate.optional(),
  })
  .passthrough();
export const InterviewAppointmentDataSchema = z
  .object({
    applicationId: z.string().max(120).optional(),
    stepId: z.string().max(120).optional(),
    startsAt: z.iso.datetime({ offset: true }).optional(),
    timezone: z
      .string()
      .max(80)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en-AU", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Use a valid IANA timezone.")
      .optional(),
    status: z.enum(APPOINTMENT_STATUSES).optional(),
    meetingUrl: optionalUrl.optional(),
    sourceUrl: optionalUrl.optional(),
  })
  .passthrough()
  .superRefine((data, context) => {
    if (data.stepId && !data.applicationId)
      context.addIssue({
        code: "custom",
        message: "A recruitment step needs an application.",
      });
  });

/** Old history and stage labels are preserved. Only unambiguous labels map to a broad status. */
export function applicationStatus(record: WorkRecord): ApplicationStatus {
  const explicit = field(record, "applicationStatus");
  if (APPLICATION_STATUSES.includes(explicit as ApplicationStatus))
    return explicit as ApplicationStatus;
  const stage = field(record, "stage", "Saved");
  if (APPLICATION_STATUSES.includes(stage as ApplicationStatus))
    return stage as ApplicationStatus;
  if (["Assessment", "Interview"].includes(stage)) return "In progress";
  return field(record, "submittedAt") || field(record, "applicationDate")
    ? "Applied"
    : "Saved";
}
export function legacyApplicationStage(record: WorkRecord): string {
  const stage = field(record, "stage");
  return stage && !APPLICATION_STATUSES.includes(stage as ApplicationStatus)
    ? stage
    : "";
}
export function applicationDate(record: WorkRecord): string {
  return typeof record.data.applicationDate === "string"
    ? record.data.applicationDate
    : field(record, "submittedAt");
}
export function recruitmentSteps(
  data: RecordData,
  includeArchived = false,
): RecruitmentStep[] {
  if (!Array.isArray(data.recruitmentSteps)) return [];
  return data.recruitmentSteps.flatMap((value) => {
    const result = RecruitmentStepSchema.safeParse(value);
    return result.success && (includeArchived || !result.data.archived)
      ? [result.data]
      : [];
  });
}
export function currentRecruitmentStep(
  record: WorkRecord,
): RecruitmentStep | undefined {
  return recruitmentSteps(record.data).find((step) => step.state === "Current");
}
const terminal = (status: ApplicationStatus) =>
  ["Accepted", "Rejected", "Withdrawn"].includes(status);

export function setApplicationStatus(
  record: WorkRecord,
  status: ApplicationStatus,
  currentStepId = "",
  day = new Date().toISOString().slice(0, 10),
): RecordData {
  let steps = recruitmentSteps(record.data, true);
  if (!terminal(status))
    steps = steps.map((step) => ({
      ...step,
      state:
        !step.archived && step.state === "Current" ? "Planned" : step.state,
    }));
  const active = steps.filter((step) => !step.archived);
  if (["In progress", "Offer"].includes(status) && active.length) {
    const chosen = active.find((step) => step.id === currentStepId);
    const awaitingNext =
      status === "In progress" &&
      !currentStepId &&
      active.some(
        (step) =>
          !["submission", "offer"].includes(step.kind) &&
          step.state === "Completed",
      );
    if (
      !awaitingNext &&
      (!chosen ||
        (status === "Offer"
          ? chosen.kind !== "offer"
          : ["submission", "offer"].includes(chosen.kind)))
    )
      throw new Error(
        status === "Offer"
          ? "Choose an offer step or add one to the process."
          : "Choose a current assessment, interview, or other step.",
      );
    if (chosen)
      steps = steps.map((step) =>
        step.id === chosen.id ? { ...step, state: "Current" } : step,
      );
  }
  if (status === "Applied")
    steps = steps.map((step) =>
      !step.archived && step.kind === "submission"
        ? { ...step, state: "Completed" }
        : step,
    );
  if (status === "Saved")
    steps = steps.map((step) =>
      !step.archived && step.kind === "submission" && step.state === "Completed"
        ? { ...step, state: "Planned" }
        : step,
    );
  return {
    ...record.data,
    applicationStatus: status,
    applicationDate:
      status === "Saved"
        ? ""
        : status === "Applied"
          ? applicationDate(record) || day
          : applicationDate(record),
    recruitmentSteps: steps,
  };
}

/** Changing a round is explicit. Neither appointment creation nor completion calls this. */
export function changeRecruitmentStep(
  record: WorkRecord,
  stepId: string,
  state: StepState,
  day = new Date().toISOString().slice(0, 10),
): RecordData {
  const existing = recruitmentSteps(record.data, true);
  const target = existing.find((step) => step.id === stepId && !step.archived);
  if (!target) throw new Error("This recruitment step no longer exists.");
  const steps = existing.map((step) =>
    step.id === stepId
      ? { ...step, state }
      : state === "Current" && !step.archived && step.state === "Current"
        ? { ...step, state: "Planned" as const }
        : step,
  );
  const current = steps.find(
    (step) => !step.archived && step.state === "Current",
  );
  const previous = applicationStatus(record);
  let status: ApplicationStatus = previous;
  if (!terminal(previous)) {
    if (current && current.kind !== "submission")
      status = current.kind === "offer" ? "Offer" : "In progress";
    else if (
      steps.some(
        (step) =>
          !step.archived &&
          !["submission", "offer"].includes(step.kind) &&
          step.state === "Completed",
      )
    )
      status = "In progress";
    else if (target.kind === "submission" && state === "Completed")
      status = "Applied";
    else
      status =
        applicationDate(record) ||
        steps.some(
          (step) =>
            !step.archived &&
            step.kind === "submission" &&
            step.state === "Completed",
        )
          ? "Applied"
          : "Saved";
  }
  return {
    ...record.data,
    recruitmentSteps: steps,
    applicationStatus: status,
    applicationDate:
      target.kind === "submission" && state === "Completed"
        ? applicationDate(record) || day
        : applicationDate(record),
  };
}

/** Archiving retains stable membership so appointment notes and preparation never disappear. */
export function archiveRecruitmentStep(
  record: WorkRecord,
  stepId: string,
): RecordData {
  const data = changeRecruitmentStep(record, stepId, "Cancelled");
  const steps = recruitmentSteps(data, true).map((step) =>
    step.id === stepId ? { ...step, archived: true } : step,
  );
  return { ...data, recruitmentSteps: steps };
}
export function commonRecruitmentProcess(): RecruitmentStep[] {
  return [
    ["Application", "submission"],
    ["Online assessment", "assessment"],
    ["Behavioural interview", "interview"],
    ["Technical interview", "interview"],
    ["Offer", "offer"],
  ].map(([title, kind]) => ({
    id: crypto.randomUUID(),
    title,
    kind: kind as RecruitmentStep["kind"],
    state: "Planned",
    date: "",
  }));
}

/** Restore uses this same map for steps and their appointment references. */
export function remapRecruitmentSteps(
  data: RecordData,
  stepIds: ReadonlyMap<string, string>,
): RecordData {
  const steps = recruitmentSteps(data, true);
  return {
    ...data,
    ...(Array.isArray(data.recruitmentSteps)
      ? {
          recruitmentSteps: steps.map((step) => ({
            ...step,
            id: stepIds.get(step.id) || step.id,
          })),
        }
      : {}),
    ...(typeof data.stepId === "string" && data.stepId
      ? { stepId: stepIds.get(data.stepId) || data.stepId }
      : {}),
  };
}
