import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [environment, action] = process.argv.slice(2);
if (
  !["production", "staging"].includes(environment) ||
  !["install", "tunnel", "health"].includes(action)
)
  throw new Error(
    "Use node scripts/mailer-pi.mjs production|staging install|tunnel|health.",
  );
const config = JSON.parse(
  readFileSync(`.private/email-auth-${environment}.json`, "utf8"),
);
const hostname = new URL(config.AUTH_MAILER_URL).hostname;
const expected =
  environment === "production"
    ? "work-mailer.manavdodia.com"
    : "work-mailer-staging.manavdodia.com";
if (hostname !== expected)
  throw new Error("Unexpected private mailer hostname.");
function command(program, args, input) {
  try {
    return execFileSync(program, args, {
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 60000,
    });
  } catch {
    throw new Error("Pi mailer operation failed; private output suppressed.");
  }
}
function ssh(remote, input) {
  return command("ssh", ["-o", "BatchMode=yes", "pi", remote], input);
}
function sudo(remote) {
  return ssh(
    `sudo -S -p '' ${remote}`,
    readFileSync(".private/pi_pw", "utf8").trim() + "\n",
  );
}
const directory = "/home/manav/base/work_project/mailer";
if (action === "install") {
  const password = readFileSync(".private/gmail-app-password", "utf8").replace(
    /\s/g,
    "",
  );
  if (!/^[A-Za-z0-9]{16}$/.test(password))
    throw new Error(
      "Save a valid Gmail App Password with python3 scripts/auth-gmail-password.py.",
    );
  ssh(`mkdir -p ${directory}`);
  command("scp", [
    "mailer/server.py",
    "mailer/test_server.py",
    "mailer/install-pi.sh",
    "mailer/configure-pi.py",
    "mailer/work-mailer@.service",
    `pi:${directory}/`,
  ]);
  const privatePath = "/home/manav/.work-mailer-setup.json";
  ssh(
    `python3 -c 'import os,sys; os.umask(0o077); f=open("${privatePath}","w"); f.write(sys.stdin.read()); f.close(); os.chmod("${privatePath}",0o600)'`,
    JSON.stringify({
      token: config.AUTH_MAILER_TOKEN,
      sender: config.AUTH_MAIL_FROM,
      password,
    }),
  );
  const tests = ssh(
    `python3 -m unittest discover -s ${directory} -p 'test_*.py'`,
  );
  if (tests.trim()) console.log(tests.trim());
  console.log(
    sudo(
      `python3 ${directory}/configure-pi.py install ${environment} ${privatePath}`,
    ).trim(),
  );
} else if (action === "tunnel") {
  console.log(
    sudo(`python3 ${directory}/configure-pi.py tunnel ${environment}`).trim(),
  );
} else {
  const response = await fetch(new URL("/health", config.AUTH_MAILER_URL), {
    headers: {
      Authorization: `Bearer ${config.AUTH_MAILER_TOKEN}`,
      "CF-Access-Client-Id": config.AUTH_MAILER_ACCESS_CLIENT_ID,
      "CF-Access-Client-Secret": config.AUTH_MAILER_ACCESS_CLIENT_SECRET,
    },
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new Error(`Protected Pi health failed: HTTP ${response.status}.`);
  const result = await response.json();
  if (!result.ok || result.transport !== "gmail-smtp")
    throw new Error("Protected Gmail transport is not healthy.");
  console.log(
    JSON.stringify({
      protectedPiMailerHealthy: true,
      gmailAuthenticationVerified: true,
    }),
  );
}
