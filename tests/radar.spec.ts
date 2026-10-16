import { test, expect, type Page } from "@playwright/test";
import {
  defaultRadarConfig,
  jobSchema,
  type Opportunity,
} from "../shared/radar";
import { DEFAULT_PREFERENCES, type WorkRecord } from "../shared/model";
import { enterEditMode } from "./edit-mode-helper";

async function fixture(page: Page, logoKey = "") {
  const at = "2026-10-16T00:00:00.000Z";
  let config = defaultRadarConfig(),
    version = 1;
  let pings = 0;
  let advances = 0;
  const opportunities: Opportunity[] = [
    {
      ...jobSchema.parse({
        company: "Google",
        companyUrl: "https://google.com",
        companyId: "",
        title: "Junior software engineer",
        description:
          "Build reliable software and APIs with a supportive engineering team.\n\nThis is a synthetic listing used to verify Radar.",
        locations: ["Melbourne, Australia"],
        country: "au",
        workplace: "hybrid",
        remoteRegions: [],
        salary: null,
        employmentType: "Full-time",
        seniority: "Junior",
        requisitionId: "test-1",
        requisitionNamespace: "google",
        postedAt: at,
        closingDate: "",
        closed: false,
        sources: [
          {
            provider: "jsearch",
            publisher: "LinkedIn",
            sourceId: "test-1",
            url: "https://www.linkedin.com/jobs/view/1234",
            applyUrl: "",
            observedAt: at,
          },
        ],
      }),
      id: "synthetic-opportunity",
      version: 1,
      firstSeenAt: at,
      lastSeenAt: at,
      saved: false,
      flagged: false,
      dismissed: false,
      seen: false,
      tracked: false,
      notified: false,
      notes: "",
      applicationId: "",
      profileIds: ["software-au"],
      assessment: {
        profileId: "software-au",
        profileName: "Software engineering · Australia",
        interest: 91,
        qualification: null,
        seniority: 90,
        confidence: 0.85,
        feasibility: "unclear",
        information: "partial",
        reason: "Role duties align with your search.",
        evidence: "",
        model: "jev-1.13.0",
        assessedAt: at,
        cacheKey: "synthetic",
      },
    },
  ];
  const records: WorkRecord[] = [
    {
      id: "resume",
      kind: "asset",
      title: "Main resume",
      body: "",
      tags: [],
      links: [],
      data: { type: "resume" },
      version: 1,
      createdAt: at,
      updatedAt: at,
    },
  ];
  await page.addInitScript(() => sessionStorage.removeItem("work-demo-active"));
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url()),
      path = u.pathname,
      method = route.request().method();
    const body = method === "GET" ? {} : route.request().postDataJSON();
    if (path === "/api/session")
      return route.fulfill({
        json: {
          user: {
            id: "radar-test",
            name: "Synthetic",
            email: "synthetic@example.invalid",
          },
          local: false,
          configured: true,
          logoDevPublishableKey: logoKey,
        },
      });
    if (path === "/api/preferences")
      return route.fulfill({ json: { preferences: DEFAULT_PREFERENCES } });
    if (path === "/api/records" && method === "POST") {
      const record: WorkRecord = {
        ...body,
        id: `manual-${records.length}`,
        tags: body.tags || [],
        links: body.links || [],
        data: body.data || {},
        version: 1,
        createdAt: at,
        updatedAt: at,
      };
      records.push(record);
      return route.fulfill({ json: { record } });
    }
    if (path.startsWith("/api/records/") && method === "PATCH") {
      const record = records.find(
        (item) => item.id === path.split("/").at(-1),
      )!;
      Object.assign(record, body, { version: record.version + 1 });
      return route.fulfill({ json: { record } });
    }
    if (path === "/api/records")
      return route.fulfill({ json: { records, epoch: "radar-test-epoch" } });
    if (path === "/api/radar/settings") {
      if (method === "PUT") {
        config = body.config;
        version++;
      }
      return route.fulfill({
        json: {
          config,
          version,
          providers: { jsearch: true, apify: true, jev: true },
          usage: [],
          runs: pings
            ? [
                {
                  id: "synthetic-run",
                  status: "queued",
                  createdAt: at,
                  finishedAt: null,
                  found: 0,
                  scored: 0,
                  messages: [],
                },
              ]
            : [],
          emailConfigured: false,
        },
      });
    }
    if (path === "/api/radar/opportunities") {
      if (method === "POST") {
        const opportunity: Opportunity = {
          ...opportunities[0],
          ...body,
          id: `manual-opportunity-${opportunities.length}`,
          saved: true,
          assessment: null,
        };
        opportunities.push(opportunity);
        return route.fulfill({ status: 201, json: { opportunity } });
      }
      const view = u.searchParams.get("view"),
        flagged = u.searchParams.get("flagged");
      return route.fulfill({
        json: {
          opportunities: opportunities.filter(
            (j) =>
              (view === "interested"
                ? j.saved
                : !j.saved && !j.tracked && !j.dismissed) &&
              (!flagged || j.flagged),
          ),
          nextCursor: null,
        },
      });
    }
    if (path === "/api/radar/ping") {
      pings++;
      return route.fulfill({ status: 202, json: { runId: "synthetic-run" } });
    }
    if (path === "/api/radar/runs/synthetic-run/advance") {
      advances++;
      return route.fulfill({ status: 202, json: { running: true } });
    }
    if (path.endsWith("/state")) {
      Object.assign(opportunities[0], body, {
        version: opportunities[0].version + 1,
      });
      return route.fulfill({ json: { opportunity: opportunities[0] } });
    }
    if (path.endsWith("/application")) {
      const record = {
        ...body,
        id: "radar-application",
        version: 1,
        createdAt: at,
        updatedAt: at,
      };
      records.push(record);
      opportunities[0].tracked = true;
      opportunities[0].applicationId = record.id;
      return route.fulfill({ json: { record } });
    }
    if (path === "/api/latex/resume")
      return route.fulfill({
        json: {
          project: { latestSuccessfulJob: { textAttachmentId: "resume-text" } },
        },
      });
    if (path === "/api/attachments/resume-text")
      return route.fulfill({
        contentType: "text/plain",
        body: "Synthetic resume: graduate software engineer with API experience.",
      });
    if (path === "/api/radar/digests/preview")
      return route.fulfill({ json: { opportunities } });
    return route.fulfill({ json: { goals: [] } });
  });
  return {
    opportunities,
    records,
    getConfig: () => config,
    getPings: () => pings,
    getAdvances: () => advances,
    resetSetup: () => {
      version = 0;
    },
  };
}
test("Radar cards flag, save, and prefill applications without recording a cancelled form", async ({
  page,
}) => {
  const data = await fixture(page);
  await page.goto("/applications?tab=radar");
  await expect(page.getByRole("tab", { name: /Interested/ })).toBeVisible();
  const card = page.locator(".opportunity-card");
  await expect(card).toHaveCount(1);
  await expect(card.getByRole("link", { name: /Listing/ })).toHaveAttribute(
    "href",
    "https://www.linkedin.com/jobs/view/1234",
  );
  await expect(card.getByText("Unknown", { exact: true })).toBeVisible();
  await card
    .getByRole("button", { name: "Flag Junior software engineer", exact: true })
    .click();
  await expect.poll(() => data.opportunities[0].flagged).toBe(true);
  await expect(
    card.getByRole("button", {
      name: "Unflag Junior software engineer",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(card.locator(".opportunity-flag")).toHaveCSS(
    "color",
    "rgb(246, 207, 73)",
  );
  await expect(card.getByText("Flagged", { exact: true })).toHaveCount(0);
  await enterEditMode(page, "Applications");
  await card
    .getByRole("button", { name: "Save Junior software engineer", exact: true })
    .click();
  await expect(card).toHaveCount(0);
  await page.getByRole("tab", { name: /Interested/ }).click();
  await expect(page.locator(".opportunity-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Add application", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "New application" });
  await expect(dialog.getByLabel("Company", { exact: true })).toHaveValue(
    "Google",
  );
  await expect(dialog.getByLabel("Role", { exact: true })).toHaveValue(
    "Junior software engineer",
  );
  await expect(dialog.getByLabel("Listing link", { exact: true })).toHaveValue(
    "https://www.linkedin.com/jobs/view/1234",
  );
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(data.opportunities[0].tracked).toBe(false);
  await page
    .getByRole("button", { name: "Add application", exact: true })
    .first()
    .click();
  await page
    .getByRole("dialog", { name: "New application" })
    .getByRole("button", { name: "Save application", exact: true })
    .click();
  await expect(page).toHaveURL(/record=radar-application/);
  expect(data.opportunities[0].tracked).toBe(true);
  expect(data.records.find((r) => r.kind === "application")?.data.company).toBe(
    "Google",
  );
});
test("Radar tab orders views and sends one ping only after a complete hold in either mode", async ({
  page,
}) => {
  const data = await fixture(page);
  await page.goto("/applications");
  await expect(
    page.getByRole("tablist", { name: "Application views" }).getByRole("tab"),
  ).toHaveText(["Applications 0", "Radar", "Interested 0"]);
  const tab = page.getByRole("tab", { name: "Radar", exact: true });
  await tab.click();
  await expect(page.locator(".opportunity-card")).toBeVisible();
  await expect(
    page.getByText("Your next opportunity", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^(Run once|Ping)$/ }),
  ).toHaveCount(0);
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 60_000));
  const bounds = (await tab.boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.clock.runFor(2999);
  expect(data.getPings()).toBe(0);
  await page.mouse.up();
  await page.clock.runFor(100);
  expect(data.getPings()).toBe(0);
  await expect(tab).not.toHaveClass(/radar-tab-holding/);

  await page.mouse.down();
  await page.clock.runFor(3000);
  await expect.poll(data.getPings).toBe(1);
  await expect(tab).toHaveClass(/radar-tab-sent/);
  await page.clock.runFor(250);
  await expect(
    page.getByRole("status").filter({ hasText: "Searching…" }),
  ).toBeVisible();
  await page.clock.runFor(5000);
  await expect.poll(data.getAdvances).toBeGreaterThan(0);
  expect(data.getPings()).toBe(1);
  await page.mouse.up();
  expect(data.getConfig().enabled).toBe(false);

  // Switching to edit mode does not change the ping gesture.
  const navigation = page
    .locator(".sidebar")
    .getByRole("link", { name: "Applications", exact: true });
  await navigation.focus();
  await page.keyboard.down("Space");
  await page.clock.runFor(1100);
  await page.keyboard.up("Space");
  await expect(navigation).toHaveAttribute("data-editing", "true");
  await tab.focus();
  await page.keyboard.down("Space");
  await page.clock.runFor(3000);
  await expect.poll(data.getPings).toBe(2);
  await page.keyboard.up("Space");
  expect(data.getConfig().enabled).toBe(false);
});

test("Radar cancels moved and interrupted holds and does not show success on a failed ping", async ({
  page,
}) => {
  const data = await fixture(page);
  await page.goto("/applications?tab=radar");
  await expect(page.locator(".opportunity-card")).toBeVisible();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 60_000));
  const tab = page.getByRole("tab", { name: "Radar", exact: true });
  await tab.dispatchEvent("pointerdown", {
    button: 0,
    isPrimary: true,
    clientX: 10,
    clientY: 10,
  });
  await page.clock.runFor(1000);
  await tab.dispatchEvent("pointermove", { clientX: 30, clientY: 10 });
  await page.clock.runFor(3000);
  expect(data.getPings()).toBe(0);
  await tab.dispatchEvent("pointerdown", { button: 0, isPrimary: true });
  await tab.dispatchEvent("pointercancel");
  await page.clock.runFor(3000);
  expect(data.getPings()).toBe(0);

  await page.route("**/api/radar/ping", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Search temporarily unavailable." },
    }),
  );
  await tab.focus();
  await page.keyboard.down("Space");
  await page.clock.runFor(3000);
  await expect(page.getByRole("alert")).toHaveText(
    "Search temporarily unavailable.",
  );
  await expect(tab).not.toHaveClass(/radar-tab-sent/);
  await page.keyboard.up("Space");
});

