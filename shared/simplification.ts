import { z } from "zod";
import {
  EMPTY_GOAL,
  goalInputSchema,
  type Goal,
  type GoalInput,
} from "./goals";
import { field, type RecordKind, type WorkRecord } from "./model";

export interface LegacyMappingEntry {
  record: WorkRecord;
  disposition: "candidate" | "mapped" | "retained";
  reason: string;
  goalId?: string;
  goalInput?: GoalInput;
  mappedGoalDeleted?: boolean;
}
export interface LegacyMappingReport {
  version: 1;
  generatedAt: string;
  inventory: {
    records: number;
    activeRecords: number;
    deletedRecords: number;
    goals: number;
    byKind: Partial<Record<RecordKind, number>>;
  };
  entries: LegacyMappingEntry[];
}

export const legacySelectionSchema = z
  .object({
    selected: z
      .array(
        z
          .object({
            recordId: z.string().min(1).max(120),
            version: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.selected.map((item) => item.recordId)).size ===
      value.selected.length,
    "Select each project once.",
  );

function exactDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (!value ||
      (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(`${value}T12:00:00Z`)) &&
        new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value))
  );
}
function projectSource(record: WorkRecord): string {
  for (const key of ["repoUrl", "demoUrl"]) {
    try {
      const value = field(record, key),
        url = new URL(value);
      if (
        value.length <= 2048 &&
        url.protocol === "https:" &&
        !url.username &&
        !url.password
      )
        return url.href;
    } catch {
      /* Keep unknown destinations in the original record. */
    }
  }
  return "";
}

/** Every copied milestone is explicit; dates and completion times are never inferred. */
export function legacyProjectInput(record: WorkRecord): {
  input?: GoalInput;
  reason: string;
} {
  if (record.deletedAt)
    return { reason: "Deleted record retained for recovery." };
  if (record.kind !== "project")
    return {
      reason:
        "Original record retained; no explicit project milestones to convert.",
    };
  if (
    typeof record.data.connectorSource === "object" &&
    record.data.connectorSource &&
    (record.data.connectorSource as { available?: unknown }).available === false
  )
    return { reason: "Unavailable source record retained for recovery." };
  const source = record.data.milestones;
  if (!Array.isArray(source) || !source.length || source.length > 100)
    return {
      reason: "Project requires between 1 and 100 explicit milestones.",
    };
  const milestones: GoalInput["milestones"] = [];
  for (const value of source) {
    if (!value || typeof value !== "object")
      return {
        reason: "Milestone details are incomplete; original project retained.",
      };
    const item = value as Record<string, unknown>;
    if (!z.string().uuid().safeParse(item.id).success)
      return {
        reason:
          "Milestone IDs are not stable UUIDs; original project retained.",
      };
    if (typeof item.done !== "boolean")
      return {
        reason: "Milestone completion is unknown; original project retained.",
      };
    if (!exactDate(item.dueDate))
      return {
        reason:
          "Milestone dates are missing or invalid; original project retained.",
      };
    const title = typeof item.title === "string" ? item.title : item.text;
    if (
      typeof title !== "string" ||
      !title.trim() ||
      title.trim().length > 240 ||
      (typeof item.title === "string" &&
        typeof item.text === "string" &&
        item.title.trim() !== item.text.trim())
    )
      return {
        reason:
          "Milestone titles are missing or ambiguous; original project retained.",
      };
    milestones.push({
      id: item.id as string,
      title: title.trim(),
      date: item.dueDate,
      done: item.done,
      completedAt: null,
    });
  }
  const dates = milestones
    .map((item) => item.date)
    .filter(Boolean)
    .sort();
  if (!dates.length)
    return {
      reason:
        "Project has no explicitly dated milestones; original project retained.",
    };
  const input = goalInputSchema.safeParse({
    ...EMPTY_GOAL,
    title: record.title,
    measure: "milestones",
    targetDate: dates.at(-1),
    target: milestones.length,
    unit: "milestones",
    milestones,
    sourceUrl: projectSource(record),
  });
  if (!input.success)
    return {
      reason:
        "Project details cannot be copied exactly; original project retained.",
    };
  return {
    input: input.data,
    reason:
      "Explicit dated milestones can be copied to a goal. The original project is retained; historical completion times remain unknown.",
  };
}

/** A versioned, owner-specific UUID makes retries safe without touching legacy records. */
export async function legacyGoalId(
  owner: string,
  recordId: string,
): Promise<string> {
  const hash = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        JSON.stringify(["work:project-goal:v1", owner, recordId]),
      ),
    ),
  );
  const bytes = hash.slice(0, 16);
  bytes[6] = (bytes[6] & 15) | 128;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function legacyMappingReport(
  records: WorkRecord[],
  goals: Goal[],
  owner: string,
): Promise<LegacyMappingReport> {
  const existing = new Map(goals.map((goal) => [goal.id, goal]));
  const entries = await Promise.all(
    records
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(async (record) => {
        const goalId =
          record.kind === "project"
            ? await legacyGoalId(owner, record.id)
            : undefined;
        const mapped = goalId && existing.get(goalId);
        if (mapped)
          return {
            record,
            goalId,
            disposition: "mapped" as const,
            mappedGoalDeleted: !!mapped.deletedAt,
            reason: mapped.deletedAt
              ? "Previously converted goal was removed. Original project retained; retries do not recreate the goal."
              : "Already converted. Original project retained; retries do not create another goal.",
          };
        const candidate = legacyProjectInput(record);
        return {
          record,
          disposition: candidate.input
            ? ("candidate" as const)
            : ("retained" as const),
          reason: candidate.reason,
          ...(candidate.input ? { goalId, goalInput: candidate.input } : {}),
        };
      }),
  );
  const byKind: LegacyMappingReport["inventory"]["byKind"] = {};
  records.forEach((record) => {
    byKind[record.kind] = (byKind[record.kind] || 0) + 1;
  });
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    inventory: {
      records: records.length,
      activeRecords: records.filter((record) => !record.deletedAt).length,
      deletedRecords: records.filter((record) => !!record.deletedAt).length,
      goals: goals.length,
      byKind,
    },
    entries,
  };
}
