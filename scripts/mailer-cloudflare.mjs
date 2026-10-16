import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";

const environment = process.argv[2];
const sender = process.argv[3];
if (
  !["production", "staging"].includes(environment) ||
  !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@gmail\.com$/.test(sender || "")
)
  throw new Error(
    "Use node scripts/mailer-cloudflare.mjs production|staging sender@gmail.com.",
  );
const hostname =
  environment === "production"
    ? "work-mailer.manavdodia.com"
    : "work-mailer-staging.manavdodia.com";
const path = `.private/email-auth-${environment}.json`;
mkdirSync(".private", { recursive: true, mode: 0o700 });
let config = {};
try {
  config = JSON.parse(readFileSync(path, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (config.BETTER_AUTH_SECRET)
  throw new Error(
    "Preserve the existing auth secret; remove it from the mailer configuration.",
  );
let token;
try {
  token = readFileSync(".private/cloudflare-api-token", "utf8")
    .trim()
    .replace(/^\s*cloudflare-api-token\s*=\s*/, "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
} catch {
  token = JSON.parse(
    execFileSync(
      process.execPath,
      ["node_modules/wrangler/bin/wrangler.js", "auth", "token", "--json"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  ).token;
}
async function api(path, method = "GET", body) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/235b7f098227aa97860dfd1d4ea9ee71${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    },
  );
  const value = await response.json();
  if (!value.success)
    throw new Error(
      `Cloudflare mailer configuration failed: HTTP ${response.status}, codes ${(value.errors || []).map((e) => e.code).join(",")}.`,
    );
  return value.result;
}
function save() {
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}
const applications = await api("/access/apps");
let application = applications.find((app) => app.domain === hostname);
if (!application)
  application = await api("/access/apps", "POST", {
    name: `Work private mailer (${environment})`,
    domain: hostname,
    type: "self_hosted",
    session_duration: "24h",
  });
const tokens = await api("/access/service_tokens");
let credential = tokens.find(
  (entry) => entry.client_id === config.AUTH_MAILER_ACCESS_CLIENT_ID,
);
if (!credential || !config.AUTH_MAILER_ACCESS_CLIENT_SECRET) {
  credential = await api("/access/service_tokens", "POST", {
    name: `Work mailer ${environment} ${new Date().toISOString().slice(0, 10)}`,
    duration: "8760h",
  });
  config.AUTH_MAILER_ACCESS_CLIENT_ID = credential.client_id;
  config.AUTH_MAILER_ACCESS_CLIENT_SECRET = credential.client_secret;
  save();
}
const policies = await api(`/access/apps/${application.id}/policies`);
if (
  policies.some(
    (policy) =>
      policy.decision === "bypass" ||
      (policy.decision !== "deny" &&
        !(
          policy.decision === "non_identity" &&
          policy.include?.length === 1 &&
          policy.include[0].service_token?.token_id === credential.id
        )),
  )
)
  throw new Error(
    "Unexpected mailer Access policy; inspect before activating the sender.",
  );
if (
  !policies.some(
    (policy) =>
      policy.decision === "non_identity" &&
      policy.include?.some(
        (entry) => entry.service_token?.token_id === credential.id,
      ),
  )
)
  await api(`/access/apps/${application.id}/policies`, "POST", {
    name: "Work Worker only",
    decision: "non_identity",
    include: [{ service_token: { token_id: credential.id } }],
  });
config.AUTH_MAILER_URL = `https://${hostname}`;
config.AUTH_MAILER_TOKEN ||= randomBytes(48).toString("base64url");
config.AUTH_MAIL_FROM = sender;
save();
console.log(
  JSON.stringify({
    environment,
    protectedHostname: hostname,
    privateWorkerConfigurationSaved: true,
  }),
);
