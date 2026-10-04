import type {
  ConnectorDiscovery,
  ConnectorSelection,
} from "../../shared/connectors";

const REQUEST_TIMEOUT_MS = 12_000;
const MAX_JSON_BYTES = 2_000_000;
const MAX_MARKDOWN_BYTES = 450_000;
const MAX_README_BYTES = 350_000;
const GITHUB_API = "https://api.github.com";
const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2026-03-11";

export class ProviderFailure extends Error {
  constructor(
    message: string,
    public status: number = 502,
    public retryAfterSeconds: number = 300,
  ) {
    super(message);
    this.name = "ProviderFailure";
  }
}

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function boundedString(value: unknown, max = 100_000): string | null {
  return typeof value === "string" && value.length <= max ? value : null;
}

function retryAfter(response: Response): number {
  const raw = response.headers.get("Retry-After");
  if (!raw) return 300;
  const seconds = Number(raw);
  if (Number.isFinite(seconds))
    return Math.max(1, Math.min(86_400, Math.ceil(seconds)));
  const date = Date.parse(raw);
  return Number.isFinite(date)
    ? Math.max(1, Math.min(86_400, Math.ceil((date - Date.now()) / 1000)))
    : 300;
}

function failureForStatus(
  response: Response,
  provider: string,
): ProviderFailure {
  if (
    response.status === 429 ||
    (response.status === 403 &&
      (response.headers.get("X-RateLimit-Remaining") === "0" ||
        response.headers.has("Retry-After")))
  ) {
    const reset = Number(response.headers.get("X-RateLimit-Reset"));
    return new ProviderFailure(
      `${provider} rate limit reached`,
      429,
      response.headers.has("Retry-After") || !reset
        ? retryAfter(response)
        : Math.max(1, Math.min(86_400, Math.ceil(reset - Date.now() / 1000))),
    );
  }
  if (response.status === 401)
    return new ProviderFailure(`${provider} authorization failed`, 401, 300);
  if (response.status === 403)
    return new ProviderFailure(`${provider} access is forbidden`, 403, 300);
  if (response.status === 404)
    return new ProviderFailure(`${provider} resource was not found`, 404, 300);
  return new ProviderFailure(`${provider} request failed`, 502, 300);
}

async function readBounded(
  response: Response,
  maxBytes: number,
  provider: string,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ProviderFailure(
          `${provider} response exceeded the size limit`,
          502,
          300,
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ProviderFailure) throw error;
    throw new ProviderFailure(
      `${provider} response could not be read`,
      502,
      300,
    );
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function requestText(
  url: string,
  init: RequestInit,
  provider: string,
  maxBytes = MAX_JSON_BYTES,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      // workerd rejects redirect:"error". Manual mode lets the status check
      // reject redirects without forwarding credentials to another URL.
      redirect: "manual",
    });
    if (!response.ok) throw failureForStatus(response, provider);
    return await readBounded(response, maxBytes, provider);
  } catch (error) {
    if (error instanceof ProviderFailure) throw error;
    throw new ProviderFailure(`${provider} is unavailable`, 502, 300);
  } finally {
    clearTimeout(timeout);
  }
}

async function requestValue(
  url: string,
  init: RequestInit,
  provider: string,
): Promise<unknown> {
  const raw = await requestText(url, init, provider, MAX_JSON_BYTES);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ProviderFailure(`${provider} returned invalid data`, 502, 300);
  }
}

async function requestJson(
  url: string,
  init: RequestInit,
  provider: string,
): Promise<JsonObject> {
  const value = await requestValue(url, init, provider);
  const parsed = object(value);
  if (!parsed)
    throw new ProviderFailure(
      `${provider} returned an invalid response`,
      502,
      300,
    );
  return parsed;
}

