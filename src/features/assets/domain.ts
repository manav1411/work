import type { RecordData } from "../../../shared/model";

export interface ResumeEntry {
  id: string;
  title: string;
  organisation: string;
  dates: string;
  bullets: string[];
}
export interface ResumeContent {
  name: string;
  headline: string;
  email: string;
  phone: string;
  location: string;
  website: string;
  summary: string;
  experience: ResumeEntry[];
  education: ResumeEntry[];
  projects: ResumeEntry[];
  skills: string;
}
export interface ProfileTask {
  id: string;
  text: string;
  done: boolean;
  nextAction: string;
  url: string;
}

export const emptyResume = (): ResumeContent => ({
  name: "",
  headline: "",
  email: "",
  phone: "",
  location: "",
  website: "",
  summary: "",
  experience: [],
  education: [],
  projects: [],
  skills: "",
});
export const emptyEntry = (): ResumeEntry => ({
  id: crypto.randomUUID(),
  title: "",
  organisation: "",
  dates: "",
  bullets: [],
});

function entries(value: unknown): ResumeEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is ResumeEntry =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as ResumeEntry).title === "string",
    )
    .map((entry) => ({
      id: typeof entry.id === "string" ? entry.id : crypto.randomUUID(),
      title: entry.title,
      organisation:
        typeof entry.organisation === "string" ? entry.organisation : "",
      dates: typeof entry.dates === "string" ? entry.dates : "",
      bullets: Array.isArray(entry.bullets)
        ? entry.bullets.filter(
            (bullet): bullet is string => typeof bullet === "string",
          )
        : [],
    }));
}

export function resumeContent(data: RecordData): ResumeContent {
  const value =
    typeof data.resume === "object" && data.resume !== null
      ? (data.resume as Record<string, unknown>)
      : {};
  const blank = emptyResume();
  return {
    ...blank,
    ...Object.fromEntries(
      Object.keys(blank)
        .filter((key) => typeof value[key] === "string")
        .map((key) => [key, value[key]]),
    ),
    experience: entries(value.experience),
    education: entries(value.education),
    projects: entries(value.projects),
  };
}

export function resumeMarkdown(resume: ResumeContent): string {
  const sections = (name: string, entries: ResumeEntry[]) =>
    entries.length
      ? `## ${name}\n\n${entries
          .map(
            (entry) =>
              `### ${[entry.title, entry.organisation].filter(Boolean).join(" — ")}\n${entry.dates ? `\n${entry.dates}\n` : ""}\n${entry.bullets
                .filter(Boolean)
                .map((bullet) => `- ${bullet}`)
                .join("\n")}`,
          )
          .join("\n\n")}`
      : "";
  return [
    `# ${resume.name || "Your name"}`,
    resume.headline,
    [resume.email, resume.phone, resume.location, resume.website]
      .filter(Boolean)
      .join(" · "),
    resume.summary ? `## Summary\n\n${resume.summary}` : "",
    sections("Experience", resume.experience),
    sections("Education", resume.education),
    sections("Projects", resume.projects),
    resume.skills ? `## Skills\n\n${resume.skills}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function profileTasks(data: RecordData): ProfileTask[] {
  return Array.isArray(data.checklist)
    ? data.checklist
        .filter(
          (task): task is ProfileTask =>
            typeof task === "object" &&
            task !== null &&
            typeof (task as ProfileTask).text === "string",
        )
        .map((task) => ({
          id: typeof task.id === "string" ? task.id : crypto.randomUUID(),
          text: task.text,
          done: task.done === true,
          nextAction:
            typeof task.nextAction === "string" ? task.nextAction : "",
          url: typeof task.url === "string" ? task.url : "",
        }))
    : [];
}

export function defaultProfileTasks(): ProfileTask[] {
  return [
    {
      text: "Résumé: show contribution and actual engineering impact",
      nextAction:
        "Rewrite one current-role bullet using evidence from your work log.",
      url: "",
    },
    {
      text: "LinkedIn: clarify the software engineering direction",
      nextAction:
        "Edit the headline and About section to reflect your actual experience and target.",
      url: "https://www.linkedin.com",
    },
    {
      text: "GitHub: make representative work easy to find",
      nextAction: "Pin one project and improve its README, setup, and demo.",
      url: "https://github.com",
    },
    {
      text: "Website: update the résumé and links",
      nextAction:
        "Upload the current résumé and check the contact and project links.",
      url: "",
    },
    {
      text: "Project case study: explain an engineering decision",
      nextAction:
        "Write the problem, contribution, tradeoff, implementation, and outcome.",
      url: "",
    },
  ].map((task) => ({ ...task, id: crypto.randomUUID(), done: false }));
}

export function safeFilename(title: string): string {
  return (
    title
      .replace(/[^a-zA-Z0-9 _-]/g, "")
      .trim()
      .replace(/\s+/g, "-") || "career-asset"
  );
}
