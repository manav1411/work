import { z } from "zod";
import { validDateOnly, validWebUrl } from "./applications";

const text = (length: number) => z.string().max(length);
const id = z.string().min(1).max(120);
const strings = (count = 40) => z.array(text(240)).max(count);
export const radarUrl = z
  .string()
  .max(2048)
  .refine(validWebUrl, "Use an http or https listing URL.");
const optionalUrl = z.union([z.literal(""), radarUrl]);
export const SOURCE_TYPES = [
  "jsearch",
  "greenhouse",
  "lever",
  "ashby",
  "apify",
] as const;
export const frequencySchema = z.enum([
  "disabled",
  "daily",
  "weekly",
  "monthly",
]);
export const profileSchema = z
  .object({
    id,
    name: text(100),
    enabled: z.boolean(),
    titles: strings(),
    keywords: strings(),
    requiredKeywords: strings(),
    exclude: strings(),
    locations: strings(),
    country: z.enum(["au", "us", "gb", "nz", "ca"]),
    workplace: z.array(z.enum(["onsite", "hybrid", "remote"])).max(3),
    salaryMin: z.number().nonnegative().nullable(),
    salaryMax: z.number().nonnegative().nullable(),
    currency: z.enum(["AUD", "USD", "GBP", "NZD", "CAD"]),
    salaryPeriod: z.enum(["year", "month", "week", "day", "hour"]),
    preferredCompanies: strings(),
    employmentTypes: strings(),
    context: text(8000),
    priority: z.number().int().min(1).max(10),
  })
  .strict()
  .refine(
    (p) =>
      p.salaryMin === null ||
      p.salaryMax === null ||
      p.salaryMin <= p.salaryMax,
    "Salary minimum must not exceed maximum.",
  );
export type RadarProfile = z.infer<typeof profileSchema>;
export const sourceSchema = z
  .object({
    id,
    type: z.enum(SOURCE_TYPES),
    name: text(120),
    enabled: z.boolean(),
    url: optionalUrl,
    companyId: text(120),
    actor: text(160),
  })
  .strict();
export type RadarSource = z.infer<typeof sourceSchema>;
export const radarConfigSchema = z
  .object({
    enabled: z.boolean(),
    discoveryFrequency: frequencySchema,
    emailFrequency: frequencySchema,
    emailTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    emailWeekday: z.number().int().min(0).max(6),
    emailMonthday: z.number().int().min(1).max(31),
    timezone: text(80).refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }),
    aboutYou: text(30000),
    resumeText: text(60000),
    resumeId: text(120),
    resumeImportedAt: text(40),
    profiles: z.array(profileSchema).max(12),
    sources: z.array(sourceSchema).max(50),
  })
  .strict()
  .superRefine((v, c) => {
    for (const field of ["profiles", "sources"] as const)
      if (new Set(v[field].map((x) => x.id)).size !== v[field].length)
        c.addIssue({ code: "custom", message: `Keep ${field} IDs unique.` });
  });
export type RadarConfig = z.infer<typeof radarConfigSchema>;
export function defaultRadarConfig(
  timezone = "Australia/Melbourne",
): RadarConfig {
  const base = {
    enabled: true,
    keywords: [],
    requiredKeywords: [],
    exclude: [],
    workplace: [],
    salaryMin: null,
    salaryMax: null,
    salaryPeriod: "year",
    preferredCompanies: [],
    employmentTypes: [],
    context: "",
    priority: 5,
  } as const;
  return radarConfigSchema.parse({
    enabled: false,
    discoveryFrequency: "daily",
    emailFrequency: "disabled",
    emailTime: "08:00",
    emailWeekday: 1,
    emailMonthday: 1,
    timezone,
    aboutYou: "",
    resumeText: "",
    resumeId: "",
    resumeImportedAt: "",
    profiles: [
      {
        ...base,
        id: "software-au",
        name: "Software engineering · Australia",
        titles: [
          "software engineer",
          "software developer",
          "graduate developer",
          "junior developer",
        ],
        locations: ["Melbourne", "Sydney"],
        country: "au",
        currency: "AUD",
        priority: 8,
        context:
          "Interested in junior and early-career software engineering, especially big technology companies. Include related roles and stretch opportunities.",
      },
      {
        ...base,
        id: "security-au",
        name: "Cybersecurity · Australia",
        titles: [
          "cybersecurity",
          "security engineer",
          "security analyst",
          "SOC analyst",
          "application security",
        ],
        locations: ["Melbourne", "Sydney"],
        country: "au",
        currency: "AUD",
        context:
          "Exploring cybersecurity roles. Keep adjacent opportunities visible.",
      },
      {
        ...base,
        id: "software-us",
        name: "Software engineering · US",
        titles: [
          "junior software engineer",
          "graduate software engineer",
          "software engineer",
        ],
        locations: ["San Francisco Bay Area", "New York"],
        country: "us",
        currency: "USD",
        priority: 4,
        context:
          "Interested in eventually moving to the United States, especially Silicon Valley or New York. Eligibility and relocation may need checking.",
      },
    ],
    sources: [
      {
        id: "jsearch",
        type: "jsearch",
        name: "JSearch",
        enabled: true,
        url: "",
        companyId: "",
        actor: "",
      },
    ],
  });
}