function providerHeaders(
  provider: "github" | "notion",
  token?: string,
  accept?: string,
): HeadersInit {
  const headers: Record<string, string> =
    provider === "github"
      ? {
          Accept: accept ?? "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "Work-Connectors",
        }
      : {
          "Notion-Version": NOTION_VERSION,
          Accept: accept ?? "application/json",
        };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (provider === "notion") headers["Content-Type"] = "application/json";
  return headers;
}

function pageNumber(cursor?: string): number {
  if (cursor === undefined || cursor === "") return 1;
  if (!/^\d{1,6}$/.test(cursor))
    throw new ProviderFailure("Invalid pagination cursor", 400, 300);
  const page = Number(cursor);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100_000) {
    throw new ProviderFailure("Invalid pagination cursor", 400, 300);
  }
  return page;
}

function parseIsoDate(value: unknown, message: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new ProviderFailure(message, 502, 300);
  }
  return new Date(value).toISOString();
}

function normalizedUsername(
  input: string,
  provider: string,
  pattern: RegExp,
): string {
  const username = input.trim();
  if (!pattern.test(username))
    throw new ProviderFailure(`Invalid ${provider} username`, 400, 300);
  return username;
}

export function normalizeLeetCodeUsername(input: string): string {
  let value = input.trim();
  if (value.startsWith("https://")) {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    if (
      !["leetcode.com", "www.leetcode.com"].includes(url.hostname) ||
      url.username ||
      url.password ||
      !(parts.length === 1 || (parts.length === 2 && parts[0] === "u"))
    )
      throw new ProviderFailure(
        "Enter a LeetCode username or profile URL",
        400,
      );
    value = parts.at(-1)!;
  }
  return normalizedUsername(value, "LeetCode", /^[A-Za-z0-9_-]{1,30}$/);
}

export async function fetchGitHubProfile(
  username: string,
): Promise<{ id: string; login: string }> {
  const profile = await requestJson(
    `${GITHUB_API}/users/${encodeURIComponent(username)}`,
    { headers: providerHeaders("github") },
    "GitHub",
  );
  if (
    typeof profile.id !== "number" ||
    !Number.isSafeInteger(profile.id) ||
    profile.id <= 0 ||
    typeof profile.login !== "string"
  )
    throw new ProviderFailure("GitHub returned invalid account data");
  return { id: String(profile.id), login: profile.login };
}

interface LeetCodeActivity {
  sourceKey: string;
  title: string;
  url: string;
  occurredAt: string;
  problemSlug?: string;
}

