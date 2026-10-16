import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/auth-schema";
import type { SessionResponse } from "../shared/model";
import { ApiError, type Env } from "./env";
import { enqueueAuthEmail } from "./auth-mail";
import { authDigest, requireRegistrationProof } from "./auth-security";

export function localAuthAllowed(env: Env, request: Request): boolean {
  return (
    env.ENVIRONMENT === "local" &&
    env.LOCAL_DEV_AUTH === "true" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname)
  );
}

export function authConfigured(env: Env): boolean {
  return Boolean(
    env.BETTER_AUTH_SECRET &&
    env.BETTER_AUTH_SECRET.length >= 32 &&
    env.APP_ORIGIN,
  );
}

interface AuthRequest {
  request?: Request;
  registrationProof?: string;
  signInVersion?: number;
}

export function createAuth(env: Env, options: AuthRequest = {}) {
  if (!authConfigured(env))
    throw new ApiError(
      503,
      "AUTH_NOT_CONFIGURED",
      "Sign-in is not configured in this environment.",
    );
  return betterAuth({
    appName: "Work",
    baseURL: env.APP_ORIGIN,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(drizzle(env.DB, { schema }), {
      provider: "sqlite",
      schema,
      transaction: false,
    }),
    trustedOrigins: [env.APP_ORIGIN],
    // Distributed counters at the Worker boundary replace per-isolate counters.
    rateLimit: { enabled: false },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      beforeEmailVerification: async (user, request) => {
        try {
          await requireRegistrationProof(
            env,
            user.email,
            request || options.request,
          );
        } catch {
          throw new APIError("BAD_REQUEST", {
            message:
              "This registration has expired. Start again or use Forgot password.",
          });
        }
      },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 5,
        storeOTP: "encrypted",
        resendStrategy: "rotate",
        disableSignUp: true,
        overrideDefaultEmailVerification: true,
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type !== "email-verification" && type !== "forget-password")
            throw new APIError("FORBIDDEN", {
              message: "This authentication method is unavailable.",
            });
          await enqueueAuthEmail(env, { email, otp, type });
        },
      }),
    ],
    user: {
      additionalFields: {
        githubId: {
          type: "string",
          required: false,
          defaultValue: "",
          input: false,
          returned: false,
        },
        githubLogin: {
          type: "string",
          required: false,
          defaultValue: "",
          input: false,
          returned: false,
        },
        registrationProof: {
          type: "string",
          required: false,
          defaultValue: "",
          input: false,
          returned: false,
        },
        authVersion: {
          type: "number",
          required: false,
          defaultValue: 0,
          input: false,
          returned: false,
        },
      },
    },
    account: { accountLinking: { enabled: false } },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
      additionalFields: {
        authVersion: {
          type: "number",
          required: false,
          defaultValue: 0,
          input: false,
          returned: false,
        },
      },
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
            if (!options.registrationProof)
              throw new APIError("FORBIDDEN", {
                message: "Start registration from Work.",
              });
            return {
              data: {
                ...user,
                name: "Account",
                registrationProof: await authDigest(
                  env,
                  `registration:${options.registrationProof}`,
                ),
                authVersion: 0,
              },
            };
          },
        },
      },
      account: {
        create: {
          before: async (account) => {
            if (
              account.providerId !== "credential" ||
              account.accountId !== account.userId
            )
              throw new APIError("FORBIDDEN", {
                message: "Only email and password accounts are supported.",
              });
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const user = await env.DB.prepare(
              "SELECT email_verified,auth_version FROM user WHERE id=?",
            )
              .bind(session.userId)
              .first<{ email_verified: number; auth_version: number }>();
            if (
              !user?.email_verified ||
              options.signInVersion === undefined ||
              options.signInVersion !== user.auth_version
            )
              throw new APIError("UNAUTHORIZED", {
                message: "Please sign in again with your current password.",
              });
            return { data: { ...session, authVersion: options.signInVersion } };
          },
        },
      },
    },
    logger: { disabled: true },
    // The router otherwise prints raw adapter errors, including SQL values.
    // API errors keep their normal response; unexpected errors reach Hono's
    // metadata-only handler instead of the library's console error fallback.
    onAPIError: { throw: true },
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
        "local-dev",
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
  const current =
    session &&
    (await env.DB.prepare(
      "SELECT s.id FROM session s JOIN user u ON u.id=s.user_id WHERE s.id=? AND u.id=? AND u.email_verified=1 AND s.auth_version=u.auth_version AND EXISTS(SELECT 1 FROM account a WHERE a.user_id=u.id AND a.provider_id='credential' AND a.password IS NOT NULL)",
    )
      .bind(session.session.id, session.user.id)
      .first());
  if (!session || !session.user.emailVerified || !current)
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
