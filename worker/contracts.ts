import type { WorkRecord } from "../shared/model";
import { recordDataError } from "../shared/record-contract";
import { recruitmentSteps } from "../shared/applications";
import { ApiError } from "./env";

export async function validateRecordContract(
  db: D1Database,
  owner: string,
  record: WorkRecord,
  batch: WorkRecord[] = [],
) {
  const error = recordDataError(record.kind, record.data);
  if (error) throw new ApiError(400, "VALIDATION_ERROR", error);
  const related = async (id: unknown, kinds: string[], category?: string) => {
    if (typeof id !== "string" || !id) return null;
    const candidate = batch.find((item) => item.id === id);
    const row =
      candidate ??
      (await db
        .prepare("SELECT id,kind,data FROM records WHERE id=? AND owner_id=?")
        .bind(id, owner)
        .first<{ id: string; kind: string; data: string }>());
    if (!row || !kinds.includes(row.kind))
      throw new ApiError(
        400,
        "INVALID_REFERENCE",
        "Choose a related record of the correct type in your workspace.",
      );
    const data = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
    if (category && data.category !== category)
      throw new ApiError(
        400,
        "INVALID_REFERENCE",
        "Choose a related topic or tab in your workspace.",
      );
    return { id: row.id, kind: row.kind, data };
  };
  if (record.kind === "application")
    await related(record.data.companyId, ["company"]);
  const scoped = ["content-document", "interview-preparation"].includes(
    String(record.data.category),
  );
  const application =
    record.kind === "interview" || scoped
      ? await related(record.data.applicationId, ["application"])
      : null;
  const interview = scoped
    ? await related(record.data.interviewId, ["interview"])
    : null;
  await related(record.data.directionId, ["path", "rotation", "decision"]);
  if (record.data.category === "content-document") {
    await related(record.data.tabId, ["note"], "interview-tab");
  }
  if (
    record.data.category === "content-document" &&
    record.data.scope === "learn" &&
    typeof record.data.track === "string" &&
    /^[0-9a-f-]{36}$/i.test(record.data.track)
  )
    await related(record.data.track, ["topic"], "learn-track");
  if (Array.isArray(record.data.storyIds))
    for (const id of record.data.storyIds) await related(id, ["story"]);
  if (
    application &&
    interview &&
    interview.data.applicationId !== application.id
  )
    throw new ApiError(
      400,
      "INVALID_REFERENCE",
      "Preparation must use its interview's application.",
    );
  if (
    record.data.stepId &&
    (!application ||
      !recruitmentSteps(application.data).some(
        (step) =>
          step.id === record.data.stepId &&
          (record.data.appointmentVersion !== 2 ||
            !["submission", "offer"].includes(step.kind)),
      ))
  )
    throw new ApiError(
      400,
      "INVALID_REFERENCE",
      "This step does not belong to the selected application.",
    );
  if (managedDocument(record) && record.data.primaryAttachmentId) {
    const file = await db
      .prepare("SELECT record_id FROM attachments WHERE id=? AND owner_id=?")
      .bind(record.data.primaryAttachmentId, owner)
      .first<{ record_id: string }>();
    if (!file || file.record_id !== record.id)
      throw new ApiError(
        400,
        "INVALID_REFERENCE",
        "Select a file belonging to this document.",
      );
  }
}

/** Repeat membership checks inside the atomic write, including concurrent round edits. */
export function recordContractStatements(
  db: D1Database,
  owner: string,
  records: WorkRecord[],
) {
  const guards: D1PreparedStatement[] = [];
  for (const record of records) {
    let expression = "1";
    const bindings: (string | number)[] = [];
    if (record.kind === "interview" && record.data.stepId) {
      expression =
        "EXISTS(SELECT 1 FROM records a JOIN json_each(a.data,'$.recruitmentSteps') step WHERE a.id=? AND a.owner_id=? AND a.kind='application' AND json_extract(step.value,'$.id')=?)";
      bindings.push(
        String(record.data.applicationId ?? ""),
        owner,
        String(record.data.stepId),
      );
      if (record.data.appointmentVersion === 2)
        expression +=
          " AND EXISTS(SELECT 1 FROM records a JOIN json_each(a.data,'$.recruitmentSteps') step WHERE a.id=? AND a.owner_id=? AND json_extract(step.value,'$.id')=? AND json_extract(step.value,'$.kind') NOT IN ('submission','offer'))";
      if (record.data.appointmentVersion === 2)
        bindings.push(
          String(record.data.applicationId),
          owner,
          String(record.data.stepId),
        );
    }
    if (managedDocument(record) && record.data.primaryAttachmentId) {
      expression +=
        " AND EXISTS(SELECT 1 FROM attachments WHERE owner_id=? AND id=? AND record_id=?)";
      bindings.push(owner, String(record.data.primaryAttachmentId), record.id);
    }
    if (expression === "1") continue;
    const guardId = crypto.randomUUID();
    guards.push(
      db
        .prepare(`INSERT INTO write_guards(id,value) SELECT ?,${expression}`)
        .bind(guardId, ...bindings),
      db.prepare("DELETE FROM write_guards WHERE id=?").bind(guardId),
    );
  }
  return guards;
}

function managedDocument(record: WorkRecord) {
  return (
    record.kind === "asset" &&
    ["resume", "letter", "document"].includes(String(record.data.type))
  );
}