export async function fetchLeetCode(username: string): Promise<{
  snapshot: Record<string, unknown>;
  activities: LeetCodeActivity[];
}> {
  const normalized = normalizeLeetCodeUsername(username);
  const query = `query publicProfile($username: String!, $limit: Int!) {
    matchedUser(username: $username) {
      username
      profile { ranking }
      submitStats { acSubmissionNum { difficulty count } }
      userCalendar { submissionCalendar }
    }
    allQuestionsCount { difficulty count }
      recentAcSubmissionList(username: $username, limit: $limit) { id title titleSlug timestamp }
  }`;
  const payload = await requestJson(
    "https://leetcode.com/graphql",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Referer: "https://leetcode.com",
        "User-Agent": "Mozilla/5.0 (compatible; WorkConnectors/1.0)",
      },
      body: JSON.stringify({
        query,
        variables: { username: normalized, limit: 20 },
      }),
    },
    "LeetCode",
  );
  const data = object(payload.data);
  if (!data)
    throw new ProviderFailure(
      "LeetCode returned invalid profile data",
      502,
      300,
    );
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new ProviderFailure("LeetCode could not load this profile", 502, 300);
  }
  const user = object(data.matchedUser);
  if (!user)
    throw new ProviderFailure("LeetCode profile was not found", 404, 300);

  const counts = (value: unknown): Record<string, number> => {
    const result: Record<string, number> = {
      All: 0,
      Easy: 0,
      Medium: 0,
      Hard: 0,
    };
    if (!Array.isArray(value)) return result;
    for (const item of value.slice(0, 8)) {
      const row = object(item);
      const count = row?.count;
      const difficulty = row?.difficulty;
      if (
        (difficulty === "All" ||
          difficulty === "Easy" ||
          difficulty === "Medium" ||
          difficulty === "Hard") &&
        typeof count === "number" &&
        Number.isFinite(count) &&
        count >= 0
      )
        result[difficulty] = count;
    }
    return result;
  };
  const calendarRaw = object(user.userCalendar)?.submissionCalendar;
  const calendar: Record<string, number> = {};
  if (typeof calendarRaw === "string" && calendarRaw.length <= 500_000) {
    try {
      const parsed: unknown = JSON.parse(calendarRaw);
      const entries = object(parsed);
      if (entries) {
        for (const [timestamp, amount] of Object.entries(entries).slice(
          0,
          10_000,
        )) {
          if (
            /^\d{1,12}$/.test(timestamp) &&
            typeof amount === "number" &&
            Number.isFinite(amount) &&
            amount >= 0
          ) {
            calendar[timestamp] = amount;
          }
        }
      }
    } catch {
      /* malformed calendar is omitted */
    }
  }
  const ranking = object(user.profile)?.ranking;
  const activities: LeetCodeActivity[] = [];
  if (Array.isArray(data.recentAcSubmissionList)) {
    for (const value of data.recentAcSubmissionList.slice(0, 20)) {
      const row = object(value);
      const slug = row ? string(row.titleSlug) : null;
      const title = row ? boundedString(row.title, 300) : null;
      const rawTimestamp = row?.timestamp;
      const timestamp =
        typeof rawTimestamp === "string" && /^\d{1,12}$/.test(rawTimestamp)
          ? Number(rawTimestamp)
          : typeof rawTimestamp === "number"
            ? rawTimestamp
            : NaN;
      if (
        !slug ||
        !/^[a-z0-9-]{1,160}$/i.test(slug) ||
        !title ||
        !Number.isFinite(timestamp) ||
        timestamp <= 0
      )
        continue;
      const occurredAt = new Date(timestamp * 1000);
      if (!Number.isFinite(occurredAt.getTime())) continue;
      const rawId = row?.id;
      const submissionId =
        typeof rawId === "string" && /^\d{1,30}$/.test(rawId)
          ? rawId
          : typeof rawId === "number" &&
              Number.isSafeInteger(rawId) &&
              rawId > 0
            ? String(rawId)
            : null;
      activities.push({
        sourceKey: `${normalized.toLowerCase()}:${submissionId ?? `${slug}:${timestamp}`}`,
        title,
        url: `https://leetcode.com/problems/${encodeURIComponent(slug)}/`,
        occurredAt: occurredAt.toISOString(),
        problemSlug: slug,
      });
    }
  }
  return {
    snapshot: {
      username: normalized,
      ranking:
        typeof ranking === "number" && Number.isFinite(ranking)
          ? ranking
          : null,
      solved: counts(object(user.submitStats)?.acSubmissionNum),
      totalQuestions: counts(data.allQuestionsCount),
      calendar,
      recent: activities.map((activity) => ({
        title: activity.title,
        titleSlug: activity.problemSlug,
        timestamp: String(Math.floor(Date.parse(activity.occurredAt) / 1000)),
      })),
      recentIsPartial: true,
    },
    activities,
  };
}

function githubRepoSelection(value: unknown): ConnectorSelection | null {
  const repo = object(value);
  const id = repo?.id;
  const name = string(repo?.name);
  const fullName = string(repo?.full_name);
  const url = string(repo?.html_url);
  if (
    typeof id !== "number" ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !name ||
    !fullName ||
    !url
  )
    return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com")
      return null;
  } catch {
    return null;
  }
  return { id: String(id), title: name, url };
}

