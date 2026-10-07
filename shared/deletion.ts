import { type WorkRecord } from "./model";

/** Remove dependent content, while independent documents and stories stay editable. */
export function dependentRecordIds(
  records: WorkRecord[],
  initial: Iterable<string>,
): Set<string> {
  const ids = new Set(initial);
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of records) {
      if (ids.has(record.id)) continue;
      const parent = records.find(
        (item) =>
          ids.has(item.id) &&
          ((item.kind === "application" &&
            record.kind === "interview" &&
            record.data.applicationId === item.id) ||
            (item.kind === "interview" &&
              record.kind === "note" &&
              record.data.interviewId === item.id) ||
            (item.kind === "topic" &&
              record.data.scope === "learn" &&
              record.data.track === item.id) ||
            (item.data.category === "interview-tab" &&
              record.data.tabId === item.id)),
      );
      if (parent) {
        ids.add(record.id);
        changed = true;
      }
    }
  }
  return ids;
}
