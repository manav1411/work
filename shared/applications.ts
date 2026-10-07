import { z } from "zod";
import { field, type RecordData, type WorkRecord } from "./model";
import { normalizeWebUrl } from "./urls";

export const APPLICATION_STATUSES = [
  "Saved",
  "Applied",
  "In progress",
  "Offer",
  "Accepted",
  "Rejected",
  "Withdrawn",
] as const;
export const STEP_STATES = ["Planned", "Completed"] as const;
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
  .transform(normalizeWebUrl)
  .refine(
    (value) => !value || validWebUrl(value),
    "Use an http or https URL without embedded credentials.",
  );
export const RecruitmentStepSchema = z.object({
  id: z.string().min(1).max(120),
  title: z.string().trim().min(1).max(240),
  kind: z.enum(STEP_KINDS),
  state: z.enum(STEP_STATES),
  date: z.literal("").default(""),
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
  });
export const ApplicationDataSchema = z
  .object({
    applicationStatus: z.enum(APPLICATION_STATUSES),
    applicationDate: optionalDate.optional(),
    recruitmentSteps: RecruitmentStepsSchema,
    processVersion: z.literal(2),
    selectedStepId: z.string().max(120).optional(),
    terminalOutcome: z.enum(["Accepted", "Rejected", ""]).optional(),
    company: z.string().max(240).optional(),
    companyId: z.string().max(120).optional(),
    url: optionalUrl.optional(),
    location: z.string().max(1000).optional(),
    deadline: optionalDate.optional(),
    followUp: optionalDate.optional(),
  })
  .strict()
  .superRefine((data, context) => {
    const steps = data.recruitmentSteps || [];
    if (
      steps.length < 2 ||
      steps[0]?.kind !== "submission" ||
      steps.at(-1)?.kind !== "offer" ||
      steps.filter((step) => step.kind === "submission").length !== 1 ||
      steps.filter((step) => step.kind === "offer").length !== 1
    )
      context.addIssue({
        code: "custom",
        message: "Keep Application and Offer as the fixed process endpoints.",
      });
    let planned = false;
    for (const step of steps) {
      if (
        !STEP_STATES.includes(step.state as (typeof STEP_STATES)[number]) ||
        step.date
      )
        context.addIssue({
          code: "custom",
          message:
            "Steps use only Planned or Completed, without milestone dates.",
        });
      if (step.state === "Planned") planned = true;
      else if (planned)
        context.addIssue({
          code: "custom",
          message: "Complete recruitment steps in process order.",
        });
    }
    const selected = steps.find((step) => step.id === data.selectedStepId);
    if (
      data.selectedStepId &&
      (!selected ||
        selected.kind === "submission" ||
        selected.kind === "offer" ||
        selected.state !== "Planned" ||
        steps.find((step) => step.state === "Planned")?.id !== selected.id)
    )
      context.addIssue({
        code: "custom",
        message: "Choose the first planned assessment or interview step.",
      });
    if (
      ["Offer", "Accepted"].includes(data.applicationStatus || "") &&
      steps.some((step) => step.state !== "Completed")
    )
      context.addIssue({
        code: "custom",
        message: "An offer completes the recruitment process.",
      });
    if (data.applicationStatus === "Saved" && data.applicationDate)
      context.addIssue({
        code: "custom",
        message: "Choose Applied before recording an application date.",
      });
    if (
      data.applicationStatus === "Applied" &&
      (steps[0]?.state !== "Completed" ||
        steps.slice(1).some((step) => step.state !== "Planned") ||
        data.selectedStepId)
    )
      context.addIssue({
        code: "custom",
        message: "Applied completes only the Application step.",
      });
    if (
      ["Accepted", "Rejected"].includes(data.applicationStatus || "") &&
      data.terminalOutcome !== data.applicationStatus
    )
      context.addIssue({
        code: "custom",
        message: "Keep the terminal outcome aligned with application status.",
      });
    if (data.terminalOutcome && data.terminalOutcome !== data.applicationStatus)
      context.addIssue({
        code: "custom",
        message:
          "Change terminal outcomes explicitly using application status.",
      });
  });
export const RadarCompanyDataSchema = z
  .object({
    radar: z.boolean().optional(),
    website: optionalUrl.optional(),
    careersUrl: optionalUrl.optional(),
    location: z.string().max(1000).optional(),
    reviewDate: optionalDate.optional(),
  })
  .strict();
