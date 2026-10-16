import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const environment = process.argv[2];
const action = process.argv[3] || "check";
if (
  !["staging", "production"].includes(environment) ||
  !["check", "prepare", "retire-github"].includes(action)
)
  throw new Error(
    "Use auth:owner -- staging|production check|prepare|retire-github [private-config-path]. The default action is read-only check.",
  );
let config;
try {
  config = JSON.parse(
    readFileSync(process.argv[4] || ".private/email-owner.json", "utf8"),
  );
} catch {
  throw new Error(
    "Read a valid private owner identity file; its contents were suppressed.",
  );
}
if (
  !config ||
  typeof config !== "object" ||
  Object.keys(config).some(
    (key) => !["githubId", "githubLogin", "email"].includes(key),
  ) ||
  !/^[1-9]\d*$/.test(config.githubId || "") ||
  !/^[a-z\d-]{1,39}$/i.test(config.githubLogin || "") ||
  !/^[^\s'<>@]+@[^\s'<>@]+\.[^\s'<>@]+$/.test(config.email || "")
)
  throw new Error(
    "The private owner config requires githubId, githubLogin and email.",
  );
const email = config.email.toLowerCase();
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
function sql(query) {
  try {
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "node_modules/wrangler/bin/wrangler.js",
          "d1",
          "execute",
          "DB",
          "--remote",
          "--config",
          "wrangler.jsonc",
          ...(environment === "staging" ? ["--env", "staging"] : []),
          "--command",
          query,
          "--json",
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
    );
    return result.flatMap((part) => part.results || []);
  } catch {
    throw new Error(
      "Owner operation failed. Verify the database, migration, identity and environment. Private command output was suppressed.",
    );
  }
}
const identity = `github_id=${quote(config.githubId)} AND lower(github_login)=${quote(config.githubLogin.toLowerCase())}`;
const users = sql(
  `SELECT id,email,email_verified,(SELECT count(*) FROM account WHERE user_id=user.id AND provider_id='credential' AND password IS NOT NULL) AS credentials,(SELECT count(*) FROM records WHERE owner_id=user.id) AS records FROM user WHERE ${identity};`,
);
if (users.length !== 1)
  throw new Error(
    "Exactly one existing owner must match both the pinned GitHub ID and login. No data was changed.",
  );
const user = users[0];
const migrationApplied = sql("PRAGMA table_info(user);").some(
  (column) => column.name === "auth_version",
);
if (action !== "check" && !migrationApplied)
  throw new Error(
    "Apply the email auth migration before owner mutations. No identity was changed.",
  );
if (
  sql(
    `SELECT id FROM user WHERE lower(email)=${quote(email)} AND id!=${quote(user.id)};`,
  ).length
)
  throw new Error(
    "The target email belongs to another account. Resolve the conflict explicitly; automatic account merging is forbidden.",
  );
if (action === "prepare" && user.email.toLowerCase() !== email) {
  // Only an operator-selected identity is migrated. A password is still set by
  // proving control of the target mailbox through the normal recovery flow.
  const sender = JSON.parse(
    readFileSync(`.private/email-auth-${environment}.json`, "utf8"),
  );
  const health = await fetch(new URL("/health", sender.AUTH_MAILER_URL), {
    headers: {
      Authorization: `Bearer ${sender.AUTH_MAILER_TOKEN}`,
      "CF-Access-Client-Id": sender.AUTH_MAILER_ACCESS_CLIENT_ID || "",
      "CF-Access-Client-Secret": sender.AUTH_MAILER_ACCESS_CLIENT_SECRET || "",
    },
    signal: AbortSignal.timeout(8000),
    redirect: "error",
  });
  if (!health.ok || !(await health.json()).ok)
    throw new Error(
      "The private email sender is not ready. Owner identity was left unchanged.",
    );
  sql(
    `UPDATE user SET email=${quote(email)},email_verified=0,updated_at=${Date.now()} WHERE id=${quote(user.id)} AND ${identity} AND email=${quote(user.email)};`,
  );
  console.log(
    "Owner email prepared on the existing user ID; sessions revoked atomically. Set the password through verified email recovery. Workspace ownership was preserved.",
  );
} else if (action === "retire-github") {
  if (
    user.email.toLowerCase() !== email ||
    !user.email_verified ||
    !user.credentials
  )
    throw new Error(
      "First complete email recovery and prove the owner can sign in with the target email and password.",
    );
  sql(
    `DELETE FROM account WHERE user_id=${quote(user.id)} AND provider_id='github' AND EXISTS(SELECT 1 FROM user u JOIN account a ON a.user_id=u.id WHERE u.id=${quote(user.id)} AND u.email=${quote(email)} AND u.email_verified=1 AND a.provider_id='credential' AND a.password IS NOT NULL);`,
  );
  console.log(
    "Retired the owner's GitHub provider account and tokens. The existing user ID, email credential and workspace were preserved. Retire obsolete Worker OAuth secrets separately after acceptance.",
  );
} else {
  console.log(
    JSON.stringify(
      {
        environment,
        ownerFound: true,
        migrationApplied,
        emailMatches: user.email.toLowerCase() === email,
        emailVerified: Boolean(user.email_verified),
        passwordConfigured: Boolean(user.credentials),
        workspaceRecords: user.records,
        changed: false,
      },
      null,
      2,
    ),
  );
  if (!user.credentials)
    console.log(
      "The existing account can gain its password through verified email recovery once delivery is ready.",
    );
}