test("Radar emits one ring at three seconds with the fill cleared before the server responds", async ({
  page,
}) => {
  const data = await fixture(page);
  let release!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/radar/ping", async (route) => {
    await responseGate;
    await route.fallback();
  });
  await page.goto("/applications?tab=radar");
  await expect(page.locator(".opportunity-card")).toBeVisible();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 60_000));
  const tab = page.getByRole("tab", { name: "Radar", exact: true });
  await tab.focus();
  await page.keyboard.down("Space");
  await page.clock.runFor(2999);
  await expect(page.locator(".radar-tab-pulse")).toHaveCount(0);
  await page.clock.runFor(1);
  await expect(page.locator(".radar-tab-pulse")).toHaveCount(1);
  await expect(tab).not.toHaveClass(/radar-tab-holding/);
  await expect(tab).toHaveAttribute("aria-busy", "true");
  expect(
    await tab.evaluate((el) => getComputedStyle(el, "::before").transform),
  ).toBe("matrix(0, 0, 0, 1, 0, 0)");
  const ring = page.locator(".radar-tab-pulse");
  expect(
    await ring.evaluate((el) => getComputedStyle(el, "::before").content),
  ).toBe("none");
  expect(
    await ring.evaluate((el) => getComputedStyle(el, "::after").content),
  ).toBe("none");
  expect(
    await ring.evaluate((el) => {
      const animation = el.getAnimations()[0];
      animation.pause();
      animation.currentTime = 1500;
      return el.getBoundingClientRect().width > window.innerWidth;
    }),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/work-radar-ping-far.png" });
  await page.keyboard.up("Space");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.clock.runFor(2600);
  await expect(ring).toHaveCount(0);
  release();
  await expect.poll(data.getPings).toBe(1);
  await expect(tab).toHaveAttribute("aria-busy", "false");
  await expect(ring).toHaveCount(0);
});

