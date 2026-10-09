import type { LatexJob } from "../../shared/latex";

type Diagnostic = NonNullable<LatexJob["diagnostics"]>[number];

/** TeX wraps console output at 79 columns, including in the middle of commands. */
export function latexDiagnosticMessage(diagnostic: Diagnostic, log: string) {
  if (!diagnostic.file || !diagnostic.line) return diagnostic.message;
  const lines = log.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const match = /^(.+?\.\w+):(\d+):\s*(.+)$/.exec(lines[index]);
    if (
      !match ||
      match[1].replace(/^\.\//, "") !== diagnostic.file ||
      Number(match[2]) !== diagnostic.line ||
      !match[3].startsWith(diagnostic.message)
    )
      continue;
    let message = match[3];
    while (
      lines[index].length >= 79 &&
      lines[index + 1]?.trim() &&
      !/^\S+\.\w+:\d+:|^(?:See |Type |l\.\d+ |Latexmk:)/.test(lines[index + 1])
    ) {
      message += lines[++index];
    }
    return message;
  }
  return diagnostic.message;
}
