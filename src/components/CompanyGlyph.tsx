import type { CSSProperties } from "react";
import { Coffee, SquareArrowOutUpRight } from "lucide-react";
import "./company-glyphs.css";

type CompanyMark = {
  slug: string;
  name: string;
  domains: string[];
  aliases: string[];
  colour: string;
};

// Only curated brands are matched. No favicon service receives private company names.
export const COMPANY_MARKS: CompanyMark[] = [
  {
    slug: "google",
    name: "Google",
    domains: ["google.com"],
    aliases: ["alphabet"],
    colour: "4285F4",
  },
  {
    slug: "microsoft",
    name: "Microsoft",
    domains: ["microsoft.com"],
    aliases: ["msft"],
    colour: "5E5E5E",
  },
  {
    slug: "atlassian",
    name: "Atlassian",
    domains: ["atlassian.com"],
    aliases: [],
    colour: "0052CC",
  },
  {
    slug: "github",
    name: "GitHub",
    domains: ["github.com"],
    aliases: [],
    colour: "",
  },
  {
    slug: "linkedin",
    name: "LinkedIn",
    domains: ["linkedin.com"],
    aliases: [],
    colour: "0A66C2",
  },
  {
    slug: "amazon",
    name: "Amazon",
    domains: ["amazon.com", "amazon.jobs", "aws.amazon.com"],
    aliases: ["aws", "amazon web services"],
    colour: "D87900",
  },
  {
    slug: "apple",
    name: "Apple",
    domains: ["apple.com"],
    aliases: [],
    colour: "",
  },
  {
    slug: "meta",
    name: "Meta",
    domains: ["meta.com", "facebook.com"],
    aliases: ["facebook"],
    colour: "0866FF",
  },
  {
    slug: "netflix",
    name: "Netflix",
    domains: ["netflix.com", "netflixjobs.com"],
    aliases: [],
    colour: "E50914",
  },
  {
    slug: "stripe",
    name: "Stripe",
    domains: ["stripe.com"],
    aliases: [],
    colour: "635BFF",
  },
  {
    slug: "canva",
    name: "Canva",
    domains: ["canva.com"],
    aliases: [],
    colour: "008C91",
  },
  {
    slug: "figma",
    name: "Figma",
    domains: ["figma.com"],
    aliases: [],
    colour: "E45D48",
  },
  {
    slug: "cloudflare",
    name: "Cloudflare",
    domains: ["cloudflare.com"],
    aliases: [],
    colour: "DB6900",
  },
  {
    slug: "datadog",
    name: "Datadog",
    domains: ["datadoghq.com"],
    aliases: [],
    colour: "632CA6",
  },
  {
    slug: "mongodb",
    name: "MongoDB",
    domains: ["mongodb.com"],
    aliases: [],
    colour: "138A3A",
  },
  {
    slug: "snowflake",
    name: "Snowflake",
    domains: ["snowflake.com"],
    aliases: [],
    colour: "168ABD",
  },
  {
    slug: "salesforce",
    name: "Salesforce",
    domains: ["salesforce.com"],
    aliases: [],
    colour: "009EDB",
  },
  {
    slug: "oracle",
    name: "Oracle",
    domains: ["oracle.com"],
    aliases: [],
    colour: "F80000",
  },
  {
    slug: "intel",
    name: "Intel",
    domains: ["intel.com"],
    aliases: [],
    colour: "0071C5",
  },
  {
    slug: "nvidia",
    name: "NVIDIA",
    domains: ["nvidia.com"],
    aliases: [],
    colour: "548D00",
  },
  {
    slug: "amd",
    name: "AMD",
    domains: ["amd.com"],
    aliases: ["advanced micro devices"],
    colour: "",
  },
  {
    slug: "adobe",
    name: "Adobe",
    domains: ["adobe.com"],
    aliases: [],
    colour: "E50000",
  },
  {
    slug: "spotify",
    name: "Spotify",
    domains: ["spotify.com"],
    aliases: [],
    colour: "14883B",
  },
  {
    slug: "uber",
    name: "Uber",
    domains: ["uber.com"],
    aliases: [],
    colour: "",
  },
  {
    slug: "airbnb",
    name: "Airbnb",
    domains: ["airbnb.com"],
    aliases: [],
    colour: "D74556",
  },
  {
    slug: "dropbox",
    name: "Dropbox",
    domains: ["dropbox.com"],
    aliases: [],
    colour: "0061FF",
  },
  {
    slug: "slack",
    name: "Slack",
    domains: ["slack.com"],
    aliases: [],
    colour: "611F69",
  },
  {
    slug: "notion",
    name: "Notion",
    domains: ["notion.so", "notion.com"],
    aliases: [],
    colour: "",
  },
  {
    slug: "gitlab",
    name: "GitLab",
    domains: ["gitlab.com"],
    aliases: [],
    colour: "D44920",
  },
  {
    slug: "vercel",
    name: "Vercel",
    domains: ["vercel.com"],
    aliases: [],
    colour: "",
  },
  {
    slug: "netlify",
    name: "Netlify",
    domains: ["netlify.com"],
    aliases: [],
    colour: "087C83",
  },
  {
    slug: "digitalocean",
    name: "DigitalOcean",
    domains: ["digitalocean.com"],
    aliases: [],
    colour: "0080FF",
  },
  {
    slug: "twilio",
    name: "Twilio",
    domains: ["twilio.com"],
    aliases: [],
    colour: "D81733",
  },
  {
    slug: "shopify",
    name: "Shopify",
    domains: ["shopify.com"],
    aliases: [],
    colour: "578D26",
  },
  {
    slug: "elastic",
    name: "Elastic",
    domains: ["elastic.co"],
    aliases: ["elasticsearch"],
    colour: "006BB4",
  },
  {
    slug: "redhat",
    name: "Red Hat",
    domains: ["redhat.com"],
    aliases: [],
    colour: "EE0000",
  },
  {
    slug: "docker",
    name: "Docker",
    domains: ["docker.com"],
    aliases: [],
    colour: "2496ED",
  },
  {
    slug: "zoom",
    name: "Zoom",
    domains: ["zoom.us", "zoom.com"],
    aliases: [],
    colour: "0B5CFF",
  },
  {
    slug: "samsung",
    name: "Samsung",
    domains: ["samsung.com"],
    aliases: [],
    colour: "1428A0",
  },
  {
    slug: "tesla",
    name: "Tesla",
    domains: ["tesla.com"],
    aliases: [],
    colour: "CC0000",
  },
  {
    slug: "twitch",
    name: "Twitch",
    domains: ["twitch.tv"],
    aliases: [],
    colour: "9146FF",
  },
  {
    slug: "reddit",
    name: "Reddit",
    domains: ["reddit.com"],
    aliases: [],
    colour: "D93900",
  },
  {
    slug: "pinterest",
    name: "Pinterest",
    domains: ["pinterest.com"],
    aliases: [],
    colour: "BD081C",
  },
  {
    slug: "snapchat",
    name: "Snapchat",
    domains: ["snapchat.com", "snap.com"],
    aliases: ["snap"],
    colour: "",
  },
  {
    slug: "palantir",
    name: "Palantir",
    domains: ["palantir.com"],
    aliases: [],
    colour: "",
  },
  {
    slug: "wise",
    name: "Wise",
    domains: ["wise.com"],
    aliases: ["transferwise"],
    colour: "548600",
  },
  {
    slug: "xero",
    name: "Xero",
    domains: ["xero.com"],
    aliases: [],
    colour: "078DAB",
  },
  {
    slug: "leetcode",
    name: "LeetCode",
    domains: ["leetcode.com"],
    aliases: [],
    colour: "B77600",
  },
  {
    slug: "replit",
    name: "Replit",
    domains: ["replit.com"],
    aliases: [],
    colour: "D84F17",
  },
  {
    slug: "linear",
    name: "Linear",
    domains: ["linear.app"],
    aliases: [],
    colour: "5E6AD2",
  },
  {
    slug: "openai",
    name: "OpenAI",
    domains: ["openai.com", "chatgpt.com"],
    aliases: [],
    colour: "",
  },
  {
    slug: "anthropic",
    name: "Anthropic",
    domains: ["anthropic.com", "claude.ai"],
    aliases: [],
    colour: "",
  },
  {
    slug: "proton",
    name: "Proton",
    domains: ["proton.me", "protonmail.com"],
    aliases: [],
    colour: "6D4AFF",
  },
  {
    slug: "asana",
    name: "Asana",
    domains: ["asana.com"],
    aliases: [],
    colour: "DA5262",
  },
];

