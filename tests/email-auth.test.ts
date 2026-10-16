import { readFileSync } from "node:fs";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { symmetricDecrypt } from "better-auth/crypto";
import { app } from "../worker";
import { createAuth } from "../worker/auth";
import { cleanupAuth, drainAuthMail } from "../worker/auth-mail";
import type { Env } from "../worker/env";

let runtime: Miniflare, env: Env;
const email = "new-owner@example.invalid";
const password = "synthetic-password-for-tests";
const nativeFetch = globalThis.fetch;
function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}
async function request(
  path: string,
  body?: unknown,
  cookie = "",
  method = body === undefined ? "GET" : "POST",
) {
  return app.fetch(
    new Request(`${env.APP_ORIGIN}${path}`, {
      method,
      headers: {
        Origin: env.APP_ORIGIN,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    env,
  );
}
async function code(address = email, type = "email-verification") {
  const row = await env.DB.prepare(
    "SELECT value FROM verification WHERE identifier=?",
  )
    .bind(`${type}-otp-${address}`)
    .first<{ value: string }>();
  expect(row).toBeTruthy();
  const value = row!.value.slice(0, row!.value.lastIndexOf(":"));
  return symmetricDecrypt({ key: env.BETTER_AUTH_SECRET!, data: value });
}
async function signup(address = email) {
  const result = await request("/api/auth/sign-up/email", {
    email: address,
    password,
  });
  expect(result.status, await result.clone().text()).toBe(200);
  return cookies(result);
}
async function registered(address = email) {
  const proof = await signup(address);
  const verified = await request(
    "/api/auth/email-otp/verify-email",
    { email: address, otp: await code(address) },
    proof,
  );
  expect(verified.status, await verified.clone().text()).toBe(200);
  return verified;
}
async function login(address = email, secret = password) {
  return request("/api/auth/sign-in/email", {
    email: address,
    password: secret,
  });
}
async function resetRequested(address = email) {
  const result = await request("/api/auth/email-otp/request-password-reset", {
    email: address,
  });
  expect(result.status, await result.clone().text()).toBe(200);
}
async function reset(
  secret = "a-new-synthetic-test-password",
  address = email,
  otp?: string,
) {
  return request("/api/auth/email-otp/reset-password", {
    email: address,
    otp: otp || (await code(address, "forget-password")),
    password: secret,
  });
}
beforeAll(async () => {
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("test")}}',
      compatibilityDate: "2026-10-02",
      d1Databases: ["DB"],
      r2Buckets: ["FILES"],
    }),
  );
  env = {
    DB: (await runtime.getD1Database("DB")) as unknown as D1Database,
    FILES: (await runtime.getR2Bucket("FILES")) as unknown as R2Bucket,
    ENVIRONMENT: "production",
    APP_ORIGIN: "https://work-auth.example.invalid",
    BETTER_AUTH_SECRET: "synthetic-auth-secret-with-at-least-32-characters",
    AUTH_MAILER_URL: "https://mailer.example.invalid",
    AUTH_MAILER_TOKEN: "synthetic-mailer-token-with-at-least-32-characters",
    AUTH_MAILER_ACCESS_CLIENT_ID: "synthetic-access",
    AUTH_MAILER_ACCESS_CLIENT_SECRET: "synthetic-secret",
    AUTH_MAIL_FROM: "accounts@example.invalid",
  };
  for (const name of [
    "0001_workspace.sql",
    "0009_current_workspace.sql",
    "0010_goal_actions.sql",
    "0011_email_auth.sql",
    "0012_radar.sql",
  ])
    await env.DB.exec(
      readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8")
        .replace(/--[^\n]*/g, "")
        .replace(/\n/g, " "),
    );
}, 30000);
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM user"),
    env.DB.prepare("DELETE FROM verification"),
    env.DB.prepare("DELETE FROM rate_limits"),
    env.DB.prepare("DELETE FROM auth_limits"),
  ]);
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => runtime?.dispose());

