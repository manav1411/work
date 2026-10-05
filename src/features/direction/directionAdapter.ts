import { field, type WorkRecord } from "../../../shared/model";
export const DIRECTION_STATUSES = [
  "Future",
  "Exploring",
  "Pursuing",
  "Achieved",
] as const;
/** Reading old records never writes or discards their authored fields. */
export function directionNotes(record: WorkRecord) {
  if (record.data.richContent) return record.body;
  const labels: Record<string, string> = {
    focus: "Previous focus",
    priority: "Previous priority",
    location: "Location",
    nextStep: "Previous next step",
    uncertainties: "Open questions",
    outcome: "Outcome",
    outcomes: "Outcomes",
    feedback: "Feedback",
    reviewDate: "Previous review date",
  };
  const extras = Object.entries(labels)
    .filter(([key]) => field(record, key))
    .map(([key, label]) => `### ${label}\n${field(record, key)}`);
  const options = record.data.options;
  if (options)
    extras.push(
      `### Alternatives\n${typeof options === "string" ? options : JSON.stringify(options, null, 2)}`,
    );
  if (
    field(record, "status") &&
    !DIRECTION_STATUSES.includes(
      field(record, "status") as (typeof DIRECTION_STATUSES)[number],
    )
  )
    extras.push(`### Previous status\n${field(record, "status")}`);
  return [record.body, ...extras].filter(Boolean).join("\n\n");
}
