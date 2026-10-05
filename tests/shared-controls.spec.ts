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
    deletedAt: null,
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
      return route.fulfill({ json: { records: [direction] } });
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
  await page.goto("/settings");
  await page.getByLabel("Display name", { exact: true }).fill("Chosen name");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".settings-save-status")).toHaveText("Saved");
  await expect(
    page
      .locator(".sidebar")
      .getByRole("button", { name: "Account: Chosen name" }),
  ).toBeVisible();
  await page
    .locator(".sidebar")
    .getByRole("link", { name: "Your Direction", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Aussie engineers, get to the states!" }),
  ).toHaveAttribute(
    "href",
    "https://thundergolfer.com/blog/get-to-the-states#fnref:1",
  );
  await enterEditMode(page, "Your Direction");
  const status = page.getByRole("combobox", { name: "Direction status" });
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
});