export async function discoverGitHub(
  username: string,
  token?: string,
  cursor?: string,
): Promise<ConnectorDiscovery> {
  const normalized = normalizedUsername(
    username,
    "GitHub",
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37})$/,
  );
  const page = pageNumber(cursor);
  const url = token
    ? new URL(`${GITHUB_API}/installation/repositories`)
    : new URL(`${GITHUB_API}/users/${encodeURIComponent(normalized)}/repos`);
  url.searchParams.set("per_page", "30");
  url.searchParams.set("page", String(page));
  const response = token
    ? await requestJson(
        url.toString(),
        {
          headers: providerHeaders("github", token),
        },
        "GitHub",
      )
    : await requestValue(
        url.toString(),
        {
          headers: providerHeaders("github"),
        },
        "GitHub",
      );
  const rawRepos = token ? object(response)?.repositories : response;
  if (!Array.isArray(rawRepos))
    throw new ProviderFailure(
      "GitHub returned invalid repository data",
      502,
      300,
    );
  const repos = rawRepos.flatMap((repo) => {
    const selection = githubRepoSelection(repo);
    return selection ? [selection] : [];
  });
  const cursorNext = rawRepos.length === 30 ? String(page + 1) : null;
  return { items: repos, cursor: cursorNext };
}

function plainMarkdown(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<([a-z][\w:-]*)(?:\s[^<>]*?)?\s*\/?>/gi, "&lt;$1&gt;")
    .replace(/<\/([a-z][\w:-]*)\s*>/gi, "&lt;/$1&gt;");
}

export async function fetchGitHubRepository(
  selectionId: string,
  token?: string,
): Promise<{
  sourceId: string;
  title: string;
  body: string;
  url: string;
  updatedAt: string;
  data: Record<string, unknown>;
}> {
  if (
    !/^\d{1,20}$/.test(selectionId) ||
    !Number.isSafeInteger(Number(selectionId)) ||
    Number(selectionId) <= 0
  ) {
    throw new ProviderFailure("Invalid GitHub repository selection", 400, 300);
  }
  const repo = await requestJson(
    `${GITHUB_API}/repositories/${selectionId}`,
    {
      headers: providerHeaders("github", token),
    },
    "GitHub",
  );
  if (
    typeof repo.id !== "number" ||
    String(repo.id) !== selectionId ||
    typeof repo.name !== "string" ||
    typeof repo.full_name !== "string"
  ) {
    throw new ProviderFailure(
      "GitHub returned invalid repository data",
      502,
      300,
    );
  }
  if (repo.private === true && !token)
    throw new ProviderFailure(
      "Private GitHub repository requires installation access",
      403,
      300,
    );
  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repo.full_name)) {
    throw new ProviderFailure(
      "GitHub returned invalid repository data",
      502,
      300,
    );
  }
  const htmlUrl = string(repo.html_url);
  let publicUrl: string;
  try {
    const parsed = new URL(htmlUrl ?? "");
    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com")
      throw new Error("bad url");
    publicUrl = parsed.toString();
  } catch {
    throw new ProviderFailure(
      "GitHub returned invalid repository data",
      502,
      300,
    );
  }
  const description = boundedString(repo.description, 2_000) ?? "";
  const updatedAt = parseIsoDate(
    repo.updated_at,
    "GitHub returned an invalid update time",
  );
  const readmePath = `${GITHUB_API}/repos/${repo.full_name.split("/").map(encodeURIComponent).join("/")}/readme`;
  let readme = "";
  try {
    readme = await requestText(
      readmePath,
      {
        headers: providerHeaders("github", token, "application/vnd.github.raw"),
      },
      "GitHub",
      MAX_README_BYTES,
    );
  } catch (error) {
    if (
      !(error instanceof ProviderFailure) ||
      (error.status !== 404 && error.status !== 403)
    )
      throw error;
  }
  const cleanReadme = plainMarkdown(readme.slice(0, MAX_README_BYTES)).trim();
  const body = [description, cleanReadme].filter(Boolean).join("\n\n");
  const topics = Array.isArray(repo.topics)
    ? repo.topics
        .slice(0, 50)
        .filter(
          (topic): topic is string =>
            typeof topic === "string" && topic.length <= 100,
        )
    : [];
  return {
    sourceId: selectionId,
    title: repo.name,
    body,
    url: publicUrl,
    updatedAt,
    data: {
      repoUrl: publicUrl,
      technologies: [string(repo.language), ...topics].filter(
        (item): item is string => Boolean(item),
      ),
      sourceDescription: description,
      sourceName: repo.name,
      topics,
      archived: repo.archived === true,
      defaultBranch: boundedString(repo.default_branch, 200),
    },
  };
}

