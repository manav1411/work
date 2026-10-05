import { expect, test } from "@playwright/test";
import type { WorkRecord } from "../shared/model";
import { enterEditMode } from "./edit-mode-helper";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("work-demo-active", "true"),
  );
  await page.goto("/interviews");
  await expect(
    page.getByRole("heading", { name: /^Interviews/ }),
  ).toBeVisible();
  await page.evaluate(() => {
    const state = JSON.parse(sessionStorage.getItem("work-demo-v1")!);
    state.records = [];
    state.goals = [];
    sessionStorage.setItem("work-demo-v1", JSON.stringify(state));
  });
  await page.reload();
  await enterEditMode(page, "Interviews");
});

test("main notes and STAR competencies save inline across interview tabs", async ({
  page,
}) => {
  const intro = page.locator(".interview-intro");
  const editor = intro.locator(".rich-document-prose[contenteditable=true]");
  await editor.fill("Lead with the decision and my contribution.");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(sessionStorage.getItem("work-demo-v1")!).records.find(
            (record: WorkRecord) => record.data.tabKey === "behavioural",
          )?.body,
      ),
    )
    .toBe("Lead with the decision and my contribution.");

  await page.getByRole("tab", { name: "Technical", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/tab=technical/);
  await expect(
    page.locator(".sidebar").getByRole("link", { name: "Interviews" }),
  ).not.toHaveAttribute("data-editing", "true");
  await enterEditMode(page, "Interviews");
  await page
    .locator(".interview-intro .rich-document-prose[contenteditable=true]")
    .fill("Clarify constraints before coding.");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(sessionStorage.getItem("work-demo-v1")!).records.find(
            (record: WorkRecord) => record.data.tabKey === "technical",
          )?.body,
      ),
    )
    .toBe("Clarify constraints before coding.");

  await page
    .getByRole("tab", { name: "Behavioural", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/tab=behavioural/);
  await expect(
    page.locator(".sidebar").getByRole("link", { name: "Interviews" }),
  ).not.toHaveAttribute("data-editing", "true");
  await enterEditMode(page, "Interviews");
  await page.getByRole("button", { name: "Add STAR story", exact: true }).click();
  const card = page.locator(".interview-story-card").first();
  await card
    .getByLabel("Story title", { exact: true })
    .fill("Resolving the deployment disagreement");
  const competency = card.getByLabel("Story competencies", { exact: true });
  await competency.fill("conflict, ownership");
  await card.getByLabel("Situation", { exact: true }).click();
  for (const [label, text] of [
    ["Situation", "Two teams disagreed about release timing."],
    ["Task", "I owned reaching an agreed release plan."],
    ["Action", "I compared rollback risks and proposed a staged release."],
    ["Result", "We released with a monitored rollback point."],
  ]) {
    await card.getByLabel(label, { exact: true }).fill(text);
  }
  await expect
    .poll(() =>
      page.evaluate(() => {
        const record = JSON.parse(sessionStorage.getItem("work-demo-v1")!).records.find(
          (item: WorkRecord) => item.kind === "story",
        );
        return record && {
          tags: record.tags,
          action: record.data.action,
          result: record.data.result,
        };
      }),
    )
    .toMatchObject({
      tags: ["conflict", "ownership"],
      action: "I compared rollback risks and proposed a staged release.",
      result: "We released with a monitored rollback point.",
    });
  await page.getByLabel("Filter story competency").click();
  await page.getByRole("option", { name: "conflict", exact: true }).click();
  await expect(page.locator(".interview-story-card")).toHaveCount(1);
  await page.reload();
  await enterEditMode(page, "Interviews");
  await expect(
    page.locator(".interview-story-card").getByLabel("Story title"),
  ).toHaveValue("Resolving the deployment disagreement");
  await expect(page.locator(".interview-story-card")).toContainText(
    "conflict",
  );
  await page.getByRole("tab", { name: "Technical", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".interview-intro")).toContainText(
    "Clarify constraints before coding.",
  );
});

test("upcoming interview reminders are static and use local time without a zone suffix", async ({
  page,
}) => {
  await page.evaluate(() => {
    const state = JSON.parse(sessionStorage.getItem("work-demo-v1")!);
    const base = {
      body: "",
      tags: [],
      links: [],
      version: 1,
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:00:00Z",
      deletedAt: null,
    };
    state.records.push(
      {
        ...base,
        id: "upcoming-company",
        kind: "application",
        title: "Example Company",
        data: { company: "Example Company", applicationStatus: "Applied" },
      },
      {
        ...base,
        id: "upcoming-interview",
        kind: "interview",
        title: "Technical round",
        links: ["upcoming-company"],
        data: {
          applicationId: "upcoming-company",
          startsAt: "2030-12-15T10:00:00Z",
          timezone: "UTC",
          status: "Scheduled",
        },
      },
    );
    sessionStorage.setItem("work-demo-v1", JSON.stringify(state));
  });
  await page.reload();
  const reminder = page.locator(".interview-upcoming-card");
  await expect(reminder).toContainText("Technical round");
  await expect(page.locator("a.interview-upcoming-card")).toHaveCount(0);
  await expect(reminder).not.toContainText("UTC");
});
