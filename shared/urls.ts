/** Normalize only a destination field, never arbitrary prose. */
export function normalizeWebUrl(value: string): string {
  const text = value.trim();
  if (!text) return "";
  const candidate = text.startsWith("//")
    ? `https:${text}`
    : /^[a-z][a-z\d+.-]*:/i.test(text)
      ? text
      : `https://${text}`;
  try {
    const url = new URL(candidate);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      !url.hostname ||
      /\s/.test(url.hostname)
    )
      return text;
    // A bare word is not a website. localhost is supported for development.
    if (
      !url.hostname.includes(".") &&
      url.hostname !== "localhost" &&
      !url.hostname.includes(":")
    )
      return text;
    return url.toString();
  } catch {
    return text;
  }
}

const destinationKey =
  /^(url|href|website|sourceUrl|jobUrl|careersUrl|linkedin|github|demoUrl|repoUrl|resumeUrl|coverLetterUrl|meetingUrl)$/i;
export function normalizeDestinationFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeDestinationFields);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      typeof item === "string" && destinationKey.test(key)
        ? normalizeWebUrl(item)
        : key === "researchLinks" && Array.isArray(item)
          ? item.map((link) =>
              typeof link === "string" ? normalizeWebUrl(link) : link,
            )
          : normalizeDestinationFields(item),
    ]),
  );
}
