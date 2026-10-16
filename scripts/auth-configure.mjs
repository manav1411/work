import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
const mode = process.argv[2];
if (!["local", "staging", "production"].includes(mode))
  throw new Error("Specify local, staging, or production.");
const path = process.argv[3] || `.private/email-auth-${mode}.json`;
let config;
try {
  config = JSON.parse(readFileSync(path, "utf8"));
} catch {
  throw new Error(
    "Read a valid private email configuration file; its contents were suppressed.",
  );
}
const allowed = [
  "AUTH_MAILER_URL",
  "AUTH_MAILER_TOKEN",
  "AUTH_MAILER_ACCESS_CLIENT_ID",
  "AUTH_MAILER_ACCESS_CLIENT_SECRET",
  "AUTH_MAIL_FROM",
  "BETTER_AUTH_SECRET",
];
if (
  !config ||
  typeof config !== "object" ||
  Object.keys(config).some((key) => !allowed.includes(key)) ||
  Object.values(config).some(
    (value) => typeof value !== "string" || /[\r\n]/.test(value),
  )
)
  throw new Error(
    "Use only the documented authentication configuration fields.",
  );
let url;
try {
  url = new URL(config.AUTH_MAILER_URL);
} catch {
  throw new Error("Configure a valid private sender origin.");
}
if (
  url.username ||
  url.password ||
  url.search ||
  url.hash ||
  url.pathname !== "/" ||
  !(
    url.protocol === "https:" ||
    (mode === "local" &&
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
  )
)
  throw new Error(
    "Use a private HTTPS sender origin, or loopback HTTP locally.",
  );
if (
  !config.AUTH_MAILER_TOKEN ||
  config.AUTH_MAILER_TOKEN.length < 32 ||
  !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(config.AUTH_MAIL_FROM || "")
)
  throw new Error("A strong mailer token and valid sender are required.");
if (
  mode !== "local" &&
  !(
    config.AUTH_MAILER_ACCESS_CLIENT_ID &&
    config.AUTH_MAILER_ACCESS_CLIENT_SECRET
  )
)
  throw new Error(
    "Protect the public mailer hostname with Cloudflare Access Service Auth first.",
  );
if (config.BETTER_AUTH_SECRET && config.BETTER_AUTH_SECRET.length < 32)
  throw new Error("The authentication secret must be at least 32 characters.");
function wrangler(args, input) {
  try {
    return execFileSync(
      process.execPath,
      ["node_modules/wrangler/bin/wrangler.js", ...args],
      { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
  } catch {
    throw new Error(
      "Configuration failed. Verify Wrangler access and permissions; private command output was suppressed.",
    );
  }
}
if (mode === "local") {
  mkdirSync(".private", { recursive: true, mode: 0o700 });
  let previous = "";
  try {
    previous = readFileSync(".dev.vars", "utf8");
    copyFileSync(".dev.vars", ".private/dev-vars-before-email-auth");
  } catch {
    /* Initial local setup. */
  }
  const hadSecret = /^BETTER_AUTH_SECRET=.{32,}$/m.test(previous);
  if (!hadSecret && !config.BETTER_AUTH_SECRET)
    config.BETTER_AUTH_SECRET = randomBytes(48).toString("base64url");
  const updated = previous
    .split("\n")
    .filter(
      (line) => !Object.keys(config).some((key) => line.startsWith(`${key}=`)),
    )
    .join("\n");
  writeFileSync(
    ".dev.vars",
    `${updated.trim()}\n${Object.entries(config)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join("\n")}\n`,
    { mode: 0o600 },
  );
  console.log(
    "Local email settings updated. Existing fixture settings were preserved; disable LOCAL_DEV_AUTH explicitly to test real sign-in.",
  );
} else {
  const args = [
    "--config",
    "wrangler.jsonc",
    ...(mode === "staging" ? ["--env", "staging"] : []),
  ];
  const existing = JSON.parse(wrangler(["secret", "list", ...args]));
  if (
    existing.some((entry) => entry.name === "BETTER_AUTH_SECRET") &&
    config.BETTER_AUTH_SECRET
  )
    throw new Error(
      "An auth secret already exists. Remove BETTER_AUTH_SECRET from the private config to preserve it; perform intentional rotations separately.",
    );
  if (!existing.some((entry) => entry.name === "BETTER_AUTH_SECRET"))
    config.BETTER_AUTH_SECRET ||= randomBytes(48).toString("base64url");
  wrangler(["secret", "bulk", ...args], JSON.stringify(config));
  console.log(
    `${mode} email authentication settings uploaded. Existing auth secrets were preserved; no secret values were displayed.`,
  );
}