describe("email and password authentication through the real D1 adapter", () => {
  it("guides unknown accounts to sign-up and existing accounts to password recovery", async () => {
    const unknown = await login("unknown@example.invalid");
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toMatchObject({
      error: {
        code: "ACCOUNT_NOT_FOUND",
        message: expect.stringContaining("Sign up"),
      },
    });
    await registered();
    const wrongPassword = await login(email, "wrong-synthetic-password");
    expect(wrongPassword.status).toBe(401);
    expect(await wrongPassword.json()).toMatchObject({
      error: {
        code: "INCORRECT_PASSWORD",
        message: expect.stringContaining("Forgot password"),
      },
    });
  });
  it("registers, verifies, creates a secure cookie session, isolates workspaces, and signs out", async () => {
    const initiated = await request("/api/auth/sign-up/email", {
      email,
      password,
      emailVerified: true,
      githubId: "12345",
      authVersion: 999,
      registrationProof: "client-controlled",
    });
    expect(initiated.status).toBe(200);
    const proof = cookies(initiated);
    expect(proof).toContain("__Host-work-registration=");
    expect((await login()).status).toBe(403);
    const row = await env.DB.prepare(
      "SELECT id,email_verified,github_id,auth_version FROM user WHERE email=?",
    )
      .bind(email)
      .first<{
        id: string;
        email_verified: number;
        github_id: string;
        auth_version: number;
      }>();
    expect(row!.email_verified).toBe(0);
    expect(row!.github_id).toBe("");
    expect(row!.auth_version).not.toBe(999);
    const credential = await env.DB.prepare(
      "SELECT password FROM account WHERE user_id=?",
    )
      .bind(row!.id)
      .first<{ password: string }>();
    expect(credential!.password).not.toBe(password);
    const otp = await code();
    const queued = await env.DB.prepare("SELECT payload FROM auth_mail").first<{
      payload: string;
    }>();
    expect(queued!.payload).not.toContain(otp);
    expect(queued!.payload).not.toContain(email);
    const verified = await request(
      "/api/auth/email-otp/verify-email",
      { email, otp },
      proof,
    );
    expect(verified.status, await verified.clone().text()).toBe(200);
    const signedIn = await login();
    expect(signedIn.status, await signedIn.clone().text()).toBe(200);
    const cookie = cookies(signedIn);
    expect(
      signedIn.headers
        .getSetCookie()
        .some(
          (value) =>
            value.includes("HttpOnly") &&
            value.includes("Secure") &&
            value.includes("SameSite=Lax"),
        ),
    ).toBe(true);
    const session = (await (
      await request("/api/session", undefined, cookie)
    ).json()) as { user: { id: string } };
    expect(session.user.id).toBe(row!.id);
    const workspace = await request("/api/records", undefined, cookie);
    expect(workspace.status).toBe(200);
    const { epoch } = (await workspace.json()) as { epoch: string };
    const created = await app.fetch(
      new Request(`${env.APP_ORIGIN}/api/records`, {
        method: "POST",
        headers: {
          Origin: env.APP_ORIGIN,
          Cookie: cookie,
          "Content-Type": "application/json",
          "X-Workspace-Epoch": epoch,
        },
        body: JSON.stringify({
          kind: "note",
          title: "Private",
          data: { category: "interview-tab" },
        }),
      }),
      env,
    );
    expect(created.status).toBe(201);
    await registered("another-owner@example.invalid");
    const other = await login("another-owner@example.invalid");
    const otherRecords = (await (
      await request("/api/records", undefined, cookies(other))
    ).json()) as { records: unknown[] };
    expect(otherRecords.records).toHaveLength(0);
    expect((await request("/api/auth/sign-out", {}, cookie)).status).toBe(200);
    expect((await request("/api/records", undefined, cookie)).status).toBe(401);
  });

  it("binds verification to the initiating browser and prevents takeover of a preregistered email", async () => {
    const proof = await signup();
    const otp = await code();
    expect(
      (await request("/api/auth/email-otp/verify-email", { email, otp }))
        .status,
    ).toBe(400);
    expect(
      (
        await request("/api/auth/sign-up/email", {
          email,
          password: "attacker-password-123",
        })
      ).status,
    ).toBe(429);
    await env.DB.prepare("DELETE FROM auth_limits").run();
    expect(
      (
        await request("/api/auth/sign-up/email", {
          email,
          password: "attacker-password-123",
        })
      ).status,
    ).toBe(409);
    expect(await code()).toBe(otp);
    // The mailbox owner can recover with a new password without the original browser.
    await resetRequested();
    expect((await reset()).status).toBe(200);
    expect((await login()).status).toBe(401);
    expect((await login(email, "a-new-synthetic-test-password")).status).toBe(
      200,
    );
    expect(
      (await request("/api/auth/email-otp/verify-email", { email, otp }, proof))
        .status,
    ).toBe(400);
  });

  it("rejects expired, incorrect, purpose-mismatched, reused and concurrently consumed codes", async () => {
    const proof = await signup();
    const otp = await code();
    expect(
      (
        await request("/api/auth/email-otp/reset-password", {
          email,
          otp,
          password,
        })
      ).status,
    ).toBe(400);
    await env.DB.prepare("UPDATE verification SET expires_at=?")
      .bind(Date.now() - 1000)
      .run();
    expect(
      (await request("/api/auth/email-otp/verify-email", { email, otp }, proof))
        .status,
    ).toBe(400);
    await env.DB.prepare("DELETE FROM auth_limits").run();
    expect(
      (
        await request(
          "/api/auth/email-otp/send-verification-otp",
          { email, type: "email-verification" },
          proof,
        )
      ).status,
    ).toBe(200);
    const fresh = await code();
    const results = await Promise.all([
      request("/api/auth/email-otp/verify-email", { email, otp: fresh }, proof),
      request("/api/auth/email-otp/verify-email", { email, otp: fresh }, proof),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      (
        await request(
          "/api/auth/email-otp/verify-email",
          { email, otp: fresh },
          proof,
        )
      ).ok,
    ).toBe(false);
  });

  it("invalidates replaced codes and exhausts a challenge after five wrong attempts", async () => {
    const proof = await signup();
    const old = await code();
    expect(
      (
        await request(
          "/api/auth/email-otp/send-verification-otp",
          { email, type: "email-verification" },
          proof,
        )
      ).status,
    ).toBe(429);
    await env.DB.prepare("DELETE FROM auth_limits").run();
    expect(
      (
        await request(
          "/api/auth/email-otp/send-verification-otp",
          { email, type: "email-verification" },
          proof,
        )
      ).status,
    ).toBe(200);
    const current = await code();
    expect(current).not.toBe(old);
    for (let i = 0; i < 5; i++)
      expect(
        (
          await request(
            "/api/auth/email-otp/verify-email",
            { email, otp: old },
            proof,
          )
        ).ok,
      ).toBe(false);
    expect(
      (
        await request(
          "/api/auth/email-otp/verify-email",
          { email, otp: current },
          proof,
        )
      ).ok,
    ).toBe(false);
  });

  it("keeps recovery responses generic and revokes every old session when a password is reset", async () => {
    await registered();
    const first = await login(),
      second = await login();
    const known = await request("/api/auth/email-otp/request-password-reset", {
      email,
    });
    const unknown = await request(
      "/api/auth/email-otp/request-password-reset",
      { email: "missing@example.invalid" },
    );
    expect(known.status).toBe(unknown.status);
    expect(await known.json()).toEqual(await unknown.json());
    const otp = await code(email, "forget-password");
    expect(
      (await reset("a-new-synthetic-test-password", email, otp)).status,
    ).toBe(200);
    for (const cookie of [cookies(first), cookies(second)])
      expect((await request("/api/records", undefined, cookie)).status).toBe(
        401,
      );
    expect((await reset("another-synthetic-password", email, otp)).ok).toBe(
      false,
    );
    expect((await login()).status).toBe(401);
    expect((await login(email, "a-new-synthetic-test-password")).status).toBe(
      200,
    );
  });

  it("rejects session creation from a password check that raced a successful reset", async () => {
    await registered();
    const user = await env.DB.prepare(
      "SELECT id,auth_version FROM user WHERE email=?",
    )
      .bind(email)
      .first<{ id: string; auth_version: number }>();
    const pendingSignIn = createAuth(env, {
      signInVersion: user!.auth_version,
    });
    await resetRequested();
    expect((await reset()).status).toBe(200);
    await expect(
      pendingSignIn.api.signInEmail({
        body: { email, password: "a-new-synthetic-test-password" },
        headers: new Headers({ Origin: env.APP_ORIGIN }),
      }),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(
        "INSERT INTO session(id,token,user_id,expires_at,created_at,updated_at,auth_version) VALUES(?,?,?,?,?,?,?)",
      )
        .bind(
          "stale-session",
          "stale-token",
          user!.id,
          Date.now() + 10000,
          Date.now(),
          Date.now(),
          user!.auth_version,
        )
        .run(),
    ).rejects.toThrow(/STALE_AUTHENTICATION/);
  });

  it("adds a credential to a legacy GitHub owner without changing its user ID or data", async () => {
    const timestamp = Date.now();
    await env.DB.prepare(
      "INSERT INTO user(id,name,email,email_verified,github_id,github_login,created_at,updated_at) VALUES('legacy-owner','Owner',?,0,'12345','synthetic-owner',?,?)",
    )
      .bind(email, timestamp, timestamp)
      .run();
    await env.DB.prepare(
      "INSERT INTO records(id,owner_id,kind,title,created_at,updated_at) VALUES('kept-note','legacy-owner','note','Keep this',?,?)",
    )
      .bind(new Date().toISOString(), new Date().toISOString())
      .run();
    await env.DB.prepare(
      "INSERT INTO account(id,account_id,provider_id,user_id,created_at,updated_at) VALUES('legacy-github','12345','github','legacy-owner',?,?)",
    )
      .bind(timestamp, timestamp)
      .run();
    await resetRequested();
    expect((await reset(password)).status).toBe(200);
    const session = await login();
    expect(session.ok).toBe(true);
    const record = await request(
      "/api/records/kept-note",
      undefined,
      cookies(session),
    );
    expect(record.status).toBe(200);
    expect(
      (
        await env.DB.prepare("SELECT id FROM user WHERE email=?")
          .bind(email)
          .first()
      )?.id,
    ).toBe("legacy-owner");
  });

  it("rolls back password changes if database session revocation fails and allows recovery with a fresh code", async () => {
    await registered();
    const signedIn = await login();
    await resetRequested();
    await env.DB.exec(
      "CREATE TRIGGER simulated_revoke_failure BEFORE DELETE ON session BEGIN SELECT RAISE(ABORT,'TEST_REVOKE_FAILURE'); END;",
    );
    const logging = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await reset()).ok).toBe(false);
      expect(
        logging.mock.calls
          .flat()
          .every((argument) => typeof argument === "string"),
      ).toBe(true);
      expect(logging.mock.calls.flat().join(" ")).not.toMatch(
        /params|DrizzleQueryError|synthetic-password/,
      );
      expect((await login()).ok).toBe(true);
      expect(
        (await request("/api/records", undefined, cookies(signedIn))).status,
      ).toBe(200);
    } finally {
      logging.mockRestore();
      await env.DB.exec("DROP TRIGGER simulated_revoke_failure;");
    }
    await env.DB.prepare("DELETE FROM auth_limits").run();
    await resetRequested();
    expect((await reset()).ok).toBe(true);
    expect(
      (await request("/api/records", undefined, cookies(signedIn))).status,
    ).toBe(401);
  });

  it("retries failed mail submissions, deduplicates jobs and purges sensitive payloads after acceptance", async () => {
    await signup();
    let fail = true;
    const submitted: { otp?: string; id?: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "https://mailer.example.invalid/emails") {
          expect(new Headers(init?.headers).get("Authorization")).toContain(
            "Bearer ",
          );
          if (fail) return new Response("Unavailable", { status: 503 });
          submitted.push(JSON.parse(String(init?.body)));
          return Response.json({ accepted: true });
        }
        return nativeFetch(input, init);
      }),
    );
    await drainAuthMail(env);
    expect(submitted).toHaveLength(0);
    expect(
      (await env.DB.prepare("SELECT payload FROM auth_mail").first())?.payload,
    ).toBeTruthy();
    fail = false;
    await env.DB.prepare("UPDATE auth_mail SET next_attempt_at=0").run();
    await Promise.all([drainAuthMail(env), drainAuthMail(env)]);
    expect(submitted).toHaveLength(1);
    expect(submitted[0].otp).toBe(await code());
    expect(
      (await env.DB.prepare("SELECT payload FROM auth_mail").first())?.payload,
    ).toBe("");
    await drainAuthMail(env);
    expect(submitted).toHaveLength(1);
    await env.DB.prepare("UPDATE verification SET expires_at=0").run();
    await cleanupAuth(env);
    expect(
      (await env.DB.prepare("SELECT count(*) AS n FROM auth_mail").first())?.n,
    ).toBe(0);
  });

  it("rejects alternative authentication paths, unverified sessions, untrusted callbacks, and malformed inputs", async () => {
    for (const path of [
      "/sign-in/social",
      "/sign-in/email-otp",
      "/request-password-reset",
      "/reset-password",
      "/update-user",
      "/change-email",
    ])
      expect(
        (
          await request(`/api/auth${path}`, {
            email,
            password,
            provider: "github",
          })
        ).status,
      ).toBe(404);
    expect(
      (
        await request("/api/auth/sign-up/email", {
          email,
          password,
          callbackURL: "https://attacker.example.invalid",
        })
      ).status,
    ).toBe(403);
    expect(
      (await request("/api/auth/sign-up/email", { email, password: "short" }))
        .status,
    ).toBe(400);
    expect((await request("/api/auth/sign-up/email", [])).status).toBe(400);
    const untrusted = await app.fetch(
      new Request(`${env.APP_ORIGIN}/api/auth/sign-up/email`, {
        method: "POST",
        headers: {
          Origin: "https://attacker.example.invalid",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      }),
      env,
    );
    expect(untrusted.status).toBe(403);
    await signup();
    const user = await env.DB.prepare(
      "SELECT id,auth_version FROM user WHERE email=?",
    )
      .bind(email)
      .first<{ id: string; auth_version: number }>();
    await env.DB.prepare(
      "INSERT INTO session(id,token,user_id,expires_at,created_at,updated_at,auth_version) VALUES('synthetic-unverified','synthetic-unverified-token',?,?,?,?,?)",
    )
      .bind(
        user!.id,
        Date.now() + 10000,
        Date.now(),
        Date.now(),
        user!.auth_version,
      )
      .run();
    await expect(
      createAuth(env, { signInVersion: user!.auth_version }).api.signInEmail({
        body: { email, password },
      }),
    ).rejects.toThrow();
  });
});
