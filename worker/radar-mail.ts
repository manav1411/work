import { symmetricEncrypt, symmetricDecrypt } from "better-auth/crypto";
import {
  nextRadarDate,
  profileMatches,
  type RadarConfig,
} from "../shared/radar";
import { authMailConfigured } from "./auth-mail";
import { ApiError, id, now, type Env } from "./env";
import {
  opportunityFromRow,
  radarConfig,
  type OpportunityRow,
} from "./radar-store";
import { epochDatabase } from "./workspace-epoch";

export async function digestCandidates(
  env: Env,
  owner: string,
  config: RadarConfig,
  since: string | null,
) {
  const rows = await env.DB.prepare(
    "SELECT o.* FROM radar_opportunities o WHERE owner_id=? AND saved=0 AND dismissed=0 AND tracked=0 AND notified=0 AND first_seen_at>=? AND NOT EXISTS(SELECT 1 FROM radar_delivery_items i WHERE i.owner_id=o.owner_id AND i.opportunity_id=o.id) ORDER BY interest DESC,first_seen_at DESC,id LIMIT 300",
  )
    .bind(owner, since || now())
    .all<OpportunityRow>();
  return rows.results
    .map(opportunityFromRow)
    .filter((o) => config.profiles.some((p) => profileMatches(o, p)))
    .slice(0, 15);
}
export async function enqueueRadarDigest(
  env: Env,
  owner: string,
  manual = false,
) {
  const settings = await radarConfig(env.DB, owner);
  if (
    !settings.config.enabled ||
    (!manual && settings.config.emailFrequency === "disabled")
  )
    return { queued: false, count: 0 };
  if (!authMailConfigured(env) || !env.BETTER_AUTH_SECRET)
    throw new ApiError(
      503,
      "EMAIL_UNAVAILABLE",
      "Configure the private Work sender before enabling Radar email.",
    );
  const user = await env.DB.prepare(
    "SELECT email,email_verified FROM user WHERE id=?",
  )
    .bind(owner)
    .first<{ email: string; email_verified: number }>();
  if (!user?.email_verified)
    throw new ApiError(
      400,
      "EMAIL_UNVERIFIED",
      "Verify your account email before enabling Radar email.",
    );
  const active = await env.DB.prepare(
    "SELECT id FROM radar_deliveries WHERE owner_id=? AND status IN ('queued','sending','uncertain')",
  )
    .bind(owner)
    .first<{ id: string }>();
  if (active) return { queued: false, count: 0, id: active.id };
  const jobs = await digestCandidates(
    env,
    owner,
    settings.config,
    settings.emailSince || (manual ? new Date(0).toISOString() : null),
  );
  if (!jobs.length) return { queued: false, count: 0 };
  const deliveryId = id(),
    expiresAt = Date.now() + 3600000;
  const state = await env.DB.prepare(
    "SELECT epoch FROM workspace_state WHERE owner_id=?",
  )
    .bind(owner)
    .first<{ epoch: string }>();
  if (!state) return { queued: false, count: 0 };
  const payload = await symmetricEncrypt({
    key: env.BETTER_AUTH_SECRET,
    data: JSON.stringify({
      id: deliveryId,
      email: user.email,
      type: "radar-digest",
      from: env.AUTH_MAIL_FROM,
      expiresAt,
      appUrl: `${env.APP_ORIGIN}/applications?tab=radar`,
      items: jobs.map((job) => ({
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.locations.join(" · ").slice(0, 500),
        salary:
          job.salary?.text ||
          (job.salary && (job.salary.min !== null || job.salary.max !== null)
            ? `${job.salary.currency} ${job.salary.min ?? "?"}–${job.salary.max ?? "?"} / ${job.salary.period}`
            : "Not listed"),
        interest: job.assessment
          ? `${Math.round(job.assessment.interest)}/100`
          : "Awaiting assessment",
        qualification:
          job.assessment?.qualification == null
            ? "Not enough information"
            : `${Math.round(job.assessment.qualification)}/100`,
        publisher: job.sources[0].publisher,
        url: job.sources[0].url,
      })),
    }),
  });
  const guard = id(),
    db = epochDatabase(env.DB, owner, state.epoch);
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO write_guards(id,value) SELECT ?,EXISTS(SELECT 1 FROM radar_settings WHERE owner_id=? AND version=? AND json_extract(payload,'$.enabled')=1)",
        )
        .bind(guard, owner, settings.version),
      db.prepare("DELETE FROM write_guards WHERE id=?").bind(guard),
      db
        .prepare(
          "INSERT INTO radar_deliveries(id,owner_id,epoch,payload,created_at,expires_at,config_version) VALUES(?,?,?,?,?,?,?)",
        )
        .bind(
          deliveryId,
          owner,
          state.epoch,
          payload,
          now(),
          expiresAt,
          settings.version,
        ),
      ...jobs.flatMap((job) => [
        db
          .prepare(
            "INSERT INTO write_guards(id,value) SELECT ?,EXISTS(SELECT 1 FROM radar_opportunities WHERE owner_id=? AND id=? AND saved=0 AND tracked=0 AND dismissed=0 AND notified=0)",
          )
          .bind(guard, owner, job.id),
        db.prepare("DELETE FROM write_guards WHERE id=?").bind(guard),
        db
          .prepare(
            "INSERT INTO radar_delivery_items(delivery_id,owner_id,opportunity_id) VALUES(?,?,?)",
          )
          .bind(deliveryId, owner, job.id),
      ]),
    ]);
  } catch {
    return { queued: false, count: 0 };
  }
  return { queued: true, count: jobs.length, id: deliveryId };
}
export async function drainRadarMail(env: Env) {
  if (!authMailConfigured(env) || !env.BETTER_AUTH_SECRET) return;
  // Authentication mail retains priority. Digest work never borrows the auth outbox.
  const auth = await env.DB.prepare(
    "SELECT id FROM auth_mail WHERE delivered_at IS NULL AND expires_at>? LIMIT 1",
  )
    .bind(Date.now())
    .first();
  if (auth) return;
  const rows = await env.DB.prepare(
    "UPDATE radar_deliveries SET status='sending',lease_until=?,attempts=attempts+1 WHERE id IN (SELECT id FROM radar_deliveries WHERE status IN ('queued','sending') AND next_attempt_at<=? AND lease_until<=? AND expires_at>? AND attempts<4 ORDER BY created_at LIMIT 1) RETURNING *",
  )
    .bind(Date.now() + 60000, Date.now(), Date.now(), Date.now() + 30000)
    .all<{
      id: string;
      owner_id: string;
      epoch: string;
      payload: string;
      attempts: number;
      config_version: number;
    }>();
  for (const row of rows.results) {
    const settings = await radarConfig(env.DB, row.owner_id);
    const state = await env.DB.prepare(
      "SELECT epoch FROM workspace_state WHERE owner_id=?",
    )
      .bind(row.owner_id)
      .first<{ epoch: string }>();
    const changed = await env.DB.prepare(
      "SELECT 1 FROM radar_delivery_items i JOIN radar_opportunities o ON o.owner_id=i.owner_id AND o.id=i.opportunity_id WHERE i.delivery_id=? AND (o.saved=1 OR o.dismissed=1 OR o.tracked=1 OR json_extract(o.payload,'$.closed')=1) LIMIT 1",
    )
      .bind(row.id)
      .first();
    if (
      !settings.config.enabled ||
      settings.version !== row.config_version ||
      state?.epoch !== row.epoch ||
      changed
    ) {
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE radar_deliveries SET status='cancelled',payload='' WHERE id=?",
        ).bind(row.id),
        env.DB.prepare(
          "DELETE FROM radar_delivery_items WHERE delivery_id=?",
        ).bind(row.id),
      ]);
      continue;
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${env.AUTH_MAILER_TOKEN}`,
      "Content-Type": "application/json",
    };
    if (env.AUTH_MAILER_ACCESS_CLIENT_ID)
      headers["CF-Access-Client-Id"] = env.AUTH_MAILER_ACCESS_CLIENT_ID;
    if (env.AUTH_MAILER_ACCESS_CLIENT_SECRET)
      headers["CF-Access-Client-Secret"] = env.AUTH_MAILER_ACCESS_CLIENT_SECRET;
    try {
      const payload = await symmetricDecrypt({
        key: env.BETTER_AUTH_SECRET,
        data: row.payload,
      });
      const response = await fetch(
        new URL("/radar-digests", env.AUTH_MAILER_URL),
        {
          method: "POST",
          headers,
          body: payload,
          redirect: "manual",
          signal: AbortSignal.timeout(12000),
        },
      );
      if (response.status === 202) {
        const result = (await response.json()) as { state?: string };
        if (result.state === "uncertain") {
          await env.DB.prepare(
            "UPDATE radar_deliveries SET status='uncertain',lease_until=0 WHERE id=?",
          )
            .bind(row.id)
            .run();
          continue;
        }
        await epochDatabase(env.DB, row.owner_id, row.epoch).batch([
          env.DB.prepare(
            "UPDATE radar_opportunities SET notified=1,version=version+1 WHERE owner_id=? AND id IN (SELECT opportunity_id FROM radar_delivery_items WHERE delivery_id=?)",
          ).bind(row.owner_id, row.id),
          env.DB.prepare(
            "UPDATE radar_deliveries SET status='accepted',payload='',lease_until=0 WHERE id=?",
          ).bind(row.id),
        ]);
      } else {
        await response.body?.cancel();
        // Explicit refusals can be retried under the same ID. A missing sender deployment is visible.
        await env.DB.prepare(
          "UPDATE radar_deliveries SET status=?,next_attempt_at=?,lease_until=0 WHERE id=?",
        )
          .bind(
            response.status === 503 && row.attempts < 4 ? "queued" : "failed",
            Date.now() + 60000 * row.attempts,
            row.id,
          )
          .run();
      }
    } catch {
      await env.DB.prepare(
        "UPDATE radar_deliveries SET status='uncertain',lease_until=0 WHERE id=?",
      )
        .bind(row.id)
        .run();
    }
  }
}
export async function scheduleRadarMail(env: Env) {
  const rows = await env.DB.prepare(
    "SELECT owner_id,payload FROM radar_settings WHERE next_email_at<=? AND json_extract(payload,'$.enabled')=1 AND json_extract(payload,'$.emailFrequency')!='disabled' LIMIT 5",
  )
    .bind(now())
    .all<{ owner_id: string; payload: string }>();
  for (const row of rows.results) {
    const c = JSON.parse(row.payload) as RadarConfig;
    try {
      await enqueueRadarDigest(env, row.owner_id);
    } catch {
      /* Delivery state remains inspectable, no empty email is sent. */
    }
    await env.DB.prepare(
      "UPDATE radar_settings SET next_email_at=? WHERE owner_id=? AND payload=?",
    )
      .bind(
        nextRadarDate(
          c.emailFrequency,
          c.timezone,
          c.emailTime,
          c.emailWeekday,
          c.emailMonthday,
        ),
        row.owner_id,
        row.payload,
      )
      .run();
  }
  await drainRadarMail(env);
  await env.DB.prepare(
    "UPDATE radar_deliveries SET status='expired',payload='' WHERE expires_at<=? AND status IN ('queued','sending')",
  )
    .bind(Date.now())
    .run();
}
