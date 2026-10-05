import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const root = new URL("./runtime/", import.meta.url);
await mkdir(root, { recursive: true });
const base = "https://nodejs.org/dist/latest-v22.x/";
const manifest = await (await fetch(`${base}SHASUMS256.txt`)).text();
const line = manifest
  .split("\n")
  .find((line) => /node-v22\.\d+\.\d+-linux-arm64\.tar\.xz$/.test(line));
if (!line) throw new Error("Official Node ARM64 release not found");
const [checksum, filename] = line.trim().split(/\s+/),
  response = await fetch(`${base}${filename}`);
if (!response.ok) throw new Error("Node runtime download failed");
const bytes = Buffer.from(await response.arrayBuffer());
if (createHash("sha256").update(bytes).digest("hex") !== checksum)
  throw new Error("Node runtime checksum mismatch");
const archive = new URL(filename, root);
await writeFile(archive, bytes);
execFileSync("tar", [
  "-xJf",
  archive.pathname,
  "--strip-components=1",
  "-C",
  root.pathname,
]);
console.log(
  execFileSync(new URL("bin/node", root).pathname, ["--version"], {
    encoding: "utf8",
  }).trim(),
);
