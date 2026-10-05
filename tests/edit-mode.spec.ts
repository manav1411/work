import { expect, test } from "@playwright/test";
import { EDIT_HOLD_DURATION } from "../shared/interaction";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("work-demo-active", "true"),
  );
  await page.goto("/learn?track=databases");
  await expect(page.locator("main h1")).toHaveText(/^Learn/);
});

test("ordinary clicks, cancelled holds, and completed holds have distinct behaviour", async ({
  page,
}) => {
  const nav = page.getByRole("navigation", {
    name: "Main navigation",
    exact: true,
  });
  const learn = nav.getByRole("link", { name: "Learn", exact: true });
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await learn.dispatchEvent("pointerdown", {
    button: 0,
    clientX: 30,
    clientY: 100,
  });
  await page.clock.runFor(100);
  await expect(learn).not.toHaveClass(/nav-holding/);
  await learn.dispatchEvent("pointerup");
  await learn.click();
  await expect(
    page.getByRole("status").filter({ hasText: "Editing Learn" }),
  ).toHaveCount(0);
  await learn.dispatchEvent("pointerdown", {
    button: 0,
    clientX: 30,
    clientY: 100,
  });
  await page.clock.runFor(500);
  await expect(learn).toHaveClass(/nav-holding/);
  await learn.dispatchEvent("pointermove", { clientX: 50, clientY: 100 });
  await page.clock.runFor(EDIT_HOLD_DURATION);
  await expect(learn).not.toHaveClass(/nav-holding/);
  await expect(
    page.getByRole("button", { name: "Add topic", exact: true }),
  ).toHaveCount(0);
  await learn.dispatchEvent("pointerdown", { button: 0 });
  await page.clock.runFor(EDIT_HOLD_DURATION - 1);
  await expect(
    page.getByRole("button", { name: "Add topic", exact: true }),
  ).toHaveCount(0);
  await page.clock.runFor(1);
  await learn.dispatchEvent("pointerup");
  await expect(
    page.getByRole("status").filter({ hasText: "Editing Learn" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add topic", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Done editing", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add topic", exact: true }),
  ).toHaveCount(0);
});

test("keyboard hold preserves the selected content and edit mode is scoped to its section", async ({
  page,
}) => {
  const nav = page.getByRole("navigation", {
    name: "Main navigation",
    exact: true,
  });
  const learn = nav.getByRole("link", { name: "Learn", exact: true });
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await learn.focus();
  await page.keyboard.down("Space");
  await page.clock.runFor(EDIT_HOLD_DURATION);
  await page.keyboard.up("Space");
  await expect(page).toHaveURL(/track=databases/);
  await expect(
    page.getByRole("status").filter({ hasText: "Editing Learn" }),
  ).toBeVisible();
  await nav.getByRole("link", { name: "Applications", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "New application", exact: true }),
  ).toHaveCount(0);
  await learn.click();
  await expect(
    page.getByRole("status").filter({ hasText: "Editing Learn" }),
  ).toHaveCount(0);
  await learn.focus();
  await page.keyboard.down("Space");
  await page.clock.runFor(EDIT_HOLD_DURATION);
  await page.keyboard.up("Space");
  await expect(
    page.getByRole("status").filter({ hasText: "Editing Learn" }),
  ).toBeVisible();
  await page
    .getByRole("tab", { name: "Backend engineering", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("status").filter({ hasText: "Editing Learn" }),
  ).toHaveCount(0);
});

test("mobile section holds enable editing without opening the navigation drawer", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const nav = page.getByRole("navigation", {
    name: "Mobile navigation",
    exact: true,
  });
  const learn = nav.getByRole("link", { name: "Learn", exact: true });
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await learn.dispatchEvent("pointerdown", { button: 0 });
  await page.clock.runFor(EDIT_HOLD_DURATION);
  await learn.dispatchEvent("pointerup");
  await expect(
    page.getByRole("button", { name: "Add topic", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".sidebar")).not.toHaveClass(/sidebar-open/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
