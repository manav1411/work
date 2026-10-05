import { Hono } from "hono";
import { z } from "zod";
import {
  goalInputSchema,
  goalFields,
  checkpointSchema,
  newGoal,
  goalProgress,
  sourceCheckpointHistory,
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
  deleted_at: string | null;
}
export function goalFromRow(row: GoalRow): Goal {
  return {
    directionId: "",
    ...JSON.parse(row.payload),
    id: row.id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}
export async function listGoals(
  db: D1Database,
  owner: string,
  includeDeleted = false,
) {
  const rows = await db
    .prepare(
      `SELECT * FROM goals WHERE owner_id=? ${includeDeleted ? "" : "AND deleted_at IS NULL"} ORDER BY created_at`,
    )
    .bind(owner)
    .all<GoalRow>();
  return rows.results.map(goalFromRow);
}
export function insertGoal(db: D1Database, owner: string, goal: Goal) {
  return db
    .prepare(
      "INSERT INTO goals(id,owner_id,payload,version,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?)",
    )
    .bind(
      goal.id,
      owner,
      JSON.stringify(goal),
      goal.version,
      goal.createdAt,
      goal.updatedAt,
      goal.deletedAt,
    );
}
export function bulkInsertGoals(db: D1Database, owner: string, goals: Goal[]) {
  return jsonChunks(goals).map((chunk) =>
    db
      .prepare(
        "INSERT INTO goals(id,owner_id,payload,version,created_at,updated_at,deleted_at) SELECT json_extract(value,'$.id'),?,value,json_extract(value,'$.version'),json_extract(value,'$.createdAt'),json_extract(value,'$.updatedAt'),json_extract(value,'$.deletedAt') FROM json_each(?)",
      )
      .bind(owner, chunk),
  );
}
async function getGoal(db: D1Database, owner: string, id: string) {
  const row = await db
    .prepare(
      "SELECT * FROM goals WHERE id=? AND owner_id=? AND deleted_at IS NULL",
    )
    .bind(id, owner)
    .first<GoalRow>();
  if (!row) throw new ApiError(404, "NOT_FOUND", "Goal not found.");
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
      "UPDATE goals SET payload=?,version=?,updated_at=?,deleted_at=? WHERE id=? AND owner_id=? AND version=? RETURNING *",
    )
    .bind(
      JSON.stringify(next),
      next.version,
      next.updatedAt,
      next.deletedAt,
      before.id,
      owner,
      before.version,
    )
    .first<GoalRow>();
  if (!row)
    throw new ApiError(
      409,
      "VERSION_CONFLICT",
      "This goal changed in another session. Reload and try again.",
    );
  return goalFromRow(row);
}
const routes = new Hono<{ Bindings: Env; Variables: Variables }>();
async function validateDirection(
  db: D1Database,
  owner: string,
  directionId: string,
) {
  if (!directionId) return;
  const record = await db
    .prepare(
      "SELECT id FROM records WHERE owner_id=? AND id=? AND kind IN ('path','rotation','decision')",
    )
    .bind(owner, directionId)
    .first();
  if (!record)
    throw new ApiError(
      400,
      "INVALID_DIRECTION",
      "Choose a career path, stream, or decision in your workspace.",
    );
}
routes.get("/", async (c) =>
  c.json({ goals: await listGoals(c.env.DB, c.get("user").id) }),
);
routes.post("/", async (c) => {
  const input = parse(goalInputSchema, await readJson(c.req.raw));
  if (!["completion", "leetcode"].includes(input.measure))
    throw new ApiError(
      400,
      "RETIRED_MEASURE",
      "New goals use completion or LeetCode problems.",
    );
  const owner = c.get("user").id;
  const state = await checkIdempotency(
    c.env.DB,
    owner,
    c.req.header("Idempotency-Key"),
    input,
  );
  if (state.response) return c.json(state.response);
  await validateDirection(c.env.DB, owner, input.directionId);
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
  parse(goalInputSchema, fields);
  const owner = c.get("user").id,
    before = await getGoal(c.env.DB, owner, c.req.param("id"));
  if (version !== before.version)
    throw new ApiError(
      409,
      "VERSION_CONFLICT",
      "This goal changed in another session. Your draft is still open.",
    );
  if (
    fields.measure !== before.measure &&
    !["completion", "leetcode"].includes(fields.measure)
  )
    throw new ApiError(
      400,
      "RETIRED_MEASURE",
      "Choose completion or LeetCode problems when changing the measure.",
    );
  const at = new Date().toISOString();
  await validateDirection(c.env.DB, owner, fields.directionId);
  const progress = goalProgress({ ...before, ...fields });
  const previous = goalProgress(before);
  const checkpoints =
    progress.value !== previous.value
      ? [
          ...before.checkpoints,
          {
            value: progress.value,
            at,
            unit: fields.unit,
            measure: fields.measure,
            scope: fields.scope,
          },
        ].slice(-1000)
      : before.checkpoints;
  const goal = await saveGoal(c.env.DB, owner, before, {
    ...before,
    ...fields,
    checkpoints,
    version: version + 1,
    updatedAt: at,
  });
  return c.json({ goal });
});
routes.post("/:id/checkpoint", async (c) => {
  const input = parse(checkpointSchema, await readJson(c.req.raw));
  if (Date.parse(input.at) > Date.now() + 300_000)
    throw new ApiError(
      400,
      "INVALID_DATE",
      "A checkpoint cannot be in the future.",
    );
  const owner = c.get("user").id,
    before = await getGoal(c.env.DB, owner, c.req.param("id"));
  if (!["curriculum", "problems", "leetcode"].includes(before.measure))
    throw new ApiError(400, "INVALID_GOAL", "This goal uses manual progress.");
  if (
    (input.measure !== undefined && input.measure !== before.measure) ||
    (input.scope !== undefined && input.scope !== before.scope)
  )
    throw new ApiError(
      409,
      "VERSION_CONFLICT",
      "This goal's progress source changed. Reload and try again.",
    );
  const checkpoints = sourceCheckpointHistory(before, input);
  if (!checkpoints) return c.json({ goal: before });
  const goal = await saveGoal(c.env.DB, owner, before, {
    ...before,
    value: input.value,
    checkpoints,
    version: before.version + 1,
    updatedAt: new Date().toISOString(),
  });
  return c.json({ goal });
});
routes.delete("/:id", async (c) => {
  const owner = c.get("user").id,
    before = await getGoal(c.env.DB, owner, c.req.param("id"));
  const at = new Date().toISOString();
  await saveGoal(c.env.DB, owner, before, {
    ...before,
    deletedAt: at,
    updatedAt: at,
    version: before.version + 1,
  });
  return c.json({ deleted: true });
});
export const goalRoutes = routes;
