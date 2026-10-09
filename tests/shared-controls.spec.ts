import { expect, test } from "@playwright/test";
import { DEFAULT_PREFERENCES, type WorkRecord } from "../shared/model";
import { enterEditMode } from "./edit-mode-helper";
test("display name, theme, custom status and typed/calendar dates persist", async ({
  page,
}) => {
  let preferences = { ...DEFAULT_PREFERENCES };
  let direction: WorkRecord = {
    id: "synthetic-direction",
    kind: "path",
    title: "Future work",
    body: "",
    data: {
      category: "direction",
      status: "Future",
      researchLinks: [
        "https://thundergolfer.com/blog/get-to-the-states#fnref:1",
      ],
      startDate: "",
      endDate: "",
    },
    tags: [],
    links: [],
    version: 1,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
  };
  await page.addInitScript(() => sessionStorage.removeItem("work-demo-active"));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname,
      method = route.request().method();
    if (path === "/api/session")
      return route.fulfill({
        json: {
          user: {
            id: "synthetic-controls-owner",
            name: "Original name",
            email: "synthetic@example.invalid",
          },
          configured: true,
          local: false,
        },
      });
    if (path === "/api/preferences") {
      if (method === "PUT")
        preferences = { ...preferences, ...route.request().postDataJSON() };
      return route.fulfill({ json: { preferences } });
    }
    if (path === "/api/records")
      return route.fulfill({
        json: { epoch: "test-current", records: [direction] },
      });
    if (path === `/api/records/${direction.id}` && method === "PATCH") {
      const patch = route.request().postDataJSON();
      if (patch.version !== direction.version)
        return route.fulfill({ status: 409, json: { error: "Conflict" } });
      direction = { ...direction, ...patch, version: direction.version + 1 };
      return route.fulfill({ json: { record: direction } });
    }
    if (path === "/api/goals") return route.fulfill({ json: { goals: [] } });
    return route.fulfill({ json: { events: [], records: [] } });
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/settings");
  await expect(
    page.getByLabel("LeetCode username", { exact: true }),
  ).toHaveAttribute("placeholder", "username");
  await expect(page.getByText("Reduce motion", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("GitHub profile", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByLabel("LinkedIn profile", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Website", { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= window.innerHeight,
    ),
  ).toBe(true);
  await page.getByLabel("Display name", { exact: true }).fill("Chosen name");
  await page
    .getByLabel("LeetCode username", { exact: true })
    .fill("chosen-handle");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator(".appearance-switch")).toHaveAttribute(
    "data-mode",
    "dark",
  );
  await expect(
    page.getByRole("button", { name: "Dark", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Light", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".settings-save-status")).toHaveText("Saved");
  expect(preferences.leetcode).toBe("chosen-handle");
  await expect(
    page
      .locator(".sidebar")
      .getByRole("button", { name: "Account: Chosen name" }),
  ).toBeVisible();
  await page
    .locator(".sidebar")
    .getByRole("link", { name: "Goals", exact: true })
    .click();
  await page.getByRole("tab").first().click();
  await expect(
    page.getByRole("link", { name: "Aussie engineers, get to the states!" }),
  ).toHaveAttribute(
    "href",
    "https://thundergolfer.com/blog/get-to-the-states#fnref:1",
  );
  await enterEditMode(page, "Goals");
  await expect(
    page.getByRole("heading", { name: "Notes", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Links", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".direction-card .rich-block-handle")).toHaveCount(
    0,
  );
  const status = page.getByRole("combobox", { name: "Goal status" });
  await status.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("option", { name: "Pursuing", exact: true }).click();
  await expect.poll(() => direction.data.status).toBe("Pursuing");
  const start = page.getByLabel("Start date", { exact: true });
  await expect(start).toHaveAttribute("type", "text");
  await start.fill("2030-02-12");
  await start.blur();
  await expect.poll(() => direction.data.startDate).toBe("2030-02-12");
  await page
    .getByRole("button", { name: "Choose date", exact: true })
    .first()
    .click();
  await expect(page.locator(".calendar-heading")).toContainText(
    "February 2030",
  );
  await page.getByRole("button", { name: "2030-02-16", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("button", { name: "2030-02-17", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(start).toHaveValue("2030-02-17");
  await expect.poll(() => direction.data.startDate).toBe("2030-02-17");
  await page
    .getByRole("button", { name: "Choose date", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(start).toHaveValue("");
  await expect.poll(() => direction.data.startDate).toBe("");

  const addLink = page.getByRole("button", { name: "Add link", exact: true });
  await addLink.click();
  await expect(page.getByLabel("New link", { exact: true })).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.getByLabel("New link", { exact: true })).toBeVisible();
  await page
    .getByLabel("New link title", { exact: true })
    .fill("Research notes");
  await page
    .getByLabel("New link", { exact: true })
    .fill("https://example.com/research");
  await addLink.click();
  await expect
    .poll(() => direction.data.researchLinks)
    .toContain("https://example.com/research");
});
