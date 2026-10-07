import {
  readFileSync,
  writeFileSync,
  chmodSync,
  renameSync,
  rmSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
const hostname = "work-compiler.manavdodia.com",
  path = "/etc/cloudflared/config.yml";
const current = readFileSync(path, "utf8"),
  match = /^tunnel:\s*([a-f\d-]{36})\s*$/m.exec(current);
if (!match)
  throw new Error("Expected existing tunnel UUID; no routing changes made");
if (!current.includes(`hostname: ${hostname}`)) {
  const terminal = /^([ \t]*)- service:\s*http_status:404\s*$/m.exec(current);
  if (!terminal)
    throw new Error("Expected final tunnel catchall; no routing changes made");
  execFileSync(
    "cloudflared",
    [
      "--origincert",
      "/etc/cloudflared/cert.pem",
      "tunnel",
      "route",
      "dns",
      match[1],
      hostname,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const route = `${terminal[1]}- hostname: ${hostname}\n${terminal[1]}  service: http://localhost:8788\n`;
  const updated =
    current.slice(0, terminal.index) + route + current.slice(terminal.index);
  const temporary = `${path}.work-pending`;
  try {
    writeFileSync(temporary, updated, { mode: 0o600 });
    execFileSync(
      "cloudflared",
      ["--config", temporary, "tunnel", "ingress", "validate"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
  execFileSync("systemctl", ["restart", "cloudflared"]);
}
const env = readFileSync("/etc/work-compiler.env", "utf8"),
  token = /^WORK_COMPILER_TOKEN=(.+)$/m.exec(env)?.[1];
if (!token) throw new Error("Compiler token missing");
writeFileSync(
  "/home/manav/base/work_project/compiler-client.json",
  JSON.stringify({ url: `https://${hostname}`, token }),
  { mode: 0o600 },
);
execFileSync("chown", [
  "manav:manav",
  "/home/manav/base/work_project/compiler-client.json",
]);
chmodSync("/home/manav/base/work_project/compiler-client.json", 0o600);
const health = await (
  await fetch("http://127.0.0.1:8788/health", {
    headers: { Authorization: `Bearer ${token}` },
  })
).json();
console.log(
  JSON.stringify({
    hostname,
    ready: health.ready,
    fingerprint: health.compilerFingerprint,
  }),
);