test("Radar hold opens first-time preferences without sending a ping", async ({
  page,
}) => {
  const data = await fixture(page);
  data.resetSetup();
  await page.goto("/applications?tab=radar");
  await expect(page.locator(".opportunity-card")).toBeVisible();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 60_000));
  const tab = page.getByRole("tab", { name: "Radar", exact: true });
  await tab.focus();
  await page.keyboard.down("Space");
  await page.clock.runFor(3000);
  await expect(
    page.getByRole("dialog", { name: "Radar preferences" }),
  ).toBeVisible();
  expect(data.getPings()).toBe(0);
  await expect(tab).not.toHaveClass(/radar-tab-sent/);
  await page.keyboard.up("Space");
});

test("Radar rolls back a flag when saving fails", async ({ page }) => {
  await fixture(page);
  await page.route("**/api/radar/opportunities/*/state", (route) =>
    route.fulfill({
      status: 409,
      json: { error: "Opportunity changed. Reload and try again." },
    }),
  );
  await page.goto("/applications?tab=radar");
  const flag = page.locator(".opportunity-card .opportunity-flag");
  await flag.click();
  await expect(page.getByRole("alert")).toHaveText(
    "Opportunity changed. Reload and try again.",
  );
  await expect(flag).toHaveAttribute("aria-pressed", "false");
});
test("Radar preferences import editable resume text and preserve separate search profiles", async ({
  page,
}) => {
  const data = await fixture(page);
  await page.goto("/applications?tab=radar");
  await enterEditMode(page, "Applications");
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Radar preferences" });
  await dialog
    .getByRole("textbox", { name: "About you", exact: true })
    .fill("Graduate software engineer. Work rights are user-supplied context.");
  await dialog.getByLabel("Resume from Documents", { exact: true }).click();
  await page.getByRole("option", { name: "Main resume", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Use resume from Documents", exact: true })
    .click();
  await expect(
    dialog.getByRole("textbox", { name: "Resume text", exact: true }),
  ).toHaveValue(/Synthetic resume/);
  await dialog
    .getByRole("textbox", { name: "Role titles", exact: true })
    .first()
    .fill("software engineer, backend engineer");
  await dialog
    .getByRole("textbox", { name: "Role titles", exact: true })
    .first()
    .blur();
  await dialog
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(data.getConfig().profiles).toHaveLength(3);
  expect(data.getConfig().profiles[0].titles).toEqual([
    "software engineer",
    "backend engineer",
  ]);
  expect(data.getConfig().resumeText).toContain("Synthetic resume");
  expect(data.getConfig().enabled).toBe(false);
});
test("Radar fits mobile and retains a separate listing-source mark", async ({
  page,
}) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/applications?tab=radar");
  await expect(page.locator(".opportunity-card")).toBeVisible();
  await expect(
    page.locator(".opportunity-publishers").getByRole("link", {
      name: "LinkedIn listing for Junior software engineer",
    }),
  ).toHaveAttribute("href", "https://www.linkedin.com/jobs/view/1234");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/work-radar-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "/tmp/work-radar-desktop.png",
    fullPage: true,
  });
});