function notionTitle(page: JsonObject): string {
  const properties = object(page.properties);
  if (properties) {
    for (const property of Object.values(properties)) {
      const prop = object(property);
      if (prop?.type !== "title" || !Array.isArray(prop.title)) continue;
      const title = prop.title
        .flatMap((part) => {
          const text = object(part)?.plain_text;
          return typeof text === "string" ? [text] : [];
        })
        .join("")
        .trim();
      if (title) return title.slice(0, 500);
    }
  }
  return "Untitled";
}

function notionPageSelection(value: unknown): ConnectorSelection | null {
  const page = object(value);
  const id = page ? normalizeNotionIdValue(page.id) : null;
  const url = page ? string(page.url) : null;
  if (!id || !url || page?.object !== "page") return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "https:" ||
    !["notion.so", "www.notion.so"].includes(parsed.hostname)
  )
    return null;
  return { id, title: notionTitle(page), url: parsed.toString() };
}

export async function fetchNotionBot(token: string): Promise<{
  accountId: string;
  label: string;
}> {
  const result = await requestJson(
    `${NOTION_API}/users/me`,
    { headers: providerHeaders("notion", token) },
    "Notion",
  );
  const bot = object(result.bot);
  const botId = string(result.id);
  if (!bot || !botId)
    throw new ProviderFailure("Notion returned an incomplete connection", 502);
  return {
    accountId: string(bot.workspace_id) || botId,
    label:
      string(bot.workspace_name) || string(result.name) || "Notion workspace",
  };
}

export async function discoverNotion(
  token: string,
  cursor?: string,
): Promise<ConnectorDiscovery> {
  const body: JsonObject = {
    page_size: 50,
    filter: { property: "object", value: "page" },
    sort: { direction: "descending", timestamp: "last_edited_time" },
  };
  if (cursor) body.start_cursor = normalizeCursor(cursor);
  const result = await requestJson(
    `${NOTION_API}/search`,
    {
      method: "POST",
      headers: providerHeaders("notion", token),
      body: JSON.stringify(body),
    },
    "Notion",
  );
  if (!Array.isArray(result.results))
    throw new ProviderFailure("Notion returned invalid search data", 502, 300);
  const items = result.results.flatMap((page) => {
    const selection = notionPageSelection(page);
    return selection ? [selection] : [];
  });
  const next =
    result.has_more === true && typeof result.next_cursor === "string"
      ? result.next_cursor
      : null;
  return { items, cursor: next };
}

function normalizeCursor(cursor: string): string {
  const normalized = normalizeNotionIdValue(cursor);
  if (!normalized)
    throw new ProviderFailure("Invalid pagination cursor", 400, 300);
  return normalized;
}

function normalizeNotionIdValue(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const match = input.match(
    /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/i,
  );
  if (!match) return null;
  const compact = match[0].replace(/-/g, "").toLowerCase();
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

export function normalizeNotionPageId(input: string): string {
  const id = normalizeNotionIdValue(input.trim());
  if (!id) throw new ProviderFailure("Invalid Notion page ID", 400, 300);
  return id;
}

interface NotionMedia {
  url: string;
  filename: string;
}

function safeHttpsUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function attr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match?.[2];
}

