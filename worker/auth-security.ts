import { ApiError, type Env } from "./env";

const encoder = new TextEncoder();
export async function authDigest(env: Env, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.BETTER_AUTH_SECRET!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function registrationCookieName(env: Env) {
  return env.ENVIRONMENT === "local"
    ? "work-registration"
    : "__Host-work-registration";
}

export function registrationCookie(env: Env, request?: Request) {
  const name = registrationCookieName(env);
  return (
    (request?.headers.get("Cookie") || "")
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`))
      ?.slice(name.length + 1) || ""
  );
}

export async function requireRegistrationProof(
  env: Env,
  email: string,
  request?: Request,
) {
  const token = registrationCookie(env, request);
  const user = await env.DB.prepare(
    "SELECT registration_proof,email_verified FROM user WHERE email=?",
  )
    .bind(email)
    .first<{ registration_proof: string; email_verified: number }>();
  if (
    !token ||
    !user ||
    user.email_verified ||
    !user.registration_proof ||
    user.registration_proof !== (await authDigest(env, `registration:${token}`))
  )
    throw new ApiError(
      400,
      "REGISTRATION_EXPIRED",
      "Start again to create your account, or use Forgot password to recover an existing registration.",
    );
}

async function takeLimit(
  env: Env,
  key: string,
  maximum: number,
  seconds: number,
) {
  const timestamp = Date.now();
  const result = await env.DB.prepare(
    "INSERT INTO auth_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING count,expires_at",
  )
    .bind(key, timestamp + seconds * 1000, timestamp, timestamp)
    .first<{ count: number; expires_at: number }>();
  if (!result || result.count > maximum)
    throw new ApiError(
      429,
      "AUTH_RATE_LIMIT",
      "Too many attempts. Please wait before trying again.",
      {
        retryAfter: Math.max(
          1,
          Math.ceil(
            ((result?.expires_at || timestamp + 60_000) - timestamp) / 1000,
          ),
        ),
      },
    );
}

export async function limitAuthRequest(
  env: Env,
  path: string,
  email: string,
  ip: string,
) {
  const principal = await authDigest(env, `email:${email}`);
  const address = await authDigest(env, `ip:${ip}`);
  if (path === "/sign-in/email") {
    await takeLimit(env, `login:${principal}`, 15, 600);
    return;
  }
  const sending = [
    "/sign-up/email",
    "/email-otp/send-verification-otp",
    "/email-otp/request-password-reset",
  ].includes(path);
  if (sending) {
    const purpose =
      path === "/email-otp/request-password-reset" ? "reset" : "verify";
    await takeLimit(env, `cooldown:${purpose}:${principal}`, 1, 60);
    await takeLimit(env, `send:${principal}`, 10, 3600);
    await takeLimit(env, `send-ip:${address}`, 30, 3600);
    await takeLimit(env, "send-global", 500, 86400);
  } else {
    await takeLimit(env, `verify:${principal}`, 10, 600);
  }
}
