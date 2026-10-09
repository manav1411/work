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
import { app } from "../worker";
import type { Env } from "../worker/env";

// Exercise the complete provider callback, not only the mapper or a manually
// seeded session. Every provider profile/token and database here is synthetic.
let miniflare: Miniflare;
let env: Env;
const nativeFetch = globalThis.fetch;
let profile = {
  id: 12345,
  login: "synthetic-owner",
  name: "Synthetic Owner",
  email: "owner@example.invalid",
  avatar_url: "https://avatars.example.invalid/owner",
};
const migration = [
  "0001_workspace.sql",
  "0009_current_workspace.sql",
  "0010_goal_actions.sql",
]
  .map((filename) =>
    readFileSync(new URL(`../migrations/${filename}`, import.meta.url), "utf8"),
  )
  .join("\n");

function cookies(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
}

async function request(
  path: string,
  method = "GET",
  body?: unknown,
  cookie = "",
) {
  const headers = new Headers({ Origin: env.APP_ORIGIN });
  if (cookie) headers.set("Cookie", cookie);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return app.fetch(
    new Request(`${env.APP_ORIGIN}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
}

async function callback() {
  const started = await request("/api/auth/sign-in/social", "POST", {
    provider: "github",
    callbackURL: `${env.APP_ORIGIN}/today`,
  });
  expect(started.status).toBe(200);
  const authorization = new URL(
    ((await started.json()) as { url: string }).url,
  );
  const state = authorization.searchParams.get("state");
  expect(state).toBeTruthy();
  expect(authorization.searchParams.get("redirect_uri")).toBe(
    `${env.APP_ORIGIN}/api/auth/callback/github`,
  );
  return request(
    `/api/auth/callback/github?code=synthetic-authorization-code&state=${encodeURIComponent(state!)}`,
    "GET",
    undefined,
    cookies(started),
  );
}

beforeAll(async () => {
  miniflare = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch() { return new Response("test"); } };',
      compatibilityDate: "2026-10-01",
      d1Databases: ["DB"],
      r2Buckets: ["FILES"],
    }),
  );
  env = {
    DB: (await miniflare.getD1Database("DB")) as unknown as D1Database,
    FILES: (await miniflare.getR2Bucket("FILES")) as unknown as R2Bucket,
    ENVIRONMENT: "production",
    ALLOWED_GITHUB_USERS: '[{"login":"synthetic-owner","id":"12345"}]',
    APP_ORIGIN: "https://work-callback.example.invalid",
    BETTER_AUTH_SECRET: "synthetic-callback-secret-with-at-least-32-characters",
    GITHUB_CLIENT_ID: "synthetic-callback-client",
    GITHUB_CLIENT_SECRET: "synthetic-callback-client-secret",
  };
  await env.DB.exec(migration.replace(/--[^\n]*/g, "").replace(/\n/g, " "));
}, 30_000);

beforeEach(async () => {
  env.ALLOWED_GITHUB_USERS = '[{"login":"synthetic-owner","id":"12345"}]';
  await env.DB.batch([
    env.DB.prepare("DELETE FROM user"),
    env.DB.prepare("DELETE FROM verification"),
    env.DB.prepare("DELETE FROM rate_limits"),
  ]);
  profile = {
    id: 12345,
    login: "synthetic-owner",
    name: "Synthetic Owner",
    email: "owner@example.invalid",
    avatar_url: "https://avatars.example.invalid/owner",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.href === "https://github.com/login/oauth/access_token")
        return Response.json({
          access_token: "synthetic-github-access-token",
          token_type: "bearer",
          scope: "read:user,user:email",
        });
      if (url.href === "https://api.github.com/user")
        return Response.json(profile);
      if (url.href === "https://api.github.com/user/emails")
        return Response.json([
          { email: profile.email, primary: true, verified: true },
        ]);
      // Miniflare's loopback transport stays real; unmocked external requests fail.
      if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
        return nativeFetch(input, init);
      throw new Error(
        `Unexpected external request to ${url.origin}${url.pathname}`,
      );
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await miniflare?.dispose();
}, 30_000);

describe("verified GitHub OAuth callbacks", () => {
  it("creates the owner, provider account and usable secure session through the real callback", async () => {
    const completed = await callback();
    expect(completed.status).toBe(302);
    expect(completed.headers.get("Location")).toBe(`${env.APP_ORIGIN}/today`);
    const sessionCookie = completed.headers
      .getSetCookie()
      .find((cookie) =>
        cookie.startsWith("__Secure-better-auth.session_token="),
      );
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie).toContain("Secure");
    const user = await env.DB.prepare(
      "SELECT id,github_id,github_login FROM user",
    ).first<{ id: string; github_id: string; github_login: string }>();
    expect(user).toMatchObject({
      github_id: "12345",
      github_login: "synthetic-owner",
    });
    const account = await env.DB.prepare(
      "SELECT user_id,provider_id,account_id FROM account",
    ).first<{ user_id: string; provider_id: string; account_id: string }>();
    expect(account).toEqual({
      user_id: user!.id,
      provider_id: "github",
      account_id: "12345",
    });
    const session = await request(
      "/api/session",
      "GET",
      undefined,
      cookies(completed),
    );
    expect(await session.json()).toMatchObject({
      user: { id: user!.id },
      local: false,
      configured: true,
    });
    expect(
      (await request("/api/records", "GET", undefined, cookies(completed)))
        .status,
    ).toBe(200);
  });

  it("rejects a non-owner immutable GitHub ID even when its login matches the configured owner", async () => {
    profile = { ...profile, id: 67890 };
    const completed = await callback();
    expect([302, 403]).toContain(completed.status);
    if (completed.status === 302)
      expect(
        new URL(completed.headers.get("Location")!).searchParams.has("error"),
      ).toBe(true);
    expect(
      completed.headers
        .getSetCookie()
        .some((cookie) =>
          cookie.startsWith("__Secure-better-auth.session_token="),
        ),
    ).toBe(false);
    for (const table of ["user", "account", "session"]) {
      expect(
        await env.DB.prepare(`SELECT count(*) AS count FROM ${table}`).first<{
          count: number;
        }>(),
      ).toEqual({ count: 0 });
    }
    expect(
      await (
        await request("/api/session", "GET", undefined, cookies(completed))
      ).json(),
    ).toMatchObject({ user: null });
    expect(
      (await request("/api/records", "GET", undefined, cookies(completed)))
        .status,
    ).toBe(401);
  });

  it("does not let an authenticated client overwrite either server-owned GitHub identity field", async () => {
    const completed = await callback();
    expect(completed.status).toBe(302);
    for (const body of [
      { githubId: "67890" },
      { githubLogin: "client-controlled-login" },
    ]) {
      const response = await request(
        "/api/auth/update-user",
        "POST",
        body,
        cookies(completed),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: "FIELD_NOT_ALLOWED",
      });
    }
    expect(
      await env.DB.prepare("SELECT github_id,github_login FROM user").first<{
        github_id: string;
        github_login: string;
      }>(),
    ).toEqual({ github_id: "12345", github_login: "synthetic-owner" });
    expect(
      await (
        await request("/api/session", "GET", undefined, cookies(completed))
      ).json(),
    ).toMatchObject({ user: expect.any(Object) });
  });

  it("allows a second listed account and rejects an unlisted account before creating any auth rows", async () => {
    env.ALLOWED_GITHUB_USERS = JSON.stringify([
      { login: "synthetic-owner", id: "12345" },
      { login: "synthetic-invitee", id: "67890" },
    ]);
    profile = {
      ...profile,
      id: 67890,
      login: "synthetic-invitee",
      email: "invitee@example.invalid",
    };
    const accepted = await callback();
    expect(accepted.headers.get("Location")).toBe(`${env.APP_ORIGIN}/today`);
    expect(
      (await request("/api/records", "GET", undefined, cookies(accepted)))
        .status,
    ).toBe(200);

    profile = {
      ...profile,
      id: 99999,
      login: "unlisted-user",
      email: "unlisted@example.invalid",
    };
    const rejected = await callback();
    expect(rejected.headers.get("Location")).not.toBe(
      `${env.APP_ORIGIN}/today`,
    );
    for (const table of ["user", "account", "session"]) {
      expect(
        await env.DB.prepare(`SELECT count(*) AS count FROM ${table}`).first(),
      ).toEqual({ count: 1 });
    }
  });

  it("revokes existing sessions and repeat sign-in after removal from the list", async () => {
    const accepted = await callback();
    expect(accepted.headers.get("Location")).toBe(`${env.APP_ORIGIN}/today`);
    env.ALLOWED_GITHUB_USERS = '[{"login":"another-user","id":"67890"}]';
    expect(
      await (
        await request("/api/session", "GET", undefined, cookies(accepted))
      ).json(),
    ).toMatchObject({ user: null });
    expect(
      (await request("/api/records", "GET", undefined, cookies(accepted)))
        .status,
    ).toBe(401);
    const rejected = await callback();
    expect(rejected.headers.get("Location")).not.toBe(
      `${env.APP_ORIGIN}/today`,
    );
    expect(
      await env.DB.prepare("SELECT count(*) AS count FROM session").first(),
    ).toEqual({ count: 1 });
  });

  it("reuses the same owner account on repeat sign-in after a GitHub login rename", async () => {
    const first = await callback();
    expect(first.status).toBe(302);
    const firstUser = await env.DB.prepare("SELECT id FROM user").first<{
      id: string;
    }>();
    profile = { ...profile, login: "renamed-synthetic-owner" };
    const second = await callback();
    expect(second.status).toBe(302);
    expect(second.headers.get("Location")).toBe(`${env.APP_ORIGIN}/today`);
    expect(
      await env.DB.prepare("SELECT count(*) AS count FROM user").first<{
        count: number;
      }>(),
    ).toEqual({ count: 1 });
    expect(
      await env.DB.prepare("SELECT count(*) AS count FROM account").first<{
        count: number;
      }>(),
    ).toEqual({ count: 1 });
    expect(
      await (
        await request("/api/session", "GET", undefined, cookies(second))
      ).json(),
    ).toMatchObject({ user: { id: firstUser!.id } });
  });
});
