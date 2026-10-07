import type { RecordInput } from "../../shared/model";
export const STARTER_RECORDS: RecordInput[] = [
  {
    kind: "path",
    title: "My next direction",
    body: "",
    data: {
      category: "direction",
      status: "Exploring",
      startDate: "",
      endDate: "",
      researchLinks: [],
      researchLinkTitles: [],
    },
  },
  {
    kind: "story",
    title: "A challenge I solved",
    data: { situation: "", task: "", action: "", result: "", lessons: "" },
  },
];
