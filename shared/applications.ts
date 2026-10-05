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
const LEGACY_STEP_STATES = [
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
export type StepState = (typeof LEGACY_STEP_STATES)[number];

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
  state: z.enum(LEGACY_STEP_STATES),
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
    processVersion: z.literal(2).optional(),
    selectedStepId: z.string().max(120).optional(),
    terminalOutcome: z.enum(["Accepted", "Rejected", ""]).optional(),
    company: z.string().max(240).optional(),
    companyId: z.string().max(120).optional(),
    url: optionalUrl.optional(),
    location: z.string().max(1000).optional(),
    deadline: optionalDate.optional(),
    followUp: optionalDate.optional(),
  })
  .passthrough()
  .superRefine((data, context) => {
    if (data.processVersion === 2) {
      const steps = (data.recruitmentSteps || []).filter(
        (step) => !step.archived,
      );
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
      if (
        data.terminalOutcome &&
        data.terminalOutcome !== data.applicationStatus
      )
        context.addIssue({
          code: "custom",
          message:
            "Change terminal outcomes explicitly using application status.",
        });
      return;
    }
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
    appointmentVersion: z.literal(2).optional(),
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
  if (record.data.processVersion === 2)
    return recruitmentSteps(record.data).find(
      (step) => step.state === "Planned",
    );
  return recruitmentSteps(record.data).find((step) => step.state === "Current");
}
export function applicationStatusLabel(record: WorkRecord): string {
  if (
    typeof record.data.legacyStatusLabel === "string" &&
    record.data.legacyStatusLabel
  )
    return record.data.legacyStatusLabel;
  const status = applicationStatus(record);
  if (
    record.data.processVersion !== 2 ||
    ["Accepted", "Rejected", "Withdrawn", "Saved"].includes(status)
  )
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
  if (record.data.legacyStatusLabel) return applicationStatus(record);
  return record.data.processVersion === 2 &&
    record.data.selectedStepId &&
    !record.data.terminalOutcome
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

/** Opt-in conversion: preserve every legacy state/date before adopting the new process. */
export function editableApplicationData(record: WorkRecord): RecordData {
  if (record.data.processVersion === 2) return record.data;
  const previous = recruitmentSteps(record.data, true);
  const previousStatus = applicationStatus(record);
  const active = previous.filter((step) => !step.archived);
  const submission = {
    ...(active.find((step) => step.kind === "submission") ||
      commonRecruitmentProcess()[0]),
    title: "Application",
  };
  const offer = {
    ...(active.find((step) => step.kind === "offer") ||
      commonRecruitmentProcess()[1]),
    title: "Offer",
  };
  let planned = false;
  const steps = [
    submission,
    ...active.filter((step) => !["submission", "offer"].includes(step.kind)),
    offer,
  ].map((step) => {
    if (
      step.kind === "submission" &&
      !["Saved", "Withdrawn"].includes(previousStatus)
    )
      step = { ...step, state: "Completed" };
    if (["Offer", "Accepted"].includes(previousStatus))
      step = { ...step, state: "Completed" };
    if (step.state !== "Completed") planned = true;
    return {
      ...step,
      state: planned ? ("Planned" as const) : ("Completed" as const),
      date: "",
    };
  });
  const next = steps.find((step) => step.state === "Planned");
  return {
    ...record.data,
    processVersion: 2,
    recruitmentSteps: [...steps, ...previous.filter((step) => step.archived)],
    selectedStepId:
      previousStatus === "In progress" &&
      next &&
      !["submission", "offer"].includes(next.kind)
        ? next.id
        : "",
    terminalOutcome: ["Accepted", "Rejected"].includes(previousStatus)
      ? previousStatus
      : "",
    legacyStatusLabel:
      previousStatus === "In progress"
        ? legacyApplicationStage(record) || previousStatus
        : "",
    legacyProcess: {
      status: previousStatus,
      steps: previous,
      capturedAt: new Date().toISOString(),
    },
  };
}

export function selectApplicationStatus(
  record: WorkRecord,
  selection: string,
  day = new Date().toISOString().slice(0, 10),
): RecordData {
  const data = editableApplicationData(record);
  const steps = recruitmentSteps(data, true);
  const active = steps.filter((step) => !step.archived);
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
    step.archived || reached === null
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
    legacyStatusLabel: "",
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
const terminal = (status: ApplicationStatus) =>
  ["Accepted", "Rejected", "Withdrawn"].includes(status);

export function setApplicationStatus(
  record: WorkRecord,
  status: ApplicationStatus,
  currentStepId = "",
  day = new Date().toISOString().slice(0, 10),
): RecordData {
  if (record.data.processVersion === 2)
    return selectApplicationStatus(
      record,
      status === "In progress" ? `step:${currentStepId}` : status,
      day,
    );
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
  if (record.data.processVersion === 2) {
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
    const all = recruitmentSteps(record.data, true).map((step) =>
      step.archived
        ? step
        : {
            ...step,
            state:
              steps.findIndex((item) => item.id === step.id) < cutoff
                ? ("Completed" as const)
                : ("Planned" as const),
          },
    );
    const next = all.find((step) => !step.archived && step.state === "Planned");
    const terminalStatus = ["Accepted", "Rejected"].includes(
      applicationStatus(record),
    );
    if (applicationStatus(record) === "Accepted" && next)
      throw new Error("Change Accepted status before reopening process steps.");
    const submission = steps[index].kind === "submission";
    return {
      ...record.data,
      legacyStatusLabel: "",
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
  if (record.data.processVersion === 2) {
    const target = recruitmentSteps(record.data).find(
      (step) => step.id === stepId,
    );
    if (!target || ["submission", "offer"].includes(target.kind))
      throw new Error("Application and Offer are fixed endpoints.");
    const steps = recruitmentSteps(record.data, true).map((step) =>
      step.id === stepId ? { ...step, archived: true } : step,
    );
    const next = steps.find(
      (step) => !step.archived && step.state === "Planned",
    );
    return {
      ...record.data,
      recruitmentSteps: steps,
      selectedStepId:
        applicationStatus(record) !== "Applied" &&
        next &&
        !["submission", "offer"].includes(next.kind)
          ? next.id
          : "",
    };
  }
  const data = changeRecruitmentStep(record, stepId, "Cancelled");
  const steps = recruitmentSteps(data, true).map((step) =>
    step.id === stepId ? { ...step, archived: true } : step,
  );
  return { ...data, recruitmentSteps: steps };
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

/** Restore uses this same map for steps and their appointment references. */
export function remapRecruitmentSteps(
  data: RecordData,
  stepIds: ReadonlyMap<string, string>,
): RecordData {
  const steps = recruitmentSteps(data, true);
  return {
    ...data,
    ...(Array.isArray(data.stageHistory)
      ? {
          stageHistory: data.stageHistory.map((event) => {
            if (!event || typeof event !== "object" || Array.isArray(event))
              return event;
            const entry = event as Record<string, unknown>;
            return {
              ...entry,
              ...(typeof entry.fromStepId === "string"
                ? {
                    fromStepId:
                      stepIds.get(entry.fromStepId) || entry.fromStepId,
                  }
                : {}),
              ...(typeof entry.toStepId === "string"
                ? { toStepId: stepIds.get(entry.toStepId) || entry.toStepId }
                : {}),
            };
          }),
        }
      : {}),
    ...(typeof data.selectedStepId === "string" && data.selectedStepId
      ? {
          selectedStepId:
            stepIds.get(data.selectedStepId) || data.selectedStepId,
        }
      : {}),
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