test("Employer logos load in colour by name and keep local fallbacks", async ({
  page,
}) => {
  const data = await fixture(page, "pk_synthetic-cdn-key");
  data.opportunities.push(
    {
      ...data.opportunities[0],
      id: "domain-employer",
      company: "Culture Amp",
      companyUrl: "https://cultureamp.com/careers",
    },
    {
      ...data.opportunities[0],
      id: "name-employer",
      company: "Example & Employer",
      companyUrl: "https://boards.greenhouse.io/example",
    },
    {
      ...data.opportunities[0],
      id: "missing-employer",
      company: "Missing Employer",
      companyUrl: "",
    },
  );
  const requested: URL[] = [];
  await page.route("https://img.logo.dev/**", async (route) => {
    const url = new URL(route.request().url());
    requested.push(url);
    if (url.pathname.includes("Missing")) return route.fulfill({ status: 404 });
    return route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="#315bff" d="M8 8h24v48H8z"/><path fill="#ff57ac" d="M32 8h24v48H32z"/></svg>',
    });
  });
  await page.goto("/applications?tab=radar");
  const cards = page.locator(".opportunity-card");
  await expect(cards).toHaveCount(4);
  const domain = cards.filter({ hasText: "Culture Amp" });
  const byName = cards.filter({ hasText: "Example & Employer" });
  const missing = cards.filter({ hasText: "Missing Employer" });
  await expect(
    domain.locator(".opportunity-employer .employer-logo-image"),
  ).toHaveAttribute("data-loaded", "true");
  await expect(
    byName.locator(".opportunity-employer .employer-logo-image"),
  ).toHaveAttribute("data-loaded", "true");
  await expect(missing.locator(".employer-logo-fallback")).toHaveText("ME");
  await expect(missing.locator(".opportunity-employer img")).toHaveCount(0);
  await expect(
    cards.first().locator(".opportunity-employer .employer-logo-image"),
  ).toHaveAttribute("data-loaded", "true");
  expect([...new Set(requested.map((url) => url.pathname))].sort()).toEqual([
    "/name/Culture%20Amp",
    "/name/Example%20%26%20Employer",
    "/name/Google",
    "/name/LinkedIn",
    "/name/Missing%20Employer",
  ]);
  for (const url of requested) {
    expect(url.searchParams.get("token")).toBe("pk_synthetic-cdn-key");
    expect(url.searchParams.get("format")).toBe("png");
    expect(url.searchParams.has("greyscale")).toBe(false);
    expect(url.searchParams.get("fallback")).toBe("404");
  }
  await expect(
    domain.locator(".opportunity-employer .employer-logo-image"),
  ).toHaveCSS("filter", "none");
  await page.screenshot({
    path: "/tmp/work-employer-logos-light.png",
    fullPage: true,
  });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await expect(
    domain.locator(".opportunity-employer .employer-logo-image"),
  ).toHaveCSS("filter", "none");
  await page.screenshot({
    path: "/tmp/work-employer-logos-dark.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  // Saving a role keeps the same logo when it moves into Interested.
  await page.setViewportSize({ width: 1440, height: 1000 });
  data.opportunities[1].saved = true;
  await page.getByRole("tab", { name: /Interested/ }).click();
  await expect(page.locator(".opportunity-card")).toHaveCount(1);
  await expect(
    page.locator(
      ".opportunity-card .opportunity-employer .employer-logo-image",
    ),
  ).toHaveAttribute("data-loaded", "true");
});

