import {
  jobSchema,
  type RadarJob,
  type RadarProfile,
  type RadarSource,
} from "../shared/radar";
import { readLimitedBody } from "./validation";

export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
export function string(value: unknown): string {
  return typeof value === "string"
    ? value
    : typeof value === "number"
      ? String(value)
      : "";
}
function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}
function countryCode(value: unknown): string {
  const s = string(value).trim().toLowerCase();
  return (
    (
      {
        australia: "au",
        usa: "us",
        "united states": "us",
        "united states of america": "us",
        "united kingdom": "gb",
        uk: "gb",
        "new zealand": "nz",
        canada: "ca",
      } as Record<string, string>
    )[s] || (/^[a-z]{2}$/.test(s) ? s : "")
  );
}
export function plain(value: unknown): string {
  return string(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(?:p|div|li|h[1-6])>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(
      /&(?:amp|lt|gt|quot|apos|nbsp);/g,
      (m) =>
        ({
          "&amp;": "&",
          "&lt;": "<",
          "&gt;": ">",
          "&quot;": '"',
          "&apos;": "'",
          "&nbsp;": " ",
        })[m] || m,
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function url(value: unknown): string {
  try {
    const u = new URL(string(value));
    return ["https:", "http:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.toString().slice(0, 2048)
      : "";
  } catch {
    return "";
  }
}
function date(value: unknown): string {
  const s = string(value);
  const d = s && new Date(s);
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : "";
}
function period(
  value: unknown,
): "year" | "month" | "week" | "day" | "hour" | "unknown" {
  const s = string(value).toLowerCase();
  return /year|annual/.test(s)
    ? "year"
    : s.includes("month")
      ? "month"
      : s.includes("week")
        ? "week"
        : s.includes("day")
          ? "day"
          : s.includes("hour")
            ? "hour"
            : "unknown";
}
export class SourceError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function providerJson(
  endpoint: string,
  init: RequestInit = {},
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new SourceError(
      "NETWORK",
      "The source could not be reached. Retry later.",
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new SourceError(
      `HTTP_${response.status}`,
      response.status === 429
        ? "Source quota or rate limit reached."
        : response.status === 401 || response.status === 403
          ? "Source access was refused. Check its key and free plan."
          : `Source returned HTTP ${response.status}.`,
    );
  }
  const bytes = await readLimitedBody(response, 4 * 1024 * 1024);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new SourceError(
      "FORMAT",
      "The source returned an unexpected format.",
    );
  }
}
export function normalizeJSearch(value: unknown, at: string): RadarJob | null {
  const j = object(value),
    apply = url(j.job_apply_link),
    original = url(j.job_url) || apply;
  const links = [
    { publisher: string(j.job_publisher), apply_link: original },
    ...list(j.apply_options).map(object),
  ].filter((o) => url(o.apply_link));
  const salary =
    number(j.job_min_salary) !== null ||
    number(j.job_max_salary) !== null ||
    string(j.job_salary_string)
      ? {
          min: number(j.job_min_salary),
          max: number(j.job_max_salary),
          currency: string(j.job_salary_currency),
          period: period(j.job_salary_period),
          text: string(j.job_salary_string).slice(0, 1000),
          estimated: Boolean(j.salary_is_predicted),
        }
      : null;
  const valueOut = {
    company: string(j.employer_name) || "Employer not listed",
    companyUrl: url(j.employer_website),
    companyId: "",
    title: string(j.job_title),
    description: plain(j.job_description).slice(0, 80000),
    locations: [
      string(j.job_location) ||
        [j.job_city, j.job_state].filter(Boolean).join(", "),
    ].filter(Boolean),
    country: countryCode(j.job_country),
    workplace:
      j.job_is_remote === true || j.work_arrangement === "remote"
        ? "remote"
        : j.work_arrangement === "hybrid"
          ? "hybrid"
          : j.work_arrangement === "onsite"
            ? "onsite"
            : "unknown",
    remoteRegions: [],
    salary,
    employmentType: string(j.job_employment_type),
    seniority: string(j.seniority_level),
    requisitionId: "",
    requisitionNamespace: "",
    postedAt: date(j.job_posted_at_datetime_utc),
    closingDate: date(
      j.job_offer_expiration_datetime_utc || j.job_expiration_datetime_utc,
    ).slice(0, 10),
    closed: false,
    sources: links.slice(0, 30).map((o) => ({
      provider: "jsearch",
      publisher: string(o.publisher) || "Job listing",
      sourceId:
        string(j.job_uid || j.job_id).length <= 300
          ? string(j.job_uid || j.job_id)
          : "",
      url: url(o.apply_link),
      applyUrl: apply,
      observedAt: at,
    })),
  };
  const parsed = jobSchema.safeParse(valueOut);
  return parsed.success ? parsed.data : null;
}
export type Board = {
  type: "greenhouse" | "lever" | "ashby";
  slug: string;
  endpoint: string;
};
export function employerBoard(value: string): Board | null {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.port)
      return null;
    const host = u.hostname.toLowerCase(),
      slug =
        u.pathname.split("/").filter(Boolean)[0] ||
        u.searchParams.get("for") ||
        "";
    if (!/^[\w-]{1,120}$/.test(slug)) return null;
    if (
      [
        "boards.greenhouse.io",
        "job-boards.greenhouse.io",
        "boards.eu.greenhouse.io",
        "job-boards.eu.greenhouse.io",
      ].includes(host)
    )
      return {
        type: "greenhouse",
        slug,
        endpoint: `https://boards-api.${host.includes(".eu.") ? "eu." : ""}greenhouse.io/v1/boards/${slug}/jobs?content=true`,
      };
    if (["jobs.lever.co", "jobs.eu.lever.co"].includes(host))
      return {
        type: "lever",
        slug,
        endpoint: `https://api.${host.includes(".eu.") ? "eu." : ""}lever.co/v0/postings/${slug}?mode=json&limit=100&skip=0`,
      };
    if (host === "jobs.ashbyhq.com")
      return {
        type: "ashby",
        slug,
        endpoint: `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`,
      };
  } catch {
    /* Unsupported careers pages stay available as links, never arbitrary server fetches. */
  }
  return null;
}
export function normalizeBoard(
  type: Board["type"],
  slug: string,
  employer: string,
  companyId: string,
  value: unknown,
  at: string,
): RadarJob | null {
  const j = object(value),
    categories = object(j.categories),
    addr = object(object(j.address).postalAddress);
  if (type === "ashby" && j.isListed !== true) return null;
  const location =
    string(object(j.location).name) ||
    string(j.location) ||
    string(categories.location);
  const jobUrl = url(j.absolute_url) || url(j.hostedUrl) || url(j.jobUrl);
  const s = object(j.salaryRange),
    compensation = object(j.compensation);
  const component =
    list(compensation.summaryComponents)
      .map(object)
      .find((v) => v.compensationType === "Salary") || {};
  const min = number(s.min) ?? number(component.minValue),
    max = number(s.max) ?? number(component.maxValue);
  const parsed = jobSchema.safeParse({
    company: employer || slug,
    companyUrl: "",
    companyId,
    title: string(j.title) || string(j.text),
    description: plain(
      j.descriptionPlain ||
        j.descriptionHtml ||
        j.content ||
        `${string(j.description)}\n${list(j.lists)
          .map((x) => string(object(x).text) + "\n" + plain(object(x).content))
          .join("\n")}\n${string(j.additionalPlain)}`,
    ).slice(0, 80000),
    locations: [
      ...new Set(
        [
          location,
          ...list(categories.allLocations).map(string),
          ...list(j.secondaryLocations).map((v) => string(object(v).location)),
        ].filter(Boolean),
      ),
    ].slice(0, 30),
    country: countryCode(j.country || addr.addressCountry),
    workplace:
      j.isRemote || /remote/i.test(string(j.workplaceType))
        ? "remote"
        : /hybrid/i.test(string(j.workplaceType))
          ? "hybrid"
          : /on.?site/i.test(string(j.workplaceType))
            ? "onsite"
            : "unknown",
    remoteRegions: [],
    salary:
      min !== null || max !== null
        ? {
            min,
            max,
            currency: string(s.currency) || string(component.currencyCode),
            period: period(s.interval || component.interval),
            text: plain(
              j.salaryDescriptionPlain ||
                compensation.scrapeableCompensationSalarySummary,
            ).slice(0, 1000),
            estimated: false,
          }
        : null,
    employmentType: string(j.employmentType) || string(categories.commitment),
    seniority: string(categories.level),
    requisitionId: string(j.internal_job_id || j.id),
    requisitionNamespace: `${type}:${slug}`,
    postedAt: date(j.publishedAt || j.createdAt || j.updated_at),
    closingDate: "",
    closed: false,
    sources: [
      {
        provider: type,
        publisher: type[0].toUpperCase() + type.slice(1),
        sourceId: `${slug}:${string(j.id) || jobUrl}`,
        url: jobUrl,
        applyUrl: url(j.applyUrl),
        observedAt: at,
      },
    ],
  });
  return parsed.success ? parsed.data : null;
}
export function normalizeApify(
  value: unknown,
  actor: string,
  at: string,
  country = "au",
): RadarJob | null {
  const j = object(value);
  const seek = /seek/i.test(actor),
    sourceId = `${actor}:${string(j.linkedinJobId || j.id || j.jobId || j.job_id) || string(j.url || j.jobUrl)}`;
  const hiddenSalary =
    seek &&
    (j.salary_hiden === true ||
      j.salary_hiden === 1 ||
      j.salary_hiden === "true");
  const parsed = normalizeJSearch(
    {
      ...j,
      job_id: sourceId,
      job_uid: sourceId,
      job_title: j.title || j.positionName || j.jobTitle,
      employer_name:
        j.companyName || j.company || j.company_name || j.advertiser_name,
      employer_website: j.companyWebsite,
      job_apply_link:
        j.url ||
        j.jobUrl ||
        j.link ||
        j.job_url ||
        (seek && /^\d+$/.test(string(j.id))
          ? `https://www.seek.${country === "nz" ? "co.nz" : "com.au"}/job/${j.id}`
          : ""),
      job_description:
        j.description || j.jobDescription || j.descriptionText || j.abstract,
      job_location:
        string(object(j.location).name) || j.location || j.locationName,
      job_country: j.country || j.addressCountry || (seek ? country : ""),
      job_salary_string: hiddenSalary
        ? ""
        : j.salary || j.salaryText || j.salary_display,
      job_min_salary: hiddenSalary
        ? null
        : (j.salaryMinValue ?? j.salaryMin ?? j.salary_minimum),
      job_max_salary: hiddenSalary
        ? null
        : (j.salaryMaxValue ?? j.salaryMax ?? j.salary_maximum),
      job_salary_currency: j.salaryCurrency || j.salary_currency,
      job_salary_period: j.salaryUnit || j.salaryPeriod || j.salary_period,
      salary_is_predicted: j.salaryIsEstimated,
      job_employment_type:
        list(j.jobType || j.work_types)
          .map(string)
          .join(" · ") || string(j.employmentType),
      seniority_level: j.seniorityLevel,
      job_posted_at_datetime_utc: j.postedAt || j.datePosted || j.listed_at,
      job_expiration_datetime_utc: j.validThrough,
      work_arrangement:
        list(j.work_arrangements).map(string).join(" ").toLowerCase() ||
        string(j.workplaceType).toLowerCase(),
      job_publisher: seek
        ? "SEEK"
        : /indeed/i.test(actor)
          ? "Indeed"
          : "LinkedIn",
      job_is_remote: j.isRemote,
    },
    at,
  );
  return parsed
    ? {
        ...parsed,
        sources: parsed.sources.map((s) => ({ ...s, provider: "apify" })),
      }
    : null;
}
export function sourceQuery(profile: RadarProfile, location: string) {
  const terms = profile.titles.length ? profile.titles : profile.keywords;
  const countries = {
    au: "Australia",
    us: "United States",
    gb: "United Kingdom",
    nz: "New Zealand",
    ca: "Canada",
  };
  return `${terms.slice(0, 3).join(" OR ") || "jobs"} jobs in ${location || countries[profile.country]}`;
}
export const APIFY_ACTORS = [
  "parsebird/linkedin-jobs-scraper",
  "saswave/seek-scraper",
  "automation-lab/indeed-scraper",
] as const;
export function validateSource(source: RadarSource): void {
  if (
    ["greenhouse", "lever", "ashby"].includes(source.type) &&
    employerBoard(source.url)?.type !== source.type
  )
    throw new SourceError(
      "UNSUPPORTED",
      "Use a supported employer job-board URL matching this source type.",
    );
  if (
    source.type === "apify" &&
    !(APIFY_ACTORS as readonly string[]).includes(source.actor)
  )
    throw new SourceError(
      "UNSUPPORTED",
      "Choose one of the reviewed job-board collectors.",
    );
}
