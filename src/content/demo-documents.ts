import type { RecordInput } from "../../shared/model";
import { TEXLIVE_ENVIRONMENT, type LatexProject } from "../../shared/latex";

const resume = [
  "Alex Morgan",
  "Software Engineer | Melbourne, Australia",
  "alex.morgan@example.com",
  "",
  "SUMMARY",
  "Backend engineer building dependable APIs and developer tools.",
  "Three years of experience with Python, TypeScript, PostgreSQL and AWS.",
  "",
  "EXPERIENCE",
  "Software Engineer | Harbour Labs | 2023 - Present",
  "Built an event ingestion API processing 500,000 events per day.",
  "Reduced p95 API latency from 420ms to 180ms through query optimisation.",
  "Introduced idempotent jobs and dashboards for failed payment retries.",
  "",
  "Software Engineering Intern | Cedar Software | 2022 - 2023",
  "Delivered a React operations dashboard used by a team of 12 analysts.",
  "Added integration tests for billing and account ownership workflows.",
  "",
  "PROJECTS",
  "QueueWatch | Python, Redis, PostgreSQL",
  "Built a queue monitoring service with alert deduplication and retry logs.",
  "Trail Planner | TypeScript, React, SQLite",
  "Created an offline trip planner with accessible forms and map filters.",
  "",
  "EDUCATION",
  "Bachelor of Computer Science | Southern University | 2022",
  "",
  "SKILLS",
  "Python, TypeScript, SQL, REST APIs, Docker, AWS, CI/CD, testing",
];
const letter = [
  "Alex Morgan",
  "Melbourne, Australia | alex.morgan@example.com",
  "",
  "Dear Platform Engineering team,",
  "",
  "I am applying for the Software Engineer, Platform role at Atlassian.",
  "I enjoy building tools that help engineers ship dependable services,",
  "and the focus on developer experience makes this role a strong fit.",
  "",
  "At Harbour Labs I built an ingestion API handling 500,000 daily events.",
  "I worked with the support team to understand failure patterns, then",
  "added idempotent processing, useful logs and a recovery dashboard.",
  "That work halved the time needed to investigate failed imports.",
  "",
  "I also improved a slow endpoint by analysing query plans and adding",
  "targeted indexes, reducing p95 latency from 420ms to 180ms. I care",
  "about leaving systems easier to operate as well as faster to use.",
  "",
  "I would welcome the opportunity to discuss how my experience with",
  "Python, TypeScript and service ownership could support your team.",
  "",
  "Kind regards,",
  "Alex Morgan",
];
const variants = [
  {
    key: "resume-platform",
    type: "resume",
    title: "Platform engineering",
    lines: resume,
  },
  {
    key: "resume-backend",
    type: "resume",
    title: "Backend engineering",
    lines: resume.map((line) =>
      line === "Backend engineer building dependable APIs and developer tools."
        ? "Backend engineer focused on data pipelines and reliable services."
        : line,
    ),
  },
  {
    key: "letter-atlassian",
    type: "letter",
    title: "Atlassian",
    lines: letter,
  },
] as const;

/** Small, valid PDFs keep the isolated demo usable without a compiler service. */
function pdfText(lines: readonly string[]) {
  const escape = (text: string) => text.replace(/([\\()])/g, "\\$1");
  const stream = `BT /F1 11 Tf 50 790 Td 18 TL\n${lines.map((line, index) => `${index ? "T* " : ""}(${escape(line)}) Tj`).join("\n")}\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  return `${pdf}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

export function demoDocumentRecords(): RecordInput[] {
  return variants.map((variant, order) => ({
    kind: "asset",
    title: variant.title,
    tags: ["demo"],
    data: {
      demoSeedKey: variant.key,
      type: variant.type,
      nativeDocument: true,
      order,
    },
  }));
}

export function demoDocument(
  key: string,
): { project: LatexProject; pdf: string } | undefined {
  const variant = variants.find((item) => item.key === key);
  if (!variant) return;
  const sourceId = `demo-source-${key}`;
  const source = `\\documentclass{article}\n\\usepackage[margin=20mm]{geometry}\n\\begin{document}\n\\small\n${variant.lines.map((line) => (line ? line.replace(/[&%_#]/g, (match) => `\\${match}`) + "\\\\" : "\\par\\medskip")).join("\n")}\n\\end{document}\n`;
  return {
    pdf: pdfText(variant.lines),
    project: {
      version: 1,
      sourceId,
      engine: "pdflatex",
      mainFile: "main.tex",
      files: [{ path: "main.tex", encoding: "utf8", content: source }],
      latestJob: {
        id: `demo-build-${key}`,
        sourceId,
        status: "succeeded",
        createdAt: new Date().toISOString(),
        log: "Demo PDF ready.",
        metadata: { texEnvironment: TEXLIVE_ENVIRONMENT },
      },
    },
  };
}
