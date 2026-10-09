import { expect, it } from "vitest";
import { latexDiagnosticMessage } from "../src/lib/latex-diagnostics";

it("shows the complete environment error when TeX wraps a command mid-word", () => {
  const message = String.raw`LaTeX Error: \begin{itemize} on input line 138 ended by \end{do`;
  const log = `./main.tex:190: ${message}\ncument}.\n\nSee the LaTeX manual or LaTeX Companion for explanation.\n./main.tex:190: ==> Fatal error occurred, no output PDF file produced!`;
  expect(
    latexDiagnosticMessage(
      { file: "main.tex", line: 190, severity: "error", message },
      log,
    ),
  ).toBe(
    String.raw`LaTeX Error: \begin{itemize} on input line 138 ended by \end{document}.`,
  );
});

it("keeps diagnostics separate and preserves messages when the log excerpt omits them", () => {
  const diagnostic = {
    file: "main.tex",
    line: 12,
    severity: "error",
    message: "Undefined control sequence.",
  };
  expect(
    latexDiagnosticMessage(
      diagnostic,
      "main.tex:12: Undefined control sequence.\nmain.tex:13: Missing $ inserted.",
    ),
  ).toBe(diagnostic.message);
  expect(
    latexDiagnosticMessage(diagnostic, "Log excerpt has no matching error."),
  ).toBe(diagnostic.message);
  expect(
    latexDiagnosticMessage(
      { severity: "warning", message: "Font warning." },
      "",
    ),
  ).toBe("Font warning.");
});