test("Employer logos fall back locally when the key is not configured", async ({
  page,
}) => {
  const data = await fixture(page);
  data.opportunities[0].company = "Example Employer";
  data.opportunities[0].companyUrl = "https://example.org";
  let remoteRequests = 0;
  await page.route("https://img.logo.dev/**", (route) => {
    remoteRequests++;
    return route.abort();
  });
  await page.goto("/applications?tab=radar");
  await expect(
    page.locator(".opportunity-employer .employer-logo-fallback"),
  ).toHaveText("EE");
  expect(remoteRequests).toBe(0);
});

test("Flag filter is icon-only, uses theme outlines, and fills yellow when active", async ({
  page,
}) => {
  const data = await fixture(page);
  data.opportunities[0].flagged = true;
  await page.goto("/applications?tab=radar");
  const filter = page.getByRole("button", {
    name: "Show flagged opportunities",
    exact: true,
  });
  await expect(page.locator(".opportunity-card")).toBeVisible();
  await expect(filter).toHaveText("");
  await expect(filter).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(filter).toHaveCSS("border-width", "0px");
  await expect(filter).toHaveCSS("color", "rgb(0, 0, 0)");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await expect(filter).toHaveCSS("color", "rgb(255, 255, 255)");
  await filter.click();
  await expect(filter).toHaveAttribute("aria-pressed", "true");
  await expect(filter).toHaveCSS("color", "rgb(246, 207, 73)");
  await expect(filter.locator("svg")).toHaveAttribute("fill", "currentColor");
  await expect(page.locator(".opportunity-card")).toHaveCount(1);
  await filter.click();
  await expect(filter).toHaveAttribute("aria-pressed", "false");
});

