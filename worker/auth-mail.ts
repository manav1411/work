import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { ApiError, type Env } from "./env";

export interface AuthEmail {
  email: string;
  otp: string;
  type: "email-verification" | "forget-password";
}

export function authMailConfigured(env: Env) {
  if (
    !env.AUTH_MAILER_URL ||
    !env.AUTH_MAILER_TOKEN ||
    env.AUTH_MAILER_TOKEN.length < 32 ||
    !env.AUTH_MAIL_FROM ||
    !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(env.AUTH_MAIL_FROM)
  )
    return false;
  try {
    const url = new URL(env.AUTH_MAILER_URL);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      return false;
    if (
      env.ENVIRONMENT === "local" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      return url.protocol === "http:" || url.protocol === "https:";
    return (
      url.protocol === "https:" &&
      Boolean(
        env.AUTH_MAILER_ACCESS_CLIENT_ID &&
        env.AUTH_MAILER_ACCESS_CLIENT_SECRET,
      )
    );
  } catch {
    return false;
  }
}

export async function enqueueAuthEmail(env: Env, mail: AuthEmail) {
  if (!authMailConfigured(env))
    throw new ApiError(
      503,
      "EMAIL_UNAVAILABLE",
      "Email verification is temporarily unavailable. Please try again later.",
    );
  const verification = await env.DB.prepare(
    "SELECT id,expires_at FROM verification WHERE identifier=?",
  )
    .bind(`${mail.type}-otp-${mail.email}`)
    .first<{ id: string; expires_at: number }>();
  if (!verification)
    throw new ApiError(
      503,
      "EMAIL_UNAVAILABLE",
      "Please request a fresh code.",
    );
  const timestamp = Date.now();
  const payload = await symmetricEncrypt({
    key: env.BETTER_AUTH_SECRET!,
    data: JSON.stringify(mail),
  });
  await env.DB.prepare(
    "INSERT INTO auth_mail(id,verification_id,payload,expires_at,next_attempt_at,created_at) VALUES(?,?,?,?,?,?)",
  )
    .bind(
      crypto.randomUUID(),
      verification.id,
      payload,
      verification.expires_at,
      timestamp,
      timestamp,
    )
    .run();
}

// A lease prevents concurrent Worker isolates submitting the same job together.
// The Pi also deduplicates job IDs when a response is lost after SMTP acceptance.
export async function drainAuthMail(env: Env) {
  if (!authMailConfigured(env) || !env.BETTER_AUTH_SECRET) return;
  const timestamp = Date.now();
  const rows = await env.DB.prepare(
    "UPDATE auth_mail SET lease_until=?,attempts=attempts+1 WHERE id IN (SELECT id FROM auth_mail WHERE delivered_at IS NULL AND attempts<6 AND next_attempt_at<=? AND lease_until<=? AND expires_at>? ORDER BY created_at LIMIT 5) RETURNING id,payload,expires_at,attempts",
  )
    .bind(timestamp + 60_000, timestamp, timestamp, timestamp + 60_000)
    .all<{
      id: string;
      payload: string;
      expires_at: number;
      attempts: number;
    }>();
  for (const job of rows.results) {
    try {
      const current = await env.DB.prepare(
        "SELECT id FROM auth_mail WHERE id=? AND expires_at>?",
      )
        .bind(job.id, Date.now() + 60_000)
        .first();
      if (!current) continue;
      const mail = JSON.parse(
        await symmetricDecrypt({
          key: env.BETTER_AUTH_SECRET,
          data: job.payload,
        }),
      ) as AuthEmail;
      const headers = new Headers({
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.AUTH_MAILER_TOKEN}`,
      });
      if (env.AUTH_MAILER_ACCESS_CLIENT_ID)
        headers.set("CF-Access-Client-Id", env.AUTH_MAILER_ACCESS_CLIENT_ID);
      if (env.AUTH_MAILER_ACCESS_CLIENT_SECRET)
        headers.set(
          "CF-Access-Client-Secret",
          env.AUTH_MAILER_ACCESS_CLIENT_SECRET,
        );
      const response = await fetch(new URL("/emails", env.AUTH_MAILER_URL), {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: job.id,
          ...mail,
          from: env.AUTH_MAIL_FROM,
          expiresAt: job.expires_at,
        }),
        signal: AbortSignal.timeout(8000),
        // workerd supports manual/follow, not the browser's "error" mode.
        // A redirect is a non-OK response and never receives these credentials.
        redirect: "manual",
      });
      if (!response.ok) throw new Error("MAIL_SUBMISSION_FAILED");
      await env.DB.prepare(
        "UPDATE auth_mail SET delivered_at=?,payload='',lease_until=0 WHERE id=?",
      )
        .bind(Date.now(), job.id)
        .run();
    } catch {
      // Never log recipient addresses, codes, provider responses, or credentials.
      await env.DB.prepare(
        "UPDATE auth_mail SET lease_until=0,next_attempt_at=? WHERE id=?",
      )
        .bind(Date.now() + Math.min(60_000, 5000 * 2 ** job.attempts), job.id)
        .run();
    }
  }
}

export async function cleanupAuth(env: Env) {
  const timestamp = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_mail WHERE expires_at<=?").bind(timestamp),
    env.DB.prepare("DELETE FROM verification WHERE expires_at<=?").bind(
      timestamp,
    ),
    env.DB.prepare("DELETE FROM auth_limits WHERE expires_at<=?").bind(
      timestamp,
    ),
    env.DB.prepare(
      "DELETE FROM user WHERE email_verified=0 AND github_id='' AND registration_proof!='' AND created_at<?",
    ).bind(timestamp - 86_400_000),
  ]);
}