function inlineText(markdown: string): string {
  return markdown
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNotionMarkdown(markdown: string): {
  body: string;
  media: NotionMedia[];
  childPageIds: string[];
  warnings: string[];
} {
  const media: NotionMedia[] = [];
  const childPageIds = new Set<string>();
  const warnings = new Set<string>();
  let body = markdown;
  body = body.replace(
    /<page\b([^>]*)>([\s\S]*?)<\/page\s*>/gi,
    (_all, attributes: string, text: string) => {
      const id = normalizeNotionIdValue(attr(attributes, "id"));
      const url = safeHttpsUrl(attr(attributes, "url"));
      const title = inlineText(text) || "Notion page";
      if (id) childPageIds.add(id);
      if (url) return `[${title.replace(/\]/g, "\\]")}](${url})`;
      if (id)
        return `[${title.replace(/\]/g, "\\]")}](${`https://www.notion.so/${id}`})`;
      return title;
    },
  );
  body = body.replace(
    /<(file|pdf|image|audio|video)\b([^<>]*?)\/\s*>/gi,
    (_all, kind: string, attributes: string) => {
      const url = safeHttpsUrl(attr(attributes, "url"));
      const filename = (
        attr(attributes, "name") ??
        attr(attributes, "filename") ??
        `${kind} attachment`
      ).slice(0, 255);
      if (!url) return filename;
      media.push({ url, filename });
      return `[${filename.replace(/\]/g, "\\]")}](${url})`;
    },
  );
  body = body.replace(
    /<(file|pdf|image|audio|video)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi,
    (_all, kind: string, attributes: string, text: string) => {
      const url = safeHttpsUrl(attr(attributes, "url"));
      const filename = (
        attr(attributes, "name") ??
        attr(attributes, "filename") ??
        (inlineText(text) || `${kind} attachment`)
      ).slice(0, 255);
      if (!url) return filename;
      if (kind.toLowerCase() === "image") media.push({ url, filename });
      else if (["file", "pdf", "audio", "video"].includes(kind.toLowerCase()))
        media.push({ url, filename });
      return `[${filename.replace(/\]/g, "\\]")}](${url})`;
    },
  );
  body = body.replace(
    /!\[([^\]]*)\]\((https:\/\/[^\s)]+)(?:\s+[^)]*)?\)/gi,
    (match, alt: string, rawUrl: string) => {
      const url = safeHttpsUrl(rawUrl);
      if (url)
        media.push({ url, filename: (alt || "Notion image").slice(0, 255) });
      return match;
    },
  );
  body = body.replace(
    /<unknown\b([^>]*)>([\s\S]*?)<\/unknown\s*>/gi,
    (_all, attributes: string) => {
      warnings.add("unknown_blocks");
      const id = attr(attributes, "id");
      return id
        ? `[Unavailable Notion content (${id.slice(0, 36)})]`
        : "[Unavailable Notion content]";
    },
  );
  body = body.replace(
    /<callout\b[^>]*>([\s\S]*?)<\/callout\s*>/gi,
    (_all, text: string) => `> ${text.trim()}`,
  );
  body = body.replace(
    /<details\b[^>]*>([\s\S]*?)<\/details\s*>/gi,
    (_all, text: string) => text.trim(),
  );
  body = body.replace(
    /<summary\b[^>]*>([\s\S]*?)<\/summary\s*>/gi,
    (_all, text: string) => `**${inlineText(text)}**\n\n`,
  );
  // Keep tabular content readable when enhanced Markdown contains HTML tables.
  body = body.replace(
    /<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi,
    (_all, table: string) => {
      const rows: string[][] = [];
      for (const rowMatch of table.matchAll(
        /<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi,
      )) {
        const cells = [
          ...rowMatch[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]\s*>/gi),
        ].map((cell) => inlineText(cell[1]).replace(/\|/g, "\\|"));
        if (cells.length) rows.push(cells);
      }
      if (!rows.length) return inlineText(table);
      const width = Math.max(...rows.map((row) => row.length));
      const format = (row: string[]) =>
        `| ${Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ")} |`;
      return [
        format(rows[0]),
        format(Array.from({ length: width }, () => "---")),
        ...rows.slice(1).map(format),
      ].join("\n");
    },
  );
  body = body.replace(/<unknown\b[^>]*\/?\s*>/gi, () => {
    warnings.add("unknown_blocks");
    return "[Unavailable Notion content]";
  });
  body = body
    .replace(/<([a-z][\w:-]*)(?:\s[^<>]*?)?\s*\/?>/gi, "&lt;$1&gt;")
    .replace(/<\/([a-z][\w:-]*)\s*>/gi, "&lt;/$1&gt;")
    .replace(/<!--[\s\S]*?-->/g, "");
  return {
    body: body.trim(),
    media,
    childPageIds: [...childPageIds],
    warnings: [...warnings],
  };
}

