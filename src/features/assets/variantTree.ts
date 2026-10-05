import { field, type WorkRecord } from "../../../shared/model";
/** Stable parents form the display tree; deleted parents and cycles remain recoverable roots. */
export function variantTree(
  records: WorkRecord[],
): { record: WorkRecord; depth: number; historicalParent: boolean }[] {
  const result: {
    record: WorkRecord;
    depth: number;
    historicalParent: boolean;
  }[] = [];
  const visited = new Set<string>();
  const ids = new Set(records.map((record) => record.id));
  function walk(record: WorkRecord, depth: number) {
    if (visited.has(record.id)) return;
    visited.add(record.id);
    result.push({
      record,
      depth,
      historicalParent:
        !!field(record, "parentVariantId") &&
        !ids.has(field(record, "parentVariantId")),
    });
    records
      .filter((child) => field(child, "parentVariantId") === record.id)
      .forEach((child) => walk(child, depth + 1));
  }
  records
    .filter((record) => !ids.has(field(record, "parentVariantId")))
    .forEach((record) => walk(record, 0));
  records.forEach((record) => walk(record, 0));
  return result;
}
