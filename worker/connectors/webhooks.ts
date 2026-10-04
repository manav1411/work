import { Hono, type Context } from "hono";
import { ApiError, id, now, type Env, type Variables } from "../env";
import { readLimitedBody } from "../validation";
import { connection, sourceVisibility, type ConnectionRow } from "./store";
import { openCredentials, sealCredentials } from "./credentials";

interface Subscription {
  id: string;
  owner_id: string;
  connection_id: string;
  credential: string | null;
  expires_at: string;
}
export async function beginNotionWebhook(env: Env, owner: string) {
  const row = await connection(env.DB, owner, "notion");
  if (row.status === "disconnected")
    throw new ApiError(
      409,
      "CONNECTION_DISCONNECTED",
      "Connect Notion before setting up events.",
    );
  const subscriptionId = id();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await env.DB.prepare(
    "INSERT INTO connector_webhook_subscriptions(id,owner_id,connection_id,expires_at,created_at) VALUES(?,?,?,?,?)",
  )
    .bind(subscriptionId, owner, row.id, expiresAt, now())
    .run();
  return {
    id: subscriptionId,
    url: `${env.APP_ORIGIN}/api/connectors/webhooks/notion/${subscriptionId}`,
    expiresAt,
  };
}
export async function readNotionVerification(
  env: Env,
  owner: string,
  subscriptionId: string,
) {
  const subscription = await env.DB.prepare(
    "SELECT * FROM connector_webhook_subscriptions WHERE id=? AND owner_id=?",
  )
    .bind(subscriptionId, owner)
    .first<Subscription>();
  if (!subscription)
    throw new ApiError(404, "NOT_FOUND", "This webhook setup was not found.");
  return {
    verificationToken:
      (await openCredentials(env, subscription.id, subscription.credential))
        .token || null,
  };
}
async function validSignature(
  secret: string,
  signature: string | undefined,
  bytes: Uint8Array,
): Promise<boolean> {
  if (!signature || !/^sha256=[0-9a-f]{64}$/i.test(signature)) return false;
  const digest = Uint8Array.from(signature.slice(7).match(/.{2}/g)!, (part) =>
    parseInt(part, 16),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, digest, new Uint8Array(bytes));
}
const webhooks = new Hono<{ Bindings: Env; Variables: Variables }>();
async function receive(c: Context<{ Bindings: Env; Variables: Variables }>) {
  const target = c.req.param("provider");
  if (target !== "notion" && target !== "github")
    throw new ApiError(404, "NOT_FOUND", "This webhook was not found.");
  const bytes = await readLimitedBody(c.req.raw, 1_000_000);
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Use a valid webhook payload.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new ApiError(400, "INVALID_JSON", "Use a valid webhook payload.");
  let subscription: Subscription | null = null;
  let secret =
    target === "github"
      ? c.env.GITHUB_APP_WEBHOOK_SECRET
      : c.env.NOTION_WEBHOOK_SECRET;
  if (target === "notion" && c.req.param("subscriptionId")) {
    subscription = await c.env.DB.prepare(
      "SELECT * FROM connector_webhook_subscriptions WHERE id=?",
    )
      .bind(c.req.param("subscriptionId"))
      .first<Subscription>();
    if (!subscription)
      throw new ApiError(404, "NOT_FOUND", "This webhook setup was not found.");
    if (typeof payload.verification_token === "string") {
      if (
        subscription.credential ||
        subscription.expires_at < now() ||
        payload.verification_token.length < 24 ||
        payload.verification_token.length > 1000
      )
        throw new ApiError(
          403,
          "VERIFICATION_REJECTED",
          "Start a new webhook setup from the signed-in workspace.",
        );
      const sealed = await sealCredentials(c.env, subscription.id, {
        token: payload.verification_token,
      });
      const result = await c.env.DB.prepare(
        "UPDATE connector_webhook_subscriptions SET credential=? WHERE id=? AND credential IS NULL AND expires_at>? RETURNING id",
      )
        .bind(sealed, subscription.id, now())
        .first();
      if (!result)
        throw new ApiError(
          409,
          "VERIFICATION_REJECTED",
          "This webhook setup was already used.",
        );
      return c.json({ received: true });
    }
    secret = (
      await openCredentials(c.env, subscription.id, subscription.credential)
    ).token;
  }
  if (
    !secret ||
    !(await validSignature(
      secret,
      c.req.header(
        target === "github" ? "X-Hub-Signature-256" : "X-Notion-Signature",
      ),
      bytes,
    ))
  )
    throw new ApiError(
      403,
      "WEBHOOK_SIGNATURE_INVALID",
      "The provider signature could not be verified.",
    );
  const delivery =
    target === "github"
      ? c.req.header("X-GitHub-Delivery")
      : typeof payload.id === "string"
        ? payload.id
        : undefined;
  if (!delivery || delivery.length > 200)
    throw new ApiError(
      400,
      "INVALID_DELIVERY",
      "The webhook needs a delivery identity.",
    );
  const deliveryKey = `${subscription?.id || "global"}:${delivery}`;
  await c.env.DB.prepare(
    "DELETE FROM connector_deliveries WHERE provider=? AND delivery_id=? AND processed_at IS NULL AND received_at<?",
  )
    .bind(target, deliveryKey, new Date(Date.now() - 3 * 60_000).toISOString())
    .run();
  const accepted = await c.env.DB.prepare(
    "INSERT OR IGNORE INTO connector_deliveries(provider,delivery_id,received_at) VALUES(?,?,?) RETURNING delivery_id",
  )
    .bind(target, deliveryKey, now())
    .first();
  if (!accepted) {
    const prior = await c.env.DB.prepare(
      "SELECT processed_at FROM connector_deliveries WHERE provider=? AND delivery_id=?",
    )
      .bind(target, deliveryKey)
      .first<{ processed_at: string | null }>();
    if (prior?.processed_at) return c.json({ received: true, duplicate: true });
    throw new ApiError(
      503,
      "DELIVERY_IN_PROGRESS",
      "This event is still being processed. Retry this delivery.",
    );
  }
  try {
    const all = await c.env.DB.prepare(
      "SELECT * FROM connector_connections WHERE provider=? AND status!='disconnected'",
    )
      .bind(target)
      .all<ConnectionRow>();
    for (const row of all.results) {
      if (subscription && subscription.connection_id !== row.id) continue;
      if (
        target === "notion" &&
        !subscription &&
        payload.workspace_id !== row.account_id
      )
        continue;
      if (target === "github") {
        const installation = payload.installation as
          { id?: number } | undefined;
        const credentials = await openCredentials(
          c.env,
          row.id,
          row.credential,
        );
        if (
          !installation ||
          String(installation.id) !== credentials.installationId
        )
          continue;
        const event = c.req.header("X-GitHub-Event");
        if (
          event === "installation" &&
          (payload.action === "deleted" || payload.action === "suspend")
        ) {
          await c.env.DB.prepare(
            "UPDATE connector_connections SET generation=generation+1,lease_token=NULL,lease_until=NULL,status='attention',error='Access to this source changed. Reconnect to restore access.',next_sync_at=NULL WHERE id=? AND owner_id=?",
          )
            .bind(row.id, row.owner_id)
            .run();
          await sourceVisibility(c.env, row, false);
          continue;
        }
        if (
          event === "installation_repositories" &&
          Array.isArray(payload.repositories_removed)
        ) {
          const removed = new Set(
            payload.repositories_removed.map((repo) =>
              String((repo as { id?: number }).id),
            ),
          );
          const selections =
            (JSON.parse(row.config) as { selections?: Array<{ id: string }> })
              .selections || [];
          if (selections.some((item) => removed.has(item.id))) {
            await c.env.DB.prepare(
              "UPDATE connector_connections SET generation=generation+1,lease_token=NULL,lease_until=NULL,status='attention',error='Access to this source changed. Check selected repositories.',cursor='{}' WHERE id=? AND owner_id=?",
            )
              .bind(row.id, row.owner_id)
              .run();
            await sourceVisibility(c.env, row, false);
          }
        }
      }
      if (row.status === "paused") continue;
      await c.env.DB.prepare(
        "UPDATE connector_connections SET next_sync_at=? WHERE id=? AND owner_id=?",
      )
        .bind(now(), row.id, row.owner_id)
        .run();
    }
    await c.env.DB.prepare(
      "UPDATE connector_deliveries SET processed_at=? WHERE provider=? AND delivery_id=?",
    )
      .bind(now(), target, deliveryKey)
      .run();
  } catch (error) {
    await c.env.DB.prepare(
      "DELETE FROM connector_deliveries WHERE provider=? AND delivery_id=? AND processed_at IS NULL",
    )
      .bind(target, deliveryKey)
      .run();
    throw error;
  }
  await c.env.DB.prepare("DELETE FROM connector_deliveries WHERE received_at<?")
    .bind(new Date(Date.now() - 7 * 86400_000).toISOString())
    .run();
  return c.json({ received: true });
}
webhooks.post("/:provider", receive);
webhooks.post("/:provider/:subscriptionId", receive);
export { webhooks as connectorWebhooks };
