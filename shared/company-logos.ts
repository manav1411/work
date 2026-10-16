/** Only publishable CDN keys may be returned to the browser. */
export function logoDevPublishableKey(value = ""): string {
  const key = value.trim();
  return /^pk_[\w-]{1,200}$/.test(key) ? key : "";
}

export function logoDevUrl(
  name: string,
  publishableKey: string,
  theme: "light" | "dark" = "light",
): string {
  const token = logoDevPublishableKey(publishableKey);
  if (!token) return "";
  const company = name.trim().replace(/\s+/g, " ");
  if (
    !company ||
    /^(?:employer not listed|unknown(?: company)?|untitled|n\/a)$/i.test(
      company,
    )
  )
    return "";
  const params = new URLSearchParams({
    token,
    format: "png",
    size: "64",
    theme,
    fallback: "404",
  });
  return `https://img.logo.dev/name/${encodeURIComponent(company)}?${params}`;
}

export function companyInitials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => [...word][0])
      .join("")
      .toUpperCase() || "?"
  );
}
