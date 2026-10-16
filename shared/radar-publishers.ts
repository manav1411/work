import type { RadarJob } from "./radar";

const publishers = [
  {
    name: "LinkedIn",
    domains: ["linkedin.com"],
    alias: /^linked\s*in(?:\s+jobs|\.com)?$/i,
  },
  {
    name: "Indeed",
    domains: [
      "indeed.com",
      "indeed.com.au",
      "indeed.co.uk",
      "indeed.ca",
      "indeed.co.nz",
    ],
    alias: /^indeed(?:\s+jobs)?$/i,
  },
  {
    name: "SEEK",
    domains: ["seek.com.au", "seek.co.nz", "seek.com"],
    alias: /^seek(?:\s+jobs)?$/i,
  },
  {
    name: "Glassdoor",
    domains: [
      "glassdoor.com",
      "glassdoor.com.au",
      "glassdoor.co.uk",
      "glassdoor.ca",
      "glassdoor.co.nz",
    ],
    alias: /^glassdoor(?:\s+jobs)?$/i,
  },
  {
    name: "Greenhouse",
    domains: ["greenhouse.io", "greenhouse.com"],
    alias: /^greenhouse$/i,
  },
  { name: "Lever", domains: ["lever.co"], alias: /^lever$/i },
  { name: "Ashby", domains: ["ashbyhq.com"], alias: /^ashby$/i },
];

/** Keep the first listing per publisher; all advertisements remain in details. */
export function radarPublisherLinks(sources: RadarJob["sources"]) {
  const seen = new Set<string>();
  return sources.flatMap((source) => {
    let host: string;
    try {
      const url = new URL(source.url);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        return [];
      host = url.hostname
        .toLowerCase()
        .replace(/\.$/, "")
        .replace(/^www\./, "");
    } catch {
      return [];
    }
    const brand =
      publishers.find((p) =>
        p.domains.some(
          (domain) => host === domain || host.endsWith(`.${domain}`),
        ),
      ) || publishers.find((p) => p.alias.test(source.publisher.trim()));
    const name =
      brand?.name ||
      (source.publisher.trim() &&
      !/^(?:job listing|saved listing)$/i.test(source.publisher.trim())
        ? source.publisher.trim()
        : host);
    const key = brand?.name.toLowerCase() || host;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ key, name, url: source.url }];
  });
}
