import { field, type WorkRecord } from "../../../shared/model";
import { TRACKS } from "../../content/learning";

export interface LearningSubject {
  id: string;
  title: string;
  description: string;
  seedId?: string;
  record?: WorkRecord;
  order: number;
}
export function learningSubjects(
  records: WorkRecord[],
  includeHidden = false,
): LearningSubject[] {
  const overrides = records.filter(
    (record) =>
      record.kind === "topic" && record.data.category === "learn-track",
  );
  return [
    ...TRACKS.flatMap((seed, index) => {
      const record = overrides.find(
        (item) => field(item, "seedId") === seed.id,
      );
      if (record?.data.hidden && seed.id !== "dsa" && !includeHidden) return [];
      return [
        {
          id: seed.id,
          title: record?.title ?? seed.title,
          description: record?.body ?? seed.description,
          seedId: seed.id,
          record,
          order:
            typeof record?.data.order === "number" ? record.data.order : index,
        },
      ];
    }),
    ...overrides
      .filter(
        (record) =>
          !field(record, "seedId") && (includeHidden || !record.data.hidden),
      )
      .map((record, index) => ({
        id: record.id,
        title: record.title,
        description: record.body,
        record,
        order:
          typeof record.data.order === "number"
            ? record.data.order
            : TRACKS.length + index,
      })),
  ].sort((a, b) => a.order - b.order);
}