test("Publisher footer shows one colour logo per site with the correct listing links", async ({
  page,
}) => {
  const data = await fixture(page, "pk_synthetic-cdn-key");
  const source = data.opportunities[0].sources[0];
  data.opportunities[0].sources.push(
    {
      ...source,
      publisher: "Linkedin Jobs",
      url: "https://au.linkedin.com/jobs/view/5678",
    },
    {
      ...source,
      publisher: "Indeed",
      url: "https://au.indeed.com/viewjob?jk=example",
    },
    {
      ...source,
      publisher: "Glassdoor",
      url: "https://www.glassdoor.com.au/job-listing/example",
    },
  );
  const requested: string[] = [];
  await page.route("https://img.logo.dev/**", (route) => {
    requested.push(decodeURIComponent(new URL(route.request().url()).pathname));
    return route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#0a66c2" d="M2 2h20v20H2z"/></svg>',
    });
  });
  await page.goto("/applications?tab=radar");
  const footer = page.locator(".opportunity-publishers");
  await expect(footer.getByRole("link")).toHaveCount(3);
  await expect(footer).toHaveText("");
  await expect(
    footer.getByRole("link", { name: /LinkedIn listing/ }),
  ).toHaveAttribute("href", source.url);
  await expect(
    footer.getByRole("link", { name: /Indeed listing/ }),
  ).toHaveAttribute("href", "https://au.indeed.com/viewjob?jk=example");
  await expect(
    footer.getByRole("link", { name: /Glassdoor listing/ }),
  ).toHaveAttribute("href", "https://www.glassdoor.com.au/job-listing/example");
  await expect(footer.locator("img[data-loaded]")).toHaveCount(3);
  expect(requested).toContain("/name/Glassdoor");
  await page.screenshot({
    path: "/tmp/work-radar-publishers-light.png",
    fullPage: true,
  });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await expect(footer.locator("img").first()).toHaveCSS("filter", "none");
  await page.screenshot({
    path: "/tmp/work-radar-publishers-dark.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(footer.getByRole("link")).toHaveCount(3);
  await expect
    .poll(() =>
      page
        .locator(".sidebar")
        .evaluate((el) => el.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/work-radar-publishers-mobile.png",
    fullPage: true,
  });
});