export async function fetchNotionPage(
  id: string,
  token: string,
): Promise<{
  sourceId: string;
  title: string;
  body: string;
  url: string;
  updatedAt: string;
  data: Record<string, unknown>;
  media: Array<{ url: string; filename: string }>;
  childPageIds: string[];
}> {
  const pageId = normalizeNotionPageId(id);
  const page = await requestJson(
    `${NOTION_API}/pages/${pageId}`,
    {
      headers: providerHeaders("notion", token),
    },
    "Notion",
  );
  const markdownPayload = await requestJson(
    `${NOTION_API}/pages/${pageId}/markdown`,
    {
      headers: providerHeaders("notion", token),
    },
    "Notion",
  );
  const rawMarkdown = boundedString(
    markdownPayload.markdown,
    MAX_MARKDOWN_BYTES,
  );
  if (rawMarkdown === null)
    throw new ProviderFailure("Notion returned invalid page content", 502, 300);
  const normalized = normalizeNotionMarkdown(rawMarkdown);
  if (normalized.body.length > MAX_MARKDOWN_BYTES) {
    throw new ProviderFailure(
      "Notion page content exceeded the size limit",
      502,
      300,
    );
  }
  if (markdownPayload.truncated === true)
    normalized.warnings.push("truncated_content");
  if (
    Array.isArray(markdownPayload.unknown_block_ids) &&
    markdownPayload.unknown_block_ids.length > 0
  ) {
    normalized.warnings.push("unknown_blocks");
  }
  const title = notionTitle(page);
  const pageUrl = string(page.url);
  let url: string;
  try {
    const parsed = new URL(pageUrl ?? "");
    if (
      parsed.protocol !== "https:" ||
      !["notion.so", "www.notion.so"].includes(parsed.hostname)
    )
      throw new Error("bad url");
    url = parsed.toString();
  } catch {
    url = `https://www.notion.so/${pageId}`;
  }
  const childPageIds = new Set(normalized.childPageIds);
  if (Array.isArray(markdownPayload.child_page_ids)) {
    for (const value of markdownPayload.child_page_ids) {
      const childId = normalizeNotionIdValue(value);
      if (childId) childPageIds.add(childId);
    }
  }
  return {
    sourceId: pageId,
    title,
    body: normalized.body,
    url,
    updatedAt: parseIsoDate(
      page.last_edited_time,
      "Notion returned an invalid update time",
    ),
    data: {
      truncated: markdownPayload.truncated === true,
      unknownBlockIds: Array.isArray(markdownPayload.unknown_block_ids)
        ? markdownPayload.unknown_block_ids
            .flatMap((value) => {
              const block = object(value);
              const blockId = block ? normalizeNotionIdValue(block.id) : null;
              return blockId ? [blockId] : [];
            })
            .slice(0, 100)
        : [],
      warnings: [...new Set(normalized.warnings)],
    },
    media: [
      ...new Map(normalized.media.map((item) => [item.url, item])).values(),
    ].slice(0, 200),
    childPageIds: [...childPageIds].slice(0, 100),
  };
}
