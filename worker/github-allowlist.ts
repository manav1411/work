export interface AllowedGitHubUser {
  login: string;
  id?: string;
}

// A missing or malformed secret denies everyone. Never fall back to a public
// default, and never accept part of an invalid list.
export function parseGitHubAllowlist(
  value: string | undefined,
): AllowedGitHubUser[] | null {
  if (!value) return null;
  try {
    const entries: unknown = JSON.parse(value);
    if (!Array.isArray(entries)) return null;
    const users: AllowedGitHubUser[] = [];
    for (const entry of entries) {
      if (
        !entry ||
        typeof entry !== "object" ||
        Array.isArray(entry) ||
        Object.keys(entry).some((key) => key !== "login" && key !== "id") ||
        typeof entry.login !== "string" ||
        !/^(?!.*--)[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(entry.login) ||
        (entry.id !== undefined &&
          (typeof entry.id !== "string" || !/^[1-9]\d*$/.test(entry.id)))
      )
        return null;
      users.push({ login: entry.login, ...(entry.id ? { id: entry.id } : {}) });
    }
    return users;
  } catch {
    return null;
  }
}