export const salarySchema = z
  .object({
    min: z.number().nonnegative().nullable(),
    max: z.number().nonnegative().nullable(),
    currency: text(12),
    period: z.enum(["year", "month", "week", "day", "hour", "unknown"]),
    text: text(1000),
    estimated: z.boolean(),
  })
  .strict();
export const listingSchema = z
  .object({
    provider: z.enum([...SOURCE_TYPES, "manual"]),
    publisher: text(120),
    sourceId: text(300),
    url: radarUrl,
    applyUrl: optionalUrl,
    observedAt: z.string().datetime(),
  })
  .strict();
export const jobSchema = z
  .object({
    company: text(240).min(1),
    companyUrl: optionalUrl,
    companyId: text(120),
    title: text(240).min(1),
    description: text(80000),
    locations: strings(30),
    country: text(8),
    workplace: z.enum(["onsite", "hybrid", "remote", "unknown"]),
    remoteRegions: strings(20),
    salary: salarySchema.nullable(),
    employmentType: text(120),
    seniority: text(120),
    requisitionId: text(240),
    requisitionNamespace: text(300),
    postedAt: text(40),
    closingDate: text(40).refine((v) => !v || validDateOnly(v)),
    closed: z.boolean(),
    sources: z.array(listingSchema).min(1).max(30),
  })
  .strict();
export type RadarJob = z.infer<typeof jobSchema>;
export const assessmentSchema = z
  .object({
    profileId: id,
    profileName: text(100),
    interest: z.number().min(0).max(100),
    qualification: z.number().min(0).max(100).nullable(),
    seniority: z.number().min(0).max(100),
    confidence: z.number().min(0).max(1),
    feasibility: z.enum(["compatible", "conflict", "unclear"]),
    information: z.enum(["enough", "partial", "insufficient"]),
    reason: text(240),
    evidence: text(1000),
    model: text(80),
    assessedAt: z.string().datetime(),
    cacheKey: text(100),
  })
  .strict();
export type RadarAssessment = z.infer<typeof assessmentSchema>;
export const opportunitySchema = jobSchema
  .extend({
    id,
    version: z.number().int().positive(),
    firstSeenAt: z.string().datetime(),
    lastSeenAt: z.string().datetime(),
    saved: z.boolean(),
    flagged: z.boolean(),
    dismissed: z.boolean(),
    seen: z.boolean(),
    tracked: z.boolean(),
    notes: text(10000),
    applicationId: text(120),
    notified: z.boolean(),
    assessment: assessmentSchema.nullable(),
    profileIds: strings(12),
  })
  .strict();
export type Opportunity = z.infer<typeof opportunitySchema>;
export type RadarRun = {
  id: string;
  status: string;
  createdAt: string;
  finishedAt: string | null;
  found: number;
  scored: number;
  messages: string[];
};
export type RadarSettings = {
  config: RadarConfig;
  version: number;
  providers: Record<string, boolean>;
  runs: RadarRun[];
  usage: { provider: string; units: number; limit: number; period: string }[];
  emailConfigured: boolean;
};
export const radarExportSchema = z
  .object({
    config: radarConfigSchema,
    opportunities: z.array(opportunitySchema).max(10000),
  })
  .strict();
export type RadarExport = z.infer<typeof radarExportSchema>;

