import { expect, test } from "@playwright/test";
import { enterEditMode } from "./edit-mode-helper";
import type { WorkRecord } from "../shared/model";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("work-demo-active", "true"),
  );
});

test("legacy appointment prose materializes one ordinary tab without modifying the appointment", async ({
  page,
}) => {
  await page.goto("/interviews");
  await expect(page.locator("main h1")).toHaveText(/^Interviews/);
  await page.evaluate(() => {
    const state = JSON.parse(sessionStorage.getItem("work-demo-v1")!);
    state.records = [
      {
        id: "legacy-appointment",
        kind: "interview",
        title: "Final round",
        body: "Meeting address",
        data: {
          prepNotes: "Original advice",
          questions: "Ask about mentoring",
        },
        tags: [],
        links: [],
        version: 1,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
        deletedAt: null,
      },
    ];
    sessionStorage.setItem("work-demo-v1", JSON.stringify(state));
  });
  await page.reload();
  await page
    .getByRole("tab", { name: "Final round notes", exact: true })
    .click();
  const notes = page.locator(".interview-intro .tiptap");
  await expect(notes).toContainText("Original advice");
  await enterEditMode(page, "Interviews");
  await page
    .getByRole("tab", { name: "Final round notes", exact: true })
    .getByLabel("Tab name")
    .fill("My preparation");
  await notes.fill("Preserved plus revised");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = JSON.parse(sessionStorage.getItem("work-demo-v1")!);
        const notes = state.records.filter(
          (record: WorkRecord) => record.kind === "note",
        );
        return [notes.length, notes[0]?.title, notes[0]?.body];
      }),
    )
    .toEqual([1, "My preparation", "Preserved plus revised"]);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem("work-demo-v1")!).records.find(
          (record: WorkRecord) => record.kind === "interview",
        ).data,
    ),
  ).toEqual({ prepNotes: "Original advice", questions: "Ask about mentoring" });
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "My preparation", exact: true }),
  ).toBeVisible();
  await expect(notes).toContainText("Preserved plus revised");
});

test("freeform notes autosave rich JSON and survive tab rename and navigation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/interviews");
  await expect(page.locator("main h1")).toHaveText(/^Interviews/);
  await enterEditMode(page, "Interviews");
  const notes = page.locator(".interview-intro .tiptap");
  await notes.fill("Remember the trade-offs.");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(sessionStorage.getItem("work-demo-v1")!).records.find(
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
          JSON.parse(sessionStorage.getItem("work-demo-v1")!).records.find(
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
  await enterEditMode(page, "Interviews");
  await page
    .getByRole("button", { name: "Add STAR story", exact: true })
    .click();
  const story = page.locator(".interview-story-card").last();
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
          sessionStorage.getItem("work-demo-v1")!,
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
  await page.locator("main h1").hover();
  await expect(page.locator("#leetcode-day-details")).toHaveCount(0);
});
