import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseGitHubAllowlist } from "../worker/github-allowlist.ts";

process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const environment = process.argv[2] || "local";
if (
  process.argv.length > 3 ||
  !["local", "production", "staging"].includes(environment)
)
  throw new Error("Use npm run auth:allowlist -- local|production|staging.");

const path = ".private/github-allowlist.json";
execFileSync("git", ["check-ignore", "-q", path], { stdio: "ignore" });
const users = parseGitHubAllowlist(readFileSync(path, "utf8"));
if (!users)
  throw new Error(
    "Invalid private allowlist. Use a JSON array of objects with a GitHub login and optional numeric id string.",
  );
chmodSync(path, 0o600);
const value = JSON.stringify(users);

if (environment === "local") {
  const devPath = ".dev.vars";
  execFileSync("git", ["check-ignore", "-q", devPath], { stdio: "ignore" });
  const previous = existsSync(devPath)
    ? readFileSync(devPath, "utf8")
    : readFileSync(".dev.vars.example", "utf8");
  const preserved = previous
    .split(/\r?\n/)
    .filter(
      (line) =>
        !/^\s*(?:ALLOWED_GITHUB_USERS|OWNER_GITHUB_LOGIN|OWNER_GITHUB_ID)\s*=/.test(
          line,
        ),
    )
    .join("\n")
    .trimEnd();
  writeFileSync(devPath, `${preserved}\nALLOWED_GITHUB_USERS='${value}'\n`, {
    mode: 0o600,
  });
  chmodSync(devPath, 0o600);
  console.log(
    "Local GitHub allowlist updated. Restart the dev server to apply it.",
  );
} else {
  try {
    execFileSync(
      process.execPath,
      [
        "node_modules/wrangler/bin/wrangler.js",
        "secret",
        "bulk",
        "--config",
        "wrangler.jsonc",
        ...(environment === "staging" ? ["--env", "staging"] : []),
      ],
      {
        input: JSON.stringify({ ALLOWED_GITHUB_USERS: value }),
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
  } catch {
    throw new Error(
      "Allowlist upload failed. Check Wrangler authentication and filesystem/network permissions. Secret output was suppressed.",
    );
  }
  console.log(`${environment} GitHub allowlist uploaded securely.`);
}
