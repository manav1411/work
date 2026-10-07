import { ApiError, id } from "./env";
/** Reject writes from a replaced workspace inside the same transaction as each mutation. */
export function epochDatabase(
  db: D1Database,
  owner: string,
  epoch: string,
): D1Database {
  const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const guarded = async (statements: D1PreparedStatement[]) => {
    const guard = id();
    try {
      const results = await db.batch([
        db
          .prepare(
            "INSERT INTO write_guards(id,value) SELECT ?,EXISTS(SELECT 1 FROM workspace_state WHERE owner_id=? AND epoch=?)",
          )
          .bind(guard, owner, epoch),
        ...statements.map((statement) => originals.get(statement) ?? statement),
        db.prepare("DELETE FROM write_guards WHERE id=?").bind(guard),
      ]);
      return results.slice(1, -1);
    } catch (error) {
      const current = await db
        .prepare("SELECT epoch FROM workspace_state WHERE owner_id=?")
        .bind(owner)
        .first<{ epoch: string }>();
      if (current?.epoch !== epoch)
        throw new ApiError(
          409,
          "WORKSPACE_REPLACED",
          "Reload this workspace before making changes.",
        );
      throw error;
    }
  };
  const wrap = (
    statement: D1PreparedStatement,
    write: boolean,
  ): D1PreparedStatement => {
    const proxy = new Proxy(statement, {
      get(target, key) {
        if (key === "bind")
          return (...args: unknown[]) => wrap(target.bind(...args), write);
        if (write && ["run", "all", "first", "raw"].includes(String(key)))
          return async (...args: unknown[]) => {
            const result = (await guarded([target]))[0];
            if (key === "first") {
              const row = result.results[0] as
                Record<string, unknown> | undefined;
              return typeof args[0] === "string"
                ? (row?.[args[0]] ?? null)
                : (row ?? null);
            }
            if (key === "raw")
              return result.results.map((row) =>
                Object.values(row as Record<string, unknown>),
              );
            return result;
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    originals.set(proxy, statement);
    return proxy;
  };
  return new Proxy(db, {
    get(target, key) {
      if (key === "prepare")
        return (sql: string) =>
          wrap(
            target.prepare(sql),
            /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql),
          );
      if (key === "batch") return guarded;
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
