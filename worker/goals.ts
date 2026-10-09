import { Hono } from "hono";
import { z } from "zod";
import {
  goalInputSchema,
  goalFields,
  newGoal,
  actionGoalIds,
  actionLinks,
  type Goal,
} from "../shared/goals";
import { ApiError, type Env, type Variables } from "./env";
import { parse, readJson } from "./validation";
import { jsonChunks } from "./db/records";
import {
  checkIdempotency,
  idempotencyStatement,
  raceResponse,
} from "./idempotency";

interface GoalRow {
  id: string;
  payload: string;
  version: number;
  created_at: string;
  updated_at: string;
}
export function goalFromRow(row: GoalRow): Goal {
  return {
    ...JSON.parse(row.payload),
    id: row.id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export async function listGoals(db: D1Database, owner: string) {
  const rows = await db
    .prepare(`SELECT * FROM goals WHERE owner_id=? ORDER BY created_at`)
    .bind(owner)
    .all<GoalRow>();
  return rows.results.map(goalFromRow);
}
export function insertGoal(db: D1Database, owner: string, goal: Goal) {
  return db
    .prepare(
      "INSERT INTO goals(id,owner_id,payload,version,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    )
    .bind(
      goal.id,
      owner,
      JSON.stringify(goal),
      goal.version,
      goal.createdAt,
      goal.updatedAt,
    );
}
export function bulkInsertGoals(db: D1Database, owner: string, goals: Goal[]) {
  return jsonChunks(goals).map((chunk) =>
    db
      .prepare(
        "INSERT INTO goals(id,owner_id,payload,version,created_at,updated_at) SELECT json_extract(value,'$.id'),?,value,json_extract(value,'$.version'),json_extract(value,'$.createdAt'),json_extract(value,'$.updatedAt') FROM json_each(?)",
      )
      .bind(owner, chunk),
  );
}
async function getGoal(db: D1Database, owner: string, id: string) {
  const row = await db
    .prepare("SELECT * FROM goals WHERE id=? AND owner_id=?")
    .bind(id, owner)
    .first<GoalRow>();
  if (!row) throw new ApiError(404, "NOT_FOUND", "Action not found.");
  return goalFromRow(row);
}
async function saveGoal(
  db: D1Database,
  owner: string,
  before: Goal,
  next: Goal,
) {
  const row = await db
    .prepare(
      "UPDATE goals SET payload=?,version=?,updated_at=? WHERE id=? AND owner_id=? AND version=? RETURNING *",
    )
    .bind(
      JSON.stringify(next),
      next.version,
      next.updatedAt,
      before.id,
      owner,
      before.version,
    )
    .first<GoalRow>();
  if (!row)
    throw new ApiError(
      409,
      "VERSION_CONFLICT",
      "This action changed in another session. Reload and try again.",
    );
  return goalFromRow(row);
}
const routes = new Hono<{ Bindings: Env; Variables: Variables }>();
async function validateGoals(db: D1Database, owner: string, ids: string[]) {
  if (!ids.length)
    throw new ApiError(
      400,
      "INVALID_DIRECTION",
      "Choose at least one goal for this action.",
    );
  const records = await db
    .prepare(
      "SELECT id FROM records WHERE owner_id=? AND id IN (SELECT value FROM json_each(?)) AND kind IN ('path','rotation','decision')",
    )
    .bind(owner, JSON.stringify(ids))
    .all();
  if (records.results.length !== ids.length)
    throw new ApiError(
      400,
      "INVALID_DIRECTION",
      "Choose goals in your workspace.",
    );
}
routes.get("/", async (c) =>
  c.json({ goals: await listGoals(c.env.DB, c.get("user").id) }),
);
routes.post("/", async (c) => {
  const input = parse(goalInputSchema, await readJson(c.req.raw));
  const owner = c.get("user").id;
  const state = await checkIdempotency(
    c.env.DB,
    owner,
    c.req.header("Idempotency-Key"),
    input,
  );
  if (state.response) return c.json(state.response);
  await validateGoals(c.env.DB, owner, actionGoalIds(input));
  const goal = newGoal(input);
  try {
    await c.env.DB.batch([
      insertGoal(c.env.DB, owner, goal),
      ...idempotencyStatement(c.env.DB, owner, state, { goal }),
    ]);
  } catch (error) {
    const response = await raceResponse(c.env.DB, owner, state);
    if (response) return c.json(response);
    throw error;
  }
  return c.json({ goal }, 201);
});
routes.patch("/:id", async (c) => {
  const input = parse(
    goalFields.extend({ version: z.number().int().positive() }).strict(),
    await readJson(c.req.raw),
  );
  const { version, ...fields } = input;
  const owner = c.get("user").id,
    before = await getGoal(c.env.DB, owner, c.req.param("id"));
  if (version !== before.version)
    throw new ApiError(
      409,
      "VERSION_CONFLICT",
      "This action changed in another session. Your draft is still open.",
    );
  const at = new Date().toISOString();
  // Older clients only submit the primary link. Preserve additional links when it is unchanged.
  const links = actionLinks(
    fields.goalIds === undefined && fields.directionId === before.directionId
      ? actionGoalIds(before)
      : actionGoalIds(fields),
  );
  const normalized = parse(goalInputSchema, {
    ...fields,
    ...links,
    scheduleKind: fields.scheduleKind ?? before.scheduleKind ?? "range",
  });
  await validateGoals(c.env.DB, owner, links.goalIds);
  const goal = await saveGoal(c.env.DB, owner, before, {
    ...before,
    ...normalized,
    version: version + 1,
    updatedAt: at,
  });
  return c.json({ goal });
});
routes.delete("/:id", async (c) => {
  const owner = c.get("user").id;
  await getGoal(c.env.DB, owner, c.req.param("id"));
  await c.env.DB.prepare("DELETE FROM goals WHERE id=? AND owner_id=?")
    .bind(c.req.param("id"), owner)
    .run();
  return c.json({ deleted: true });
});
export const goalRoutes = routes;
