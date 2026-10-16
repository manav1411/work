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
  const flag = page.locator(".opportunity-flag");
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
  await expect(page.locator(".publisher-linkedin")).toHaveText("in");
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

test("Employer logos keep bundled marks and resolve other companies by name through the CDN", async ({
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
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="#202128" d="M8 8h48v12H20v24h36v12H8z"/></svg>',
    });
  });
  await page.goto("/applications?tab=radar");
  const cards = page.locator(".opportunity-card");
  await expect(cards).toHaveCount(4);
  const domain = cards.filter({ hasText: "Culture Amp" });
  const byName = cards.filter({ hasText: "Example & Employer" });
  const missing = cards.filter({ hasText: "Missing Employer" });
  await expect(domain.locator(".employer-logo-image")).toHaveAttribute(
    "data-loaded",
    "true",
  );
  await expect(byName.locator(".employer-logo-image")).toHaveAttribute(
    "data-loaded",
    "true",
  );
  await expect(missing.locator(".employer-logo-fallback")).toHaveText("ME");
  await expect(missing.locator("img")).toHaveCount(0);
  await expect(cards.first().locator(".company-glyph")).toBeVisible();
  expect(requested.map((url) => url.pathname).sort()).toEqual([
    "/name/Culture%20Amp",
    "/name/Example%20%26%20Employer",
    "/name/Missing%20Employer",
  ]);
  for (const url of requested) {
    expect(url.searchParams.get("token")).toBe("pk_synthetic-cdn-key");
    expect(url.searchParams.get("format")).toBe("png");
    expect(url.searchParams.get("greyscale")).toBe("true");
    expect(url.searchParams.get("fallback")).toBe("404");
  }
  await expect(domain.locator(".employer-logo-image")).toHaveCSS(
    "filter",
    "grayscale(1)",
  );
  await page.screenshot({
    path: "/tmp/work-employer-logos-light.png",
    fullPage: true,
  });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await expect(domain.locator(".employer-logo-image")).toHaveCSS(
    "filter",
    "grayscale(1) invert(1)",
  );
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
    page.locator(".opportunity-card .employer-logo-image"),
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
  await expect(page.locator(".employer-logo-fallback")).toHaveText("EE");
  expect(remoteRequests).toBe(0);
});