/** Locally bundled technology marks; resource technology overrides its host. */
const TECHNOLOGY_MARKS: CompanyMark[] = [
  ["python", "Python", ["python.org"], []],
  ["javascript", "JavaScript", [], ["js"]],
  ["typescript", "TypeScript", ["typescriptlang.org"], ["ts"]],
  ["react", "React", ["react.dev", "reactjs.org"], ["react.js"]],
  ["nodedotjs", "Node.js", ["nodejs.org"], ["node", "nodejs"]],
  ["go", "Go", ["go.dev", "golang.org"], ["golang"]],
  ["rust", "Rust", ["rust-lang.org"], []],
  ["cplusplus", "C++", ["cplusplus.com", "cppreference.com"], ["cpp"]],
  ["postgresql", "PostgreSQL", ["postgresql.org"], ["postgres"]],
  ["mysql", "MySQL", ["mysql.com"], []],
  ["sqlite", "SQLite", ["sqlite.org"], []],
  ["redis", "Redis", ["redis.io"], []],
  ["linux", "Linux", ["kernel.org", "linux.org"], []],
  ["git", "Git", ["git-scm.com"], []],
  ["kubernetes", "Kubernetes", ["kubernetes.io"], ["k8s"]],
  ["mdnwebdocs", "MDN", ["developer.mozilla.org"], ["mdn web docs"]],
  ["devdotto", "DEV", ["dev.to"], []],
  ["stackoverflow", "Stack Overflow", ["stackoverflow.com"], []],
  ["freecodecamp", "freeCodeCamp", ["freecodecamp.org"], []],
  ["amazonwebservices", "AWS", ["aws.amazon.com"], ["amazon web services"]],
  ["owasp", "OWASP", ["owasp.org"], []],
  ["readthedocs", "Read the Docs", ["readthedocs.io", "readthedocs.org"], []],
  ["geeksforgeeks", "GeeksforGeeks", ["geeksforgeeks.org"], []],
  ["codewars", "Codewars", ["codewars.com"], []],
  ["w3schools", "W3Schools", ["w3schools.com"], []],
  ["hackerrank", "HackerRank", ["hackerrank.com"], []],
].map(([slug, name, domains, aliases]) => ({
  slug,
  name,
  domains,
  aliases,
  colour: "",
})) as CompanyMark[];

