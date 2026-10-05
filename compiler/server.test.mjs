import assert from "node:assert/strict";
import test from "node:test";
import { diagnostics, inputHash, validateJob } from "./server.mjs";

const source = (path = "main.tex", content = "hello") => ({
  path,
  contentBase64: Buffer.from(content).toString("base64"),
});
const request = (files) => ({
  jobId: "job-123",
  engine: "pdflatex",
  mainFile: "main.tex",
  files,
});

test("accepts multi-file sources and hashes the manifest independent of order", () => {
  const first = validateJob(request([source(), source("sections/skills.tex")]));
  const second = validateJob(
    request([source("sections/skills.tex"), source()]),
  );
  assert.equal(inputHash(first), inputHash(second));
  assert.notEqual(
    inputHash(first),
    inputHash(
      validateJob({
        ...request([source(), source("sections/skills.tex")]),
        engine: "xelatex",
      }),
    ),
  );
});

test("rejects traversal, executable build configuration, path collisions and malformed encoding", () => {
  for (const path of [
    "../secret.tex",
    "/secret.tex",
    "a/../../secret.tex",
    "build/output.tex",
    ".latexmkrc",
    "source/latexmkrc",
    "a//b.tex",
    "shell$.tex",
  ]) {
    assert.throws(() => validateJob(request([source(), source(path)])));
  }
  assert.throws(() =>
    validateJob(
      request([source(), source("sections"), source("sections/file.tex")]),
    ),
  );
  assert.throws(() => validateJob(request([source(), source()])));
  assert.throws(() =>
    validateJob(request([{ path: "main.tex", contentBase64: "not base64" }])),
  );
  assert.throws(() => validateJob({ ...request([source()]), engine: "sh" }));
});

test("preserves useful source positions and warnings without unbounded diagnostics", () => {
  assert.deepEqual(
    diagnostics(
      "./main.tex:12: Undefined control sequence.\nLaTeX Warning: Missing citation.",
    ),
    [
      {
        file: "main.tex",
        line: 12,
        severity: "error",
        message: "Undefined control sequence.",
      },
      { severity: "warning", message: "LaTeX Warning: Missing citation." },
    ],
  );
  assert.equal(diagnostics("main.tex:1: bad\n".repeat(1000)).length, 100);
});
