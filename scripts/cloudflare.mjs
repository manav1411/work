import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const account = "235b7f098227aa97860dfd1d4ea9ee71";
const action = process.argv[2] || "status";
function wrangler(args, options = {}) {
  try {
    return execFileSync(
      process.execPath,
      ["node_modules/wrangler/bin/wrangler.js", ...args],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options },
    );
  } catch {
    throw new Error(
      `Wrangler ${args.slice(0, 2).join(" ")} failed. Verify your login and filesystem/network permissions. Credential output was suppressed.`,
    );
  }
}
const token =
  process.env.CLOUDFLARE_BUILD_API_TOKEN ||
  JSON.parse(wrangler(["auth", "token", "--json"])).token;
if (!token)
  throw new Error(
    "Cloudflare credentials unavailable. Run npx wrangler login.",
  );
const base = "https://api.cloudflare.com/client/v4";
async function api(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const value = await response.json();
  if (!value.success)
    throw new Error(
      `Cloudflare ${response.status}: ${(value.errors || []).map((error) => `${error.code}: ${error.message}`).join("; ")}`,
    );
  return value.result;
}
const prefix = `/accounts/${account}`;
if (action === "status") {
  const zones = await api("/zones?name=manavdodia.com");
  const scripts = await api(`${prefix}/workers/scripts`);
  const subdomain = await api(`${prefix}/workers/subdomain`);
  const domains = await api(`${prefix}/workers/domains`);
  console.log(
    JSON.stringify(
      {
        account,
        zones: zones.map((zone) => ({
          id: zone.id,
          name: zone.name,
          status: zone.status,
          nameservers: zone.name_servers,
        })),
        workers: scripts.map((script) => ({
          name: script.id,
          tag: script.tag,
        })),
        subdomain,
        domains: domains.filter((domain) => domain.service === "work"),
      },
      null,
      2,
    ),
  );
  if (zones[0]) {
    try {
      const records = await api(
        `/zones/${zones[0].id}/dns_records?name=work.manavdodia.com`,
      );
      console.log(
        JSON.stringify(
          {
            existingWorkDNS: records.map((record) => ({
              id: record.id,
              type: record.type,
              name: record.name,
              content: record.content,
            })),
          },
          null,
          2,
        ),
      );
    } catch (error) {
      console.log(error.message);
    }
  }
  for (const route of ["repos/connections", "tokens"]) {
    try {
      const items = await api(`${prefix}/builds/${route}`);
      console.log(
        JSON.stringify(
          {
            [route]: items.map((item) => ({
              id: item.build_token_uuid || item.repo_connection_uuid,
              name: item.build_token_name || item.repo_name,
              provider: item.provider_type,
              account: item.provider_account_name,
            })),
          },
          null,
          2,
        ),
      );
    } catch (error) {
      console.log(error.message);
    }
  }
} else if (action === "connect-builds") {
  const scripts = await api(`${prefix}/workers/scripts`);
  const worker = scripts.find((script) => script.id === "work");
  if (!worker)
    throw new Error("Deploy the work Worker before connecting builds.");
  const existing = await api(`${prefix}/builds/workers/${worker.tag}/triggers`);
  if (existing.length) {
    console.log(
      "Work already has build triggers. Inspect settings before changing them.",
    );
    process.exit(0);
  }
  const repository = await fetch(
    "https://api.github.com/repos/manav1411/work",
    { headers: { Accept: "application/vnd.github+json" } },
  ).then((response) => response.json());
  if (!repository.id)
    throw new Error(
      "Cannot resolve the GitHub repository ID. Authorize access before connecting.",
    );
  const connection = await api(`${prefix}/builds/repos/connections`, {
    method: "PUT",
    body: JSON.stringify({
      provider_type: "github",
      provider_account_id: "41612145",
      provider_account_name: "manav1411",
      repo_id: String(repository.id),
      repo_name: "work",
    }),
  });
  const tokens = await api(`${prefix}/builds/tokens`);
  const buildToken = tokens.find(
    (item) => item.build_token_name === "work-builds",
  );
  if (!buildToken)
    throw new Error(
      "Create a scoped build token named work-builds in Cloudflare Work → Settings → Builds → API token, then rerun. No existing token was reused.",
    );
  const trigger = await api(`${prefix}/builds/triggers`, {
    method: "POST",
    body: JSON.stringify({
      external_script_id: worker.tag,
      repo_connection_uuid: connection.repo_connection_uuid,
      build_token_uuid: buildToken.build_token_uuid,
      trigger_name: "Work main — verified production",
      build_command: "npm run ci:build",
      deploy_command: "npm run deploy:ci",
      root_directory: "/",
      branch_includes: ["main"],
      branch_excludes: [],
      path_includes: ["*"],
      path_excludes: [],
      build_caching_enabled: true,
    }),
  });
  await api(
    `${prefix}/builds/triggers/${trigger.trigger_uuid}/environment_variables`,
    {
      method: "PATCH",
      body: JSON.stringify({
        NODE_VERSION: { value: "22.18.0", is_secret: false },
        NODE_ENV: { value: "production", is_secret: false },
      }),
    },
  );
  console.log(
    JSON.stringify({
      connected: true,
      trigger: trigger.trigger_uuid,
      repository: "manav1411/work",
      branch: "main",
    }),
  );
} else if (action === "secrets") {
  // Read only the ignored owner-created credential file; values never reach logs or command arguments.
  const entries = Object.fromEntries(
    readFileSync(".private/oauth.env", "utf8")
      .split(/\r?\n/)
      .filter((line) => /^GITHUB_CLIENT_(ID|SECRET)=/.test(line))
      .map((line) => {
        const split = line.indexOf("=");
        return [
          line.slice(0, split),
          line
            .slice(split + 1)
            .trim()
            .replace(/^(['"])(.*)\1$/, "$2"),
        ];
      }),
  );
  if (!entries.GITHUB_CLIENT_ID || !entries.GITHUB_CLIENT_SECRET)
    throw new Error(
      "Both OAuth credentials are required in .private/oauth.env.",
    );
  const existing = JSON.parse(
    wrangler(["secret", "list", "--config", "wrangler.jsonc"]),
  );
  if (!existing.some((secret) => secret.name === "BETTER_AUTH_SECRET"))
    entries.BETTER_AUTH_SECRET = (await import("node:crypto"))
      .randomBytes(48)
      .toString("base64url");
  wrangler(["secret", "bulk", "--config", "wrangler.jsonc"], {
    input: JSON.stringify(entries),
    stdio: ["pipe", "pipe", "pipe"],
  });
  console.log(
    "Production OAuth credentials uploaded securely. No secret values were displayed.",
  );
} else throw new Error("Use status, connect-builds, or secrets.");
