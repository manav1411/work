import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/auth-schema";
import type { SessionResponse } from "../shared/model";
import { ApiError, type Env } from "./env";

export function localAuthAllowed(env: Env, request: Request): boolean {
  const host = new URL(request.url).hostname;
  return (
    env.ENVIRONMENT === "local" &&
    env.LOCAL_DEV_AUTH === "true" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(host)
  );
}
export function authConfigured(env: Env): boolean {
  return Boolean(
    env.BETTER_AUTH_SECRET &&
    env.BETTER_AUTH_SECRET.length >= 32 &&
    env.GITHUB_CLIENT_ID &&
    env.GITHUB_CLIENT_SECRET &&
    env.OWNER_GITHUB_LOGIN &&
    env.APP_ORIGIN,
  );
}
export function allowedIdentity(
  env: Env,
  githubId: unknown,
  githubLogin: unknown,
): boolean {
  if (
    typeof githubId !== "string" ||
    !/^[1-9]\d*$/.test(githubId) ||
    typeof githubLogin !== "string"
  )
    return false;
  return env.OWNER_GITHUB_ID
    ? githubId === env.OWNER_GITHUB_ID
    : githubLogin.toLowerCase() === env.OWNER_GITHUB_LOGIN.toLowerCase();
}

export function createAuth(env: Env) {
  if (!authConfigured(env))
    throw new ApiError(
      503,
      "AUTH_NOT_CONFIGURED",
      "GitHub sign-in is not configured yet.",
    );
  const db = drizzle(env.DB, { schema });
  return betterAuth({
    appName: "Work",
    baseURL: env.APP_ORIGIN,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema,
      transaction: false,
    }),
    trustedOrigins: [env.APP_ORIGIN],
    emailAndPassword: { enabled: false },
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID!,
        clientSecret: env.GITHUB_CLIENT_SECRET!,
        scope: ["read:user", "user:email"],
        mapProfileToUser: async (profile) => {
          const githubId = String(profile.id);
          if (!allowedIdentity(env, githubId, profile.login))
            throw new APIError("FORBIDDEN", {
              message:
                "This workspace is currently available to its owner only.",
            });
          return { githubId, githubLogin: profile.login };
        },
      },
    },
    user: {
      additionalFields: {
        githubId: { type: "string", required: true, input: false },
        githubLogin: { type: "string", required: true, input: false },
      },
    },
    account: { accountLinking: { enabled: false } },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    advanced: {
      useSecureCookies: env.ENVIRONMENT !== "local",
      crossSubDomainCookies: { enabled: false },
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: env.ENVIRONMENT !== "local",
        path: "/",
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!allowedIdentity(env, user.githubId, user.githubLogin))
              throw new APIError("FORBIDDEN", {
                message: "Registration is restricted to the workspace owner.",
              });
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const user = await env.DB.prepare(
              "SELECT github_id, github_login FROM user WHERE id=?",
            )
              .bind(session.userId)
              .first<{ github_id: string; github_login: string }>();
            if (
              !user ||
              !allowedIdentity(env, user.github_id, user.github_login)
            )
              throw new APIError("FORBIDDEN", {
                message: "This account does not have access to the workspace.",
              });
          },
        },
      },
    },
    logger: { disabled: true },
  });
}

export async function resolveSession(
  env: Env,
  request: Request,
): Promise<SessionResponse> {
  if (localAuthAllowed(env, request)) {
    const timestamp = Date.now();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO user(id,name,email,email_verified,created_at,updated_at,github_id,github_login) VALUES(?,?,?,?,?,?,?,?)",
    )
      .bind(
        "local-manav",
        "Manav",
        "local@example.invalid",
        0,
        timestamp,
        timestamp,
        "local",
        env.OWNER_GITHUB_LOGIN,
      )
      .run();
    return {
      user: {
        id: "local-manav",
        name: "Manav",
        email: "local@example.invalid",
      },
      local: true,
      configured: true,
    };
  }
  if (!authConfigured(env))
    return { user: null, local: false, configured: false };
  const session = await createAuth(env).api.getSession({
    headers: request.headers,
  });
  if (
    !session ||
    !allowedIdentity(env, session.user.githubId, session.user.githubLogin)
  )
    return { user: null, local: false, configured: true };
  return {
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image,
    },
    local: false,
    configured: true,
  };
}
