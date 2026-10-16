import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { symmetricDecrypt } from "better-auth/crypto";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
const origin = "https://work-auth-runtime.example.invalid";
const secret = "synthetic-built-worker-auth-secret-at-least-32-characters";
const submitted = [];
const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: [
      "index.js",
      ...readdirSync("dist/work/assets")
        .filter((file) => file.endsWith(".js"))
        .map((file) => `assets/${file}`),
    ].map((file) => ({ type: "ESModule", path: resolve("dist/work", file) })),
    modulesRoot: resolve("dist/work"),
    compatibilityDate: "2026-10-02",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: ["DB"],
    r2Buckets: ["FILES"],
    bindings: {
      ENVIRONMENT: "staging",
      APP_ORIGIN: origin,
      BETTER_AUTH_SECRET: secret,
      AUTH_MAILER_URL: "https://mailer.example.invalid",
      AUTH_MAILER_TOKEN: "synthetic-mailer-token-at-least-32-characters",
      AUTH_MAILER_ACCESS_CLIENT_ID: "synthetic-id",
      AUTH_MAILER_ACCESS_CLIENT_SECRET: "synthetic-access-secret",
      AUTH_MAIL_FROM: "accounts@example.invalid",
    },
    outboundService: async (request) => {
      assert.equal(request.url, "https://mailer.example.invalid/emails");
      assert.match(request.headers.get("Authorization") || "", /^Bearer /);
      assert.equal(request.headers.get("CF-Access-Client-Id"), "synthetic-id");
      submitted.push(await request.json());
      return Response.json({ accepted: true }, { status: 202 });
    },
  }),
);
function cookies(response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
}
async function send(path, body, cookie = "") {
  return runtime.dispatchFetch(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: origin,
      Cookie: cookie,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
try {
  const db = await runtime.getD1Database("DB");
  for (const name of [
    "0001_workspace.sql",
    "0009_current_workspace.sql",
    "0010_goal_actions.sql",
    "0011_email_auth.sql",
    "0012_radar.sql",
  ])
    await db.exec(
      readFileSync(`migrations/${name}`, "utf8")
        .replace(/--[^\n]*/g, "")
        .replace(/\n/g, " "),
    );
  async function otp(email, type) {
    const { value } = await db
      .prepare("SELECT value FROM verification WHERE identifier=?")
      .bind(`${type}-otp-${email}`)
      .first();
    return symmetricDecrypt({
      key: secret,
      data: value.slice(0, value.lastIndexOf(":")),
    });
  }
  async function deliveredCode(email) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const message = submitted.find(
        (mail) => mail.email === email && mail.type === "email-verification",
      );
      if (message) return message.otp;
      await new Promise((done) => setTimeout(done, 25));
    }
    console.log(
      "Synthetic sender job state:",
      (
        await db
          .prepare(
            "SELECT attempts,lease_until,next_attempt_at,expires_at FROM auth_mail",
          )
          .all()
      ).results,
    );
    throw new Error(
      "The built Worker's background sender did not submit its synthetic verification email.",
    );
  }
  const started = performance.now();
  // Both password hash creation and verification run inside the bundled workerd
  // runtime, with development fixture auth disabled and no external emails.
  await Promise.all(
    [0, 1].map(async (index) => {
      const email = `runtime-${index}@example.invalid`,
        password = "synthetic-runtime-password-123";
      const signup = await send("/api/auth/sign-up/email", { email, password });
      assert.equal(signup.status, 200, await signup.clone().text());
      const proof = cookies(signup);
      assert.equal(
        (await send("/api/auth/sign-in/email", { email, password })).status,
        403,
      );
      const verify = await send(
        "/api/auth/email-otp/verify-email",
        { email, otp: await deliveredCode(email) },
        proof,
      );
      assert.equal(verify.status, 200, await verify.clone().text());
      const signedIn = await send("/api/auth/sign-in/email", {
        email,
        password,
      });
      assert.equal(signedIn.status, 200, await signedIn.clone().text());
      const cookie = cookies(signedIn);
      assert.ok(
        (await (await send("/api/session", undefined, cookie)).json()).user,
      );
      assert.equal((await send("/api/records", undefined, cookie)).status, 200);
      const request = await send("/api/auth/email-otp/request-password-reset", {
        email,
      });
      assert.equal(request.status, 200);
      const reset = await send("/api/auth/email-otp/reset-password", {
        email,
        otp: await otp(email, "forget-password"),
        password: "another-runtime-password-123",
      });
      assert.equal(reset.status, 200, await reset.clone().text());
      assert.equal((await send("/api/records", undefined, cookie)).status, 401);
      assert.equal(
        (
          await send("/api/auth/sign-in/email", {
            email,
            password: "another-runtime-password-123",
          })
        ).status,
        200,
      );
    }),
  );
  console.log(
    `Built Worker email auth verified: concurrent native password hashing, verification, secure sessions, recovery and revocation (${Math.round(performance.now() - started)} ms).`,
  );
  console.log(
    `Email submissions intercepted locally: ${submitted.length}; no real messages sent. Deployed CPU-tier limits and inbox delivery still require staging validation.`,
  );
} finally {
  await runtime.dispose();
}
