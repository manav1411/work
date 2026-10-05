import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startCompiler } from "./server.mjs";
const directory = await mkdtemp(join(process.cwd(), "work-smoke-"));
const sentinel = join(directory, "private-sentinel.txt");
await writeFile(sentinel, "PRIVATE_SENTINEL_MUST_NOT_BE_READ");
const token = randomUUID(),
  server = await startCompiler({
    token,
    port: 0,
    temporaryDirectory: join(directory, "jobs"),
  });
const endpoint = `http://127.0.0.1:${server.address().port}`,
  headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
async function compile(source) {
  const id = randomUUID();
  const response = await fetch(`${endpoint}/jobs`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jobId: id,
      engine: "pdflatex",
      mainFile: "main.tex",
      files: [
        {
          path: "main.tex",
          contentBase64: Buffer.from(source).toString("base64"),
        },
      ],
    }),
  });
  assert.equal(response.status, 202);
  for (let i = 0; i < 200; i++) {
    await new Promise((res) => setTimeout(res, 500));
    const state = await (
      await fetch(`${endpoint}/jobs/${id}`, { headers })
    ).json();
    if (!["queued", "running"].includes(state.status)) return state.result;
  }
  throw new Error("Timed out polling compiler");
}
try {
  await mkdir(join(directory, "jobs"), { recursive: true });
  const result = await compile(
    String.raw`\documentclass{article}\begin{document}\section*{Manav Dodia}Software engineer.\begin{itemize}\item Built reliable software.\end{itemize}\end{document}`,
  );
  assert.equal(result.success, true, result.log);
  assert.equal(
    Buffer.from(result.pdfBase64, "base64").subarray(0, 5).toString(),
    "%PDF-",
  );
  assert.match(result.text, /Manav Dodia/);
  assert.match(result.text, /Built reliable software/);
  assert.match(result.fonts, /yes/);
  const denied = await compile(
    `\\documentclass{article}\\begin{document}\\input{${sentinel}}\\end{document}`,
  );
  assert.equal(denied.success, false);
  assert.doesNotMatch(denied.log, /PRIVATE_SENTINEL_MUST_NOT_BE_READ/);
  assert.equal((await fetch(`${endpoint}/health`)).status, 401);
  console.log(
    "Native TeX smoke passed: actual PDF, extracted text, fonts, and isolated filesystem.",
  );
  console.log(JSON.stringify(result.metadata));
} finally {
  server.closeAllConnections();
  await new Promise((res) => server.close(res));
  await rm(directory, { recursive: true, force: true });
}