export function normalized(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
export function canonicalListingUrl(value: string): string {
  const u = new URL(value);
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  for (const k of [...u.searchParams.keys()])
    if (/^(utm_|trk|trackingId|refId|gh_src|source$)/i.test(k))
      u.searchParams.delete(k);
  const linked =
    u.hostname === "linkedin.com" &&
    u.pathname.match(/\/jobs\/view\/(?:.*-)?(\d+)\/?$/);
  if (linked) {
    u.pathname = `/jobs/view/${linked[1]}`;
    u.search = "";
  }
  u.searchParams.sort();
  u.pathname = u.pathname.replace(/\/$/, "");
  return u.toString();
}
export function listingIdentityKeys(value: string): string[] {
  const canonical = canonicalListingUrl(value),
    u = new URL(canonical);
  const generic =
    /^\/(?:careers?|jobs?|positions?|apply)?\/?$/i.test(u.pathname) &&
    !u.search;
  const keys = !generic ? [`url:${canonical}`] : [];
  const linked =
    u.hostname === "linkedin.com" && u.pathname.match(/\/jobs\/view\/(\d+)/);
  if (linked) keys.push(`board:linkedin:${linked[1]}`);
  const seek =
    /^(?:[\w-]+\.)?seek\.(?:com\.au|co\.nz|com)$/.test(u.hostname) &&
    u.pathname.match(/\/job\/(\d+)/);
  if (seek)
    keys.push(
      `board:seek:${u.hostname.endsWith(".nz") ? "nz" : "au"}:${seek[1]}`,
    );
  if (/^(?:[\w-]+\.)?indeed\.com$/.test(u.hostname) && u.searchParams.get("jk"))
    keys.push(`board:indeed:${u.searchParams.get("jk")}`);
  return keys;
}
export function identityKeys(job: RadarJob): string[] {
  const keys = job.sources.flatMap((s) => [
    ...listingIdentityKeys(s.url),
    ...(s.applyUrl ? listingIdentityKeys(s.applyUrl) : []),
    ...(s.sourceId ? [`source:${s.provider}:${s.sourceId}`] : []),
  ]);
  if (job.requisitionId && job.requisitionNamespace)
    keys.push(`req:${job.requisitionNamespace}:${job.requisitionId}`);
  // Shared titles and even identical template descriptions are not vacancy identifiers.
  return [...new Set(keys)];
}
export function profileMatches(job: RadarJob, p: RadarProfile): boolean {
  if (!p.enabled) return false;
  const title = normalized(job.title),
    content = normalized(`${job.title} ${job.description}`);
  if (job.country && job.country.toLowerCase() !== p.country) return false;
  if (p.exclude.some((s) => s.trim() && title.includes(normalized(s))))
    return false;
  if (
    p.titles.length &&
    !p.titles.some((s) => title.includes(normalized(s))) &&
    !p.keywords.some((s) => content.includes(normalized(s)))
  )
    return false;
  if (p.requiredKeywords.some((s) => !content.includes(normalized(s))))
    return false;
  if (
    p.workplace.length &&
    job.workplace !== "unknown" &&
    !p.workplace.includes(job.workplace)
  )
    return false;
  // Remote geography is separate from workplace. Unknown eligibility stays visible.
  if (
    job.workplace !== "remote" &&
    p.locations.length &&
    job.locations.length &&
    !p.locations.some((s) =>
      job.locations.some(
        (l) =>
          normalized(l).includes(normalized(s)) ||
          normalized(s).includes(normalized(l)),
      ),
    )
  ) {
    const bay =
      p.locations.some((l) => /bay area|silicon valley/i.test(l)) &&
      job.locations.some((l) =>
        /san francisco|san jose|sunnyvale|mountain view|palo alto|menlo park|cupertino|santa clara/i.test(
          l,
        ),
      );
    if (!bay) return false;
  }
  if (
    p.employmentTypes.length &&
    job.employmentType &&
    !p.employmentTypes.some((t) =>
      normalized(job.employmentType).includes(normalized(t)),
    )
  )
    return false;
  const s = job.salary;
  if (
    s &&
    !s.estimated &&
    s.currency === p.currency &&
    s.period === p.salaryPeriod
  ) {
    if (p.salaryMin !== null && s.max !== null && s.max < p.salaryMin)
      return false;
    if (p.salaryMax !== null && s.min !== null && s.min > p.salaryMax)
      return false;
  }
  return !job.closed;
}
export function semanticJob(job: RadarJob) {
  const clean = jobSchema.parse(
    Object.fromEntries(
      Object.keys(jobSchema.shape).map((key) => [
        key,
        job[key as keyof RadarJob],
      ]),
    ),
  );
  return Object.fromEntries(
    Object.entries(clean).filter(([key]) => key !== "sources"),
  );
}
export function nextRadarDate(
  frequency: z.infer<typeof frequencySchema>,
  timezone: string,
  time: string,
  weekday: number,
  monthday: number,
  after = new Date(),
): string | null {
  if (frequency === "disabled") return null;
  // Resolve each local calendar candidate with its actual UTC offset, then verify it.
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const [hour, minute] = time.split(":").map(Number);
  const parts = (ms: number) =>
    Object.fromEntries(
      formatter.formatToParts(ms).map((p) => [p.type, p.value]),
    );
  const local = parts(after.getTime()),
    start = Date.UTC(
      Number(local.year),
      Number(local.month) - 1,
      Number(local.day),
    );
  for (let day = 0; day < 36; day++) {
    const calendar = new Date(start + day * 86400000),
      target = calendar.getTime() + hour * 3600000 + minute * 60000;
    if (frequency === "weekly" && calendar.getUTCDay() !== weekday) continue;
    if (
      frequency === "monthly" &&
      calendar.getUTCDate() !==
        Math.min(
          monthday,
          new Date(
            Date.UTC(calendar.getUTCFullYear(), calendar.getUTCMonth() + 1, 0),
          ).getUTCDate(),
        )
    )
      continue;
    let candidate = target;
    for (let attempt = 0; attempt < 3; attempt++) {
      const p = parts(candidate);
      const represented = Date.UTC(
        Number(p.year),
        Number(p.month) - 1,
        Number(p.day),
        Number(p.hour),
        Number(p.minute),
      );
      candidate += target - represented;
    }
    const valid = parts(candidate);
    if (Number(valid.hour) !== hour || Number(valid.minute) !== minute)
      continue; // Skip nonexistent spring-forward times.
    if (candidate > after.getTime()) return new Date(candidate).toISOString();
  }
  return null;
}
