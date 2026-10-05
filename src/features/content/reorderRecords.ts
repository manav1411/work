import type { RecordPatch, WorkRecord } from "../../../shared/model";
import { jsonRequest, request } from "../../lib/api";

/** Persist the complete order atomically so conflicts cannot leave half a collection rearranged. */
export async function reorderRecords(
  records: WorkRecord[],
  workspace: {
    mode: string;
    refresh: () => Promise<void>;
    update: (
      id: string,
      patch: RecordPatch,
      version?: number,
    ) => Promise<WorkRecord>;
  },
  key: "order" | "directionOrder" = "order",
) {
  if (records.some((record) => record.id.startsWith("offline-")))
    throw new Error("Sync your new items before arranging them.");
  if (workspace.mode === "demo") {
    for (const [order, record] of records.entries())
      await workspace.update(record.id, {
        data: { ...record.data, [key]: order },
      });
    return;
  }
  await request<{ records: WorkRecord[] }>(
    "/api/records/reorder",
    jsonRequest("POST", {
      items: records.map((record, order) => ({
        id: record.id,
        version: record.version,
        order,
      })),
      key,
    }),
  );
  await workspace.refresh();
}
