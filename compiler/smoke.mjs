import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startCompiler } from "./server.mjs";

// One real engine check, using the same isolated service as Work.
const token = randomUUID();
const server = await startCompiler({ token, port: 0 });
try {
  const source = String.raw`\documentclass{article}
\usepackage[T1]{fontenc}
\begin{document}
\section*{Manav Dodia}
Software engineer. Contact: manav@example.invalid.
\begin{itemize}\item Built reliable software.\end{itemize}
\end{document}`;
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/compile`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jobId: randomUUID(),
        engine: "pdflatex",
        mainFile: "main.tex",
        files: [
          {
            path: "main.tex",
            contentBase64: Buffer.from(source).toString("base64"),
          },
        ],
      }),
    },
  );
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.success, true, result.log);
  assert.equal(
    Buffer.from(result.pdfBase64, "base64").subarray(0, 5).toString(),
    "%PDF-",
  );
  assert.match(result.text, /Manav Dodia/);
  assert.match(result.text, /Built reliable software/);
  assert.match(result.fonts, /yes/);
  console.log(
    "Real TeX compilation passed: PDF, extracted text, and embedded fonts.",
  );
  console.log(JSON.stringify(result.metadata));
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
