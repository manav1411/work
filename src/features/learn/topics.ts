import { field, type WorkRecord } from "../../../shared/model";
import { LEARNING_TOPICS, TRACKS } from "../../content/learning";

export interface LearningSubject {
  id: string;
  title: string;
  description: string;
  seedId?: string;
  record?: WorkRecord;
  order: number;
}
export interface EditableLearningTopic {
  id: string;
  title: string;
  summary: string;
  seedId?: string;
  record?: WorkRecord;
  resource: string;
  url: string;
  order: number;
}
export function learningSubjects(
  records: WorkRecord[],
  includeHidden = false,
): LearningSubject[] {
  const overrides = records.filter(
    (record) =>
      !record.deletedAt &&
      record.kind === "topic" &&
      record.data.category === "learn-track",
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
export function learningTopics(
  records: WorkRecord[],
  track: string,
  includeHidden = false,
): EditableLearningTopic[] {
  const overrides = records.filter(
    (record) =>
      !record.deletedAt &&
      record.kind === "topic" &&
      field(record, "track") === track &&
      record.data.category !== "learn-track",
  );
  return [
    ...LEARNING_TOPICS.filter(
      (seed) => seed.track === track && track !== "dsa",
    ).flatMap((seed, index) => {
      const record = overrides.find(
        (item) => field(item, "seedId") === seed.id,
      );
      if (record?.data.hidden && !includeHidden) return [];
      return [
        {
          id: seed.id,
          title: record?.title ?? seed.title,
          summary: record?.body ?? seed.summary,
          seedId: seed.id,
          record,
          resource: record
            ? field(record, "resource", seed.resource)
            : seed.resource,
          url: record ? field(record, "url", seed.url) : seed.url,
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
        summary: record.body,
        record,
        resource: field(record, "resource", "Reading"),
        url: field(record, "url"),
        order:
          typeof record.data.order === "number"
            ? record.data.order
            : 100 + index,
      })),
  ].sort((a, b) => a.order - b.order);
}
