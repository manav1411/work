import { Hono } from "hono";
import { newGoal, type Goal } from "../shared/goals";
import {
  legacyGoalId,
  legacyMappingReport,
  legacyProjectInput,
  legacySelectionSchema,
} from "../shared/simplification";
import { fromRow, type RecordRow } from "./db/records";
import { ApiError, type Env, type Variables } from "./env";
import { listGoals } from "./goals";
import { parse, readJson } from "./validation";

async function legacyRecords(db: D1Database, owner: string) {
  const rows = await db
    .prepare("SELECT * FROM records WHERE owner_id=? ORDER BY id")
    .bind(owner)
    .all<RecordRow>();
  return rows.results.map(fromRow);
}
export async function legacyReport(db: D1Database, owner: string) {
  const [records, goals] = await Promise.all([
    legacyRecords(db, owner),
    listGoals(db, owner, true),
  ]);
  return legacyMappingReport(records, goals, owner);
}

const routes = new Hono<{ Bindings: Env; Variables: Variables }>();
routes.get("/", async (c) =>
  c.json(await legacyReport(c.env.DB, c.get("user").id)),
);
routes.post("/", async (c) => {
  const input = parse(legacySelectionSchema, await readJson(c.req.raw));
  const owner = c.get("user").id,
    db = c.env.DB;
  const ids = input.selected.map((item) => item.recordId);
  const rows = await db
    .prepare(
      "SELECT * FROM records WHERE owner_id=? AND id IN (SELECT value FROM json_each(?))",
    )
    .bind(owner, JSON.stringify(ids))
    .all<RecordRow>();
  const records = rows.results.map(fromRow);
  const existing = new Set(
    (await listGoals(db, owner, true)).map((goal) => goal.id),
  );
  const goals: Goal[] = [];
  const goalIds: string[] = [];
  for (const selected of input.selected) {
    const record = records.find((item) => item.id === selected.recordId);
    if (!record)
      throw new ApiError(404, "NOT_FOUND", "This project was not found.");
    if (record.version !== selected.version)
      throw new ApiError(
        409,
        "VERSION_CONFLICT",
        "A selected project changed. Load the mapping report again.",
      );
    const candidate = legacyProjectInput(record);
    if (!candidate.input)
      throw new ApiError(400, "INVALID_PROJECT", candidate.reason);
    const id = await legacyGoalId(owner, record.id);
    goalIds.push(id);
    if (!existing.has(id)) goals.push({ ...newGoal(candidate.input), id });
  }
  const guardId = crypto.randomUUID();
  try {
    const results = await db.batch([
      db
        .prepare(
          "INSERT INTO write_guards(id,value) SELECT ?, (SELECT COUNT(*) FROM records r JOIN json_each(?) s ON r.id=json_extract(s.value,'$.recordId') AND r.version=json_extract(s.value,'$.version') WHERE r.owner_id=? AND r.kind='project' AND r.deleted_at IS NULL AND COALESCE(json_extract(r.data,'$.connectorSource.available'),1)!=0)=?",
        )
        .bind(
          guardId,
          JSON.stringify(input.selected),
          owner,
          input.selected.length,
        ),
      ...goals.map((goal) =>
        db
          .prepare(
            "INSERT OR IGNORE INTO goals(id,owner_id,payload,version,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?)",
          )
          .bind(
            goal.id,
            owner,
            JSON.stringify(goal),
            goal.version,
            goal.createdAt,
            goal.updatedAt,
            goal.deletedAt,
          ),
      ),
      db.prepare("DELETE FROM write_guards WHERE id=?").bind(guardId),
    ]);
    const created = results
      .slice(1, -1)
      .reduce((sum, result) => sum + result.meta.changes, 0);
    return c.json({
      created,
      skipped: input.selected.length - created,
      goalIds,
      report: await legacyReport(db, owner),
    });
  } catch (error) {
    if (String(error).includes("CHECK constraint failed"))
      throw new ApiError(
        409,
        "VERSION_CONFLICT",
        "A selected project changed. Load the mapping report again.",
      );
    throw error;
  }
});
export const goalMigrationRoutes = routes;
