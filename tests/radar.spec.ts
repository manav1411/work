import { test, expect, type Page } from "@playwright/test";
import {
  defaultRadarConfig,
  jobSchema,
  type Opportunity,
} from "../shared/radar";
import { DEFAULT_PREFERENCES, type WorkRecord } from "../shared/model";
import { enterEditMode } from "./edit-mode-helper";

async function fixture(page: Page) {
  const at = "2026-10-16T00:00:00.000Z";
  let config = defaultRadarConfig(),
    version = 1;
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
          runs: [],
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
  return { opportunities, records, getConfig: () => config };
}
test("Radar cards flag, save, and prefill applications without recording a cancelled form", async ({
  page,
}) => {
  const data = await fixture(page);
  await page.goto("/applications?tab=radar");
  await enterEditMode(page, "Applications");
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
