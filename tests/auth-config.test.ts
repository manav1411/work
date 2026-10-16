import { describe, expect, it } from "vitest";
import { authConfigured, localAuthAllowed } from "../worker/auth";
import { authMailConfigured } from "../worker/auth-mail";
import type { Env } from "../worker/env";
const base = {
  ENVIRONMENT: "production",
  BETTER_AUTH_SECRET: "synthetic-secret-with-at-least-32-characters",
  APP_ORIGIN: "https://work.example.invalid",
} as Env;
describe("email authentication configuration", () => {
  it("does not need OAuth credentials or an allowlist and fails closed without a secret", () => {
    expect(authConfigured(base)).toBe(true);
    expect(authConfigured({ ...base, BETTER_AUTH_SECRET: undefined })).toBe(
      false,
    );
    expect(authConfigured({ ...base, BETTER_AUTH_SECRET: "short" })).toBe(
      false,
    );
  });
  it("requires a protected HTTPS sender outside local development", () => {
    const configured = {
      ...base,
      AUTH_MAILER_URL: "https://mailer.example.invalid",
      AUTH_MAILER_TOKEN: "synthetic-mailer-token-at-least-32-characters",
      AUTH_MAIL_FROM: "accounts@example.invalid",
      AUTH_MAILER_ACCESS_CLIENT_ID: "synthetic-access-id",
      AUTH_MAILER_ACCESS_CLIENT_SECRET: "synthetic-access-secret",
    };
    expect(authMailConfigured(configured)).toBe(true);
    for (const url of [
      "http://mailer.example.invalid",
      "https://user:pass@mailer.example.invalid",
      "https://mailer.example.invalid?token=unsafe",
      "https://mailer.example.invalid/emails",
    ])
      expect(authMailConfigured({ ...configured, AUTH_MAILER_URL: url })).toBe(
        false,
      );
    expect(
      authMailConfigured({
        ...configured,
        AUTH_MAILER_ACCESS_CLIENT_SECRET: undefined,
      }),
    ).toBe(false);
    expect(
      authMailConfigured({
        ...configured,
        ENVIRONMENT: "local",
        AUTH_MAILER_URL: "http://127.0.0.1:8789",
        AUTH_MAILER_ACCESS_CLIENT_SECRET: undefined,
      }),
    ).toBe(true);
  });
  it("confines synthetic development accounts to loopback in local environments", () => {
    for (const environment of ["staging", "production"] as const)
      expect(
        localAuthAllowed(
          { ...base, ENVIRONMENT: environment, LOCAL_DEV_AUTH: "true" },
          new Request("http://localhost/"),
        ),
      ).toBe(false);
    expect(
      localAuthAllowed(
        { ...base, ENVIRONMENT: "local", LOCAL_DEV_AUTH: "true" },
        new Request("http://localhost/"),
      ),
    ).toBe(true);
    expect(
      localAuthAllowed(
        { ...base, ENVIRONMENT: "local", LOCAL_DEV_AUTH: "true" },
        new Request(base.APP_ORIGIN),
      ),
    ).toBe(false);
  });
});
