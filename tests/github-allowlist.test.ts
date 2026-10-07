import { describe, expect, it } from "vitest";
import { allowedIdentity, authConfigured } from "../worker/auth";
import type { Env } from "../worker/env";

const configured = {
  BETTER_AUTH_SECRET: "synthetic-secret-with-at-least-32-characters",
  GITHUB_CLIENT_ID: "synthetic-client",
  GITHUB_CLIENT_SECRET: "synthetic-client-secret",
  APP_ORIGIN: "https://work.example.invalid",
} as Env;

describe("private GitHub allowlist", () => {
  it("matches login-only entries exactly and case insensitively", () => {
    const env = {
      ...configured,
      ALLOWED_GITHUB_USERS: '[{"login":"Synthetic-User"}]',
    };
    expect(allowedIdentity(env, "12345", "synthetic-user")).toBe(true);
    for (const login of ["synthetic-user-extra", "other-user", "", 12345])
      expect(allowedIdentity(env, "12345", login)).toBe(false);
    for (const id of ["local", "0", "01", "-12345", 12345, undefined])
      expect(allowedIdentity(env, id, "synthetic-user")).toBe(false);
  });

  it("pins IDs without accepting a reused username", () => {
    const env = {
      ...configured,
      ALLOWED_GITHUB_USERS: '[{"login":"synthetic-user","id":"12345"}]',
    };
    expect(allowedIdentity(env, "12345", "renamed-user")).toBe(true);
    expect(allowedIdentity(env, "67890", "synthetic-user")).toBe(false);
  });

  it("denies everyone for missing, malformed, or partially invalid configuration", () => {
    for (const value of [
      undefined,
      "",
      "not json",
      "null",
      "{}",
      '["synthetic-user"]',
      '[{"login":"synthetic-user"},{"login":""}]',
      '[{"login":"synthetic-user","id":12345}]',
      '[{"login":"synthetic-user","id":""}]',
      '[{"login":"synthetic-user","unexpected":true}]',
      '[{"login":"bad--username"}]',
    ]) {
      const env = { ...configured, ALLOWED_GITHUB_USERS: value };
      expect(authConfigured(env)).toBe(false);
      expect(allowedIdentity(env, "12345", "synthetic-user")).toBe(false);
    }
    const empty = { ...configured, ALLOWED_GITHUB_USERS: "[]" };
    expect(authConfigured(empty)).toBe(true);
    expect(allowedIdentity(empty, "12345", "synthetic-user")).toBe(false);
  });
});
