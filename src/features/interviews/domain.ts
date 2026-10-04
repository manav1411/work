import { field, type WorkRecord } from "../../../shared/model";

export interface InterviewTab {
  id: string;
  title: string;
  key?: "behavioural" | "technical";
  record?: WorkRecord;
  order: number;
}
export function interviewTabs(
  records: WorkRecord[],
  includeHidden = false,
): InterviewTab[] {
  const tabs = records.filter(
    (record) =>
      !record.deletedAt &&
      record.kind === "note" &&
      record.data.category === "interview-tab",
  );
  return [
    ...(["behavioural", "technical"] as const).flatMap((key, order) => {
      const record = tabs.find((item) => item.data.tabKey === key);
      return record?.data.hidden && !includeHidden
        ? []
        : [
            {
              id: key,
              key,
              title:
                record?.title ??
                (key === "behavioural" ? "Behavioural" : "Technical"),
              record,
              order:
                typeof record?.data.order === "number"
                  ? record.data.order
                  : order,
            },
          ];
    }),
    ...tabs
      .filter(
        (record) =>
          !record.data.tabKey && (includeHidden || !record.data.hidden),
      )
      .map((record, index) => ({
        id: record.id,
        title: record.title,
        record,
        order:
          typeof record.data.order === "number" ? record.data.order : index + 2,
      })),
  ].sort((a, b) => a.order - b.order);
}
export function upcomingInterviews(
  records: WorkRecord[],
  now = Date.now(),
): WorkRecord[] {
  return records
    .filter(
      (record) =>
        record.kind === "interview" &&
        !record.deletedAt &&
        !["Cancelled", "Completed"].includes(field(record, "status")) &&
        Number.isFinite(Date.parse(field(record, "startsAt"))) &&
        Date.parse(field(record, "startsAt")) >= now,
    )
    .sort((a, b) => field(a, "startsAt").localeCompare(field(b, "startsAt")));
}
export function storyMatches(
  story: WorkRecord,
  query: string,
  tag: string,
): boolean {
  return (
    story.kind === "story" &&
    !story.deletedAt &&
    (!tag || story.tags.includes(tag)) &&
    [
      story.title,
      story.body,
      ...story.tags,
      ...["situation", "task", "action", "result", "lessons", "reflection"].map(
        (key) => field(story, key),
      ),
    ]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase())
  );
}