export const InterviewAppointmentDataSchema = z
  .object({
    appointmentVersion: z.literal(2),
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
  .strict()
  .superRefine((data, context) => {
    if (
      data.appointmentVersion === 2 &&
      (!data.applicationId || !data.stepId || !data.startsAt)
    )
      context.addIssue({
        code: "custom",
        message: "Choose an application step and a valid appointment time.",
      });
    if (data.stepId && !data.applicationId)
      context.addIssue({
        code: "custom",
        message: "A recruitment step needs an application.",
      });
  });

export function applicationStatus(record: WorkRecord): ApplicationStatus {
  return record.data.applicationStatus as ApplicationStatus;
}
export function applicationDate(record: WorkRecord): string {
  return field(record, "applicationDate");
}
export function recruitmentSteps(data: RecordData): RecruitmentStep[] {
  if (!Array.isArray(data.recruitmentSteps)) return [];
  return data.recruitmentSteps.flatMap((value) => {
    const result = RecruitmentStepSchema.safeParse(value);
    return result.success ? [result.data] : [];
  });
}
export function currentRecruitmentStep(
  record: WorkRecord,
): RecruitmentStep | undefined {
  return recruitmentSteps(record.data).find((step) => step.state === "Planned");
}
export function applicationStatusLabel(record: WorkRecord): string {
  const status = applicationStatus(record);
  if (["Accepted", "Rejected", "Withdrawn", "Saved"].includes(status))
    return status;
  if (status === "Offer") return "Offer";
  const selected = recruitmentSteps(record.data).find(
    (step) => step.id === record.data.selectedStepId,
  );
  return (
    selected?.title || (status === "In progress" ? "Awaiting offer" : "Applied")
  );
}
export function applicationStatusSelection(record: WorkRecord): string {
  return record.data.selectedStepId && !record.data.terminalOutcome
    ? `step:${String(record.data.selectedStepId)}`
    : applicationStatus(record);
}
export function applicationStatusOptions(
  record: WorkRecord,
): { value: string; label: string }[] {
  return [
    { value: "Applied", label: "Applied" },
    ...recruitmentSteps(record.data)
      .filter((step) => !["submission", "offer"].includes(step.kind))
      .map((step) => ({ value: `step:${step.id}`, label: step.title })),
    ...["Offer", "Accepted", "Rejected"].map((value) => ({
      value,
      label: value,
    })),
  ];
}

export function selectApplicationStatus(
  record: WorkRecord,
  selection: string,
  day = new Date().toISOString().slice(0, 10),
): RecordData {
  const data = record.data;
  const steps = recruitmentSteps(data);
  const active = steps;
  const targetId = selection.startsWith("step:") ? selection.slice(5) : "";
  const index = targetId
    ? active.findIndex(
        (step) =>
          step.id === targetId && !["submission", "offer"].includes(step.kind),
      )
    : -1;
  if (targetId && index < 0)
    throw new Error("Choose an existing recruitment step.");
  if (
    !targetId &&
    !["Applied", "Offer", "Accepted", "Rejected"].includes(selection)
  )
    throw new Error("Choose an application status.");
  const reached =
    selection === "Rejected"
      ? null
      : ["Offer", "Accepted"].includes(selection)
        ? active.length
        : targetId
          ? index
          : 1;
  const nextSteps = steps.map((step) =>
    reached === null
      ? step
      : {
          ...step,
          state:
            active.findIndex((item) => item.id === step.id) < reached
              ? ("Completed" as const)
              : ("Planned" as const),
          date: "",
        },
  );
  return {
    ...data,
    recruitmentSteps: nextSteps,
    applicationStatus: targetId ? "In progress" : selection,
    selectedStepId:
      selection === "Rejected" ? data.selectedStepId || "" : targetId,
    terminalOutcome: ["Accepted", "Rejected"].includes(selection)
      ? selection
      : "",
    applicationDate:
      selection === "Applied"
        ? applicationDate(record) || day
        : applicationDate(record),
  };
}
/** Changing a round is explicit. Neither appointment creation nor completion calls this. */
export function changeRecruitmentStep(
  record: WorkRecord,
  stepId: string,
  state: StepState,
  day = new Date().toISOString().slice(0, 10),
): RecordData {
  if (!STEP_STATES.includes(state as (typeof STEP_STATES)[number]))
    throw new Error("Choose Planned or Completed.");
  const steps = recruitmentSteps(record.data);
  const index = steps.findIndex((step) => step.id === stepId);
  if (index < 0) throw new Error("This recruitment step no longer exists.");
  if (
    steps[index].kind === "submission" &&
    state === "Planned" &&
    applicationStatus(record) !== "Saved"
  )
    throw new Error(
      "An applied submission remains completed. Use an explicit application status to move the process back.",
    );
  const cutoff = index + (state === "Completed" ? 1 : 0);
  const all = recruitmentSteps(record.data).map((step) => ({
    ...step,
    state:
      steps.findIndex((item) => item.id === step.id) < cutoff
        ? ("Completed" as const)
        : ("Planned" as const),
  }));
  const next = all.find((step) => step.state === "Planned");
  const terminalStatus = ["Accepted", "Rejected"].includes(
    applicationStatus(record),
  );
  if (applicationStatus(record) === "Accepted" && next)
    throw new Error("Change Accepted status before reopening process steps.");
  const submission = steps[index].kind === "submission";
  return {
    ...record.data,
    recruitmentSteps: all,
    selectedStepId:
      !submission && next && !["submission", "offer"].includes(next.kind)
        ? next.id
        : "",
    applicationStatus: terminalStatus
      ? applicationStatus(record)
      : !next
        ? "Offer"
        : submission
          ? state === "Completed"
            ? "Applied"
            : "Saved"
          : "In progress",
    applicationDate:
      state === "Completed" && submission
        ? applicationDate(record) || day
        : applicationDate(record),
  };
}
export function removeRecruitmentStep(
  record: WorkRecord,
  stepId: string,
): RecordData {
  const target = recruitmentSteps(record.data).find(
    (step) => step.id === stepId,
  );
  if (!target || ["submission", "offer"].includes(target.kind))
    throw new Error("Application and Offer are fixed endpoints.");
  const steps = recruitmentSteps(record.data).filter(
    (step) => step.id !== stepId,
  );
  const next = steps.find((step) => step.state === "Planned");
  return {
    ...record.data,
    recruitmentSteps: steps,
    selectedStepId:
      record.data.selectedStepId === stepId
        ? next && !["submission", "offer"].includes(next.kind)
          ? next.id
          : ""
        : record.data.selectedStepId,
  };
}
export function commonRecruitmentProcess(): RecruitmentStep[] {
  return [
    ["Application", "submission"],
    ["Offer", "offer"],
  ].map(([title, kind]) => ({
    id: crypto.randomUUID(),
    title,
    kind: kind as RecruitmentStep["kind"],
    state: "Planned",
    date: "",
  }));
}