function normalizedName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function companyMark(
  name = "",
  url = "",
  technology = "",
): CompanyMark | "profile" | undefined {
  let hostname = "";
  try {
    hostname = new URL(url.includes("://") ? url : `https://${url}`).hostname
      .toLowerCase()
      .replace(/\.$/, "");
  } catch {
    /* Names still work without a valid destination. */
  }
  if (hostname === "manavdodia.com" || hostname.endsWith(".manavdodia.com"))
    return "profile";
  const normalized = normalizedName(
    name.replace(
      /\s+(?:inc\.?|ltd\.?|limited|pty\s+ltd\.?|corporation|corp\.?)$/i,
      "",
    ),
  );
  const marks = [...TECHNOLOGY_MARKS, ...COMPANY_MARKS];
  const explicit =
    technology &&
    marks.find((mark) =>
      [mark.slug, mark.name, ...mark.aliases].some(
        (alias) => normalizedName(alias) === normalizedName(technology),
      ),
    );
  const byName = normalized
    ? [...COMPANY_MARKS, ...TECHNOLOGY_MARKS].find((mark) =>
        [mark.name, ...mark.aliases].some(
          (alias) => normalizedName(alias) === normalized,
        ),
      )
    : undefined;
  return (
    explicit ||
    byName ||
    TECHNOLOGY_MARKS.find((mark) =>
      [mark.name, ...mark.aliases]
        .filter((alias) => alias.length > 2 || ["Go", "Git"].includes(alias))
        .some((alias) =>
          name.toLowerCase().startsWith(`${alias.toLowerCase()} `),
        ),
    ) ||
    (hostname
      ? marks.find((mark) =>
          mark.domains.some(
            (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
          ),
        )
      : undefined)
  );
}

export function CompanyGlyph({
  name = "",
  url = "",
  technology = "",
}: {
  name?: string;
  url?: string;
  technology?: string;
}) {
  if (
    technology.toLowerCase() === "java" ||
    /^java(?:\s|$)/i.test(name) ||
    /(?:^|\.)java\.com/.test(url)
  )
    return <Coffee className="company-glyph-profile" aria-hidden="true" />;
  const mark = companyMark(name, url, technology);
  if (!mark) return null;
  if (mark === "profile")
    return (
      <SquareArrowOutUpRight
        className="company-glyph-profile"
        aria-hidden="true"
      />
    );
  const style = {
    "--company-glyph-image": `url("/company-glyphs/${mark.slug}.svg")`,
  } as CSSProperties;
  return <span className="company-glyph" style={style} aria-hidden="true" />;
}
