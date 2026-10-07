import { expect, test } from "@playwright/test";
import { enterEditMode } from "./edit-mode-helper";
import type { WorkRecord } from "../shared/model";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    () => (
      localStorage.setItem("work:storage-schema", "current-workspace-2026-10"),
      sessionStorage.setItem("work-demo-active", "true")
    ),
  );
});

test("freeform notes autosave rich JSON and survive tab rename and navigation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/interviews");
  await expect(page.locator(".page-header h1")).toHaveText(/^Interviews/);
  await page.evaluate(() => {
    const state = JSON.parse(sessionStorage.getItem("work-demo-current")!);
    state.records = [];
    sessionStorage.setItem("work-demo-current", JSON.stringify(state));
  });
  await page.reload();
  await expect(page.locator(".interview-intro .tiptap")).toBeVisible();
  await enterEditMode(page, "Interviews");
  const notes = page.locator(".interview-intro .tiptap");
  await notes.fill("Remember the trade-offs.");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(sessionStorage.getItem("work-demo-current")!).records.find(
            (record: WorkRecord) =>
              record.data.category === "content-document" &&
              record.data.tabKey === "behavioural",
          )?.body,
      ),
    )
    .toBe("Remember the trade-offs.");
  await page
    .getByRole("tab")
    .first()
    .getByLabel("Tab name")
    .fill("People interviews");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(sessionStorage.getItem("work-demo-current")!).records.find(
            (record: WorkRecord) =>
              record.data.category === "interview-tab" &&
              record.data.tabKey === "behavioural",
          )?.title,
      ),
    )
    .toBe("People interviews");
  await expect(notes).toContainText("Remember the trade-offs.");
  await expect(
    page.getByRole("button", { name: "Delete tab", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(notes).toContainText("Remember the trade-offs.");
  await expect(notes).toHaveAttribute("contenteditable", "false");
  expect(errors).toEqual([]);
});

test("inline STAR fields save together and calendar hover dismisses after a click", async ({
  page,
}) => {
  await page.goto("/interviews");
  await page.evaluate(() => {
    const state = JSON.parse(sessionStorage.getItem("work-demo-current")!);
    state.records = [];
    sessionStorage.setItem("work-demo-current", JSON.stringify(state));
  });
  await page.reload();
  await enterEditMode(page, "Interviews");
  await page
    .getByRole("button", { name: "Add STAR story", exact: true })
    .click();
  const story = page.locator(".interview-story-card").last();
  await story.locator(".interview-story-toggle").click();
  await story.getByLabel("Story title").fill("Ownership");
  await story
    .getByLabel("Situation", { exact: true })
    .fill("An unreliable service");
  await story.getByLabel("Task", { exact: true }).fill("Make it dependable");
  await story
    .getByLabel("Action", { exact: true })
    .fill("Added recovery paths");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const record = JSON.parse(
          sessionStorage.getItem("work-demo-current")!,
        ).records.findLast((record: WorkRecord) => record.kind === "story");
        return [
          record?.title,
          record?.data.situation,
          record?.data.task,
          record?.data.action,
        ];
      }),
    )
    .toEqual([
      "Ownership",
      "An unreliable service",
      "Make it dependable",
      "Added recovery paths",
    ]);
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Learn", exact: true })
    .click();
  const day = page.locator(".learn-calendar-day").first();
  await day.hover();
  await day.click();
  await expect(page.locator("#leetcode-day-details")).toBeVisible();
  await page.locator(".page-header h1").hover();
  await expect(page.locator("#leetcode-day-details")).toHaveCount(0);
});