test("Manually added Interested companies and Applications use the same colour CDN lookup", async ({
  page,
}) => {
  const data = await fixture(page, "pk_synthetic-cdn-key");
  const requests: string[] = [];
  await page.route("https://img.logo.dev/**", (route) => {
    requests.push(decodeURIComponent(new URL(route.request().url()).pathname));
    return route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#36d6bd" d="M2 2h20v20H2z"/></svg>',
    });
  });
  await page.goto("/applications?tab=interested");
  await enterEditMode(page, "Applications");
  await page
    .locator(".page-header")
    .getByRole("button", { name: "Add company", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Company", exact: true })
    .fill("Culture Amp");
  await page.getByRole("textbox", { name: "Company", exact: true }).blur();
  await expect
    .poll(() => data.records.find((record) => record.kind === "company")?.title)
    .toBe("Culture Amp");
  const nav = page
    .locator(".sidebar")
    .getByRole("link", { name: "Applications", exact: true });
  await nav.focus();
  await page.keyboard.down("Space");
  await expect(nav).not.toHaveAttribute("data-editing", "true");
  await page.keyboard.up("Space");
  await expect(
    page.locator(".radar-card .employer-logo-image"),
  ).toHaveAttribute("data-loaded", "true");
  await expect(
    page.locator(".radar-card .employer-logo-image"),
  ).toHaveAttribute("src", /\/name\/Culture%20Amp\?/);
  await expect(page.locator(".radar-card .employer-logo")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await page.getByRole("tab", { name: /^Applications/ }).click();
  await enterEditMode(page, "Applications");
  await page
    .locator(".page-header")
    .getByRole("button", { name: "New application", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "New application",
    exact: true,
  });
  await dialog.getByLabel("Company", { exact: true }).fill("Culture Amp");
  await dialog.getByLabel("Role", { exact: true }).fill("Platform engineer");
  await dialog
    .getByRole("button", { name: "Save application", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.locator(".application-detail .employer-logo-image").first(),
  ).toHaveAttribute("data-loaded", "true");
  await expect(
    page.locator(".application-detail .employer-logo-image").first(),
  ).toHaveAttribute("src", /\/name\/Culture%20Amp\?/);
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Radar", exact: true }).click();
  await page
    .getByRole("button", { name: "Save opportunity", exact: true })
    .click();
  const capture = page.getByRole("dialog", {
    name: "Save an opportunity",
    exact: true,
  });
  await capture.getByLabel("Company", { exact: true }).fill("Culture Amp");
  await capture
    .getByLabel("Role title", { exact: true })
    .fill("Manually saved role");
  await capture
    .getByLabel("Listing URL", { exact: true })
    .fill("https://au.indeed.com/viewjob?jk=manual");
  await capture
    .getByRole("button", { name: "Save to Interested", exact: true })
    .click();
  await expect(capture).not.toBeVisible();
  await page.getByRole("tab", { name: /Interested/ }).click();
  const manual = page
    .locator(".opportunity-card")
    .filter({ hasText: "Manually saved role" });
  await expect(manual.locator(".opportunity-employer img")).toHaveAttribute(
    "data-loaded",
    "true",
  );
  await expect(manual.locator(".opportunity-employer img")).toHaveAttribute(
    "src",
    /\/name\/Culture%20Amp\?/,
  );
  expect(requests.every((path) => path.startsWith("/name/"))).toBe(true);
});
