import { expect, test, type Locator } from "@playwright/test";
import type { WorkRecord } from "../shared/model";
import { enterEditMode } from "./edit-mode-helper";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    () => (
      localStorage.setItem("work:storage-schema", "current-workspace-2026-10"),
      sessionStorage.setItem("work-demo-active", "true")
    ),
  );
  await page.goto("/interviews");
  await expect(
    page.getByRole("heading", { name: /^Interviews/ }),
  ).toBeVisible();
  await page.evaluate(() => {
    const state = JSON.parse(sessionStorage.getItem("work-demo-current")!);
    state.records = [];
    state.goals = [];
    sessionStorage.setItem("work-demo-current", JSON.stringify(state));
  });
  await page.reload();
  await enterEditMode(page, "Interviews");
});

test("tab dragging has no dashed outline and Learn notes stay fixed", async ({
  page,
}) => {
  const outlineStyle = async (handle: Locator) => {
    await handle.focus();
    await page.keyboard.press("Space");
    await expect(handle).toHaveAttribute("aria-pressed", "true");
    const outline = await handle
      .locator("xpath=../..")
      .evaluate((item) => getComputedStyle(item).outlineStyle);
    await page.keyboard.press("Escape");
    return outline;
  };
  expect(
    await outlineStyle(page.locator(".editable-tabs .sort-handle").first()),
  ).toBe("none");
  await page.goto("/learn");
  await enterEditMode(page, "Learn");
  await expect(page.locator(".learn-track-tabs .sort-handle")).toHaveCount(
    await page.getByRole("tab").count(),
  );
  await expect(page.locator(".learn-page .rich-block-handle")).toHaveCount(0);
  expect(
    await outlineStyle(page.locator(".learn-track-tabs .sort-handle").first()),
  ).toBe("none");
});

test("editable tab rows match the Applications tab height", async ({
  page,
}) => {
  const interviewHeight = await page
    .locator(".editable-tabs .editable-tab")
    .first()
    .evaluate((tab) => tab.getBoundingClientRect().height);
  await page.goto("/applications");
  const applicationHeight = await page
    .locator(".application-tabs button")
    .first()
    .evaluate((tab) => tab.getBoundingClientRect().height);
  await page.goto("/learn");
  const learnHeight = await page
    .locator(".learn-track-tabs .editable-tab")
    .first()
    .evaluate((tab) => tab.getBoundingClientRect().height);
  expect(interviewHeight).toBe(40);
  expect(learnHeight).toBe(applicationHeight);
  expect(interviewHeight).toBe(applicationHeight);
});

test("interview delete control aligns with the main text column", async ({
  page,
}) => {
  const technicalTab = page.getByRole("tab", {
    name: "Technical",
    exact: true,
  });
  await technicalTab.focus();
  await page.keyboard.press("Enter");
  await expect(technicalTab).toHaveAttribute("aria-selected", "true");
  const deleteTab = page.getByRole("button", {
    name: "Delete tab",
    exact: true,
  });
  await expect(deleteTab).toBeVisible();
  const deleteStyle = await deleteTab.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const tabListRect = document
      .querySelector(
        '[role="tablist"][aria-label="Interview preparation tabs"]',
      )!
      .getBoundingClientRect();
    const panelRect = button
      .closest('[role="tabpanel"]')!
      .getBoundingClientRect();
    const upcomingRect = document
      .querySelector(".interview-upcoming")!
      .getBoundingClientRect();
    const style = getComputedStyle(button);
    return {
      background: style.backgroundColor,
      borderColor: style.borderColor,
      borderStyle: style.borderStyle,
      belowTabBar: rect.top >= tabListRect.bottom,
      rightAlignedToTextColumn: Math.abs(rect.right - panelRect.right) < 1,
      beforeUpcomingInterviews: rect.right < upcomingRect.left,
    };
  });
  expect(deleteStyle).toEqual({
    background: "rgb(255, 222, 220)",
    borderColor: "rgb(133, 44, 38)",
    borderStyle: "solid",
    belowTabBar: true,
    rightAlignedToTextColumn: true,
    beforeUpcomingInterviews: true,
  });
});

test("main notes and STAR competencies save inline across interview tabs", async ({
  page,
}) => {
  const intro = page.locator(".interview-intro");
  const editor = intro.locator(".rich-document-prose[contenteditable=true]");
  await expect(intro.locator(".rich-block-handle")).toHaveCount(0);
  await editor.fill("Lead with the decision and my contribution.");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(sessionStorage.getItem("work-demo-current")!).records.find(
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
  ).toHaveAttribute("data-editing", "true");
  await page
    .locator(".interview-intro .rich-document-prose[contenteditable=true]")
    .fill("Clarify constraints before coding.");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(sessionStorage.getItem("work-demo-current")!).records.find(
            (record: WorkRecord) => record.data.tabKey === "technical",
          )?.body,
      ),
    )
    .toBe("Clarify constraints before coding.");

  await page.getByRole("tab", { name: "Behavioural", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/tab=behavioural/);
  await expect(
    page.locator(".sidebar").getByRole("link", { name: "Interviews" }),
  ).toHaveAttribute("data-editing", "true");
  await page
    .getByRole("button", { name: "Add STAR story", exact: true })
    .click();
  const card = page.locator(".interview-story-card").first();
  await expect(card.getByRole("heading", { name: "Situation" })).toBeVisible();
  await expect(card.getByLabel("Situation", { exact: true })).toBeHidden();
  await card.locator(".interview-story-toggle").click();
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
        const record = JSON.parse(
          sessionStorage.getItem("work-demo-current")!,
        ).records.find((item: WorkRecord) => item.kind === "story");
        return (
          record && {
            tags: record.tags,
            action: record.data.action,
            result: record.data.result,
          }
        );
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
  const story = page.locator(".interview-story-card").first();
  await expect(story.getByRole("heading", { name: "Situation" })).toBeVisible();
  await expect(story.getByLabel("Situation", { exact: true })).toBeHidden();
  await expect(story.getByLabel("Story title")).toHaveValue(
    "Resolving the deployment disagreement",
  );
  await expect(story).toContainText("conflict");
  await story.locator(".interview-story-toggle").click();
  await expect(story.getByLabel("Situation", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Technical", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".interview-intro")).toContainText(
    "Clarify constraints before coding.",
  );
});

test("STAR stories start collapsed and expand independently", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Add STAR story", exact: true })
    .click();
  const first = page.locator(".interview-story-card").first();
  await expect(first.getByRole("heading", { name: "Situation" })).toBeVisible();
  await expect(first.locator(".interview-story-toggle")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await first.locator(".interview-story-toggle").click();
  await expect(first.locator(".interview-story-toggle")).toHaveAttribute(
    "aria-expanded",
    "true",
  );

  await page
    .getByRole("button", { name: "Add STAR story", exact: true })
    .click();
  const second = page.locator(".interview-story-card").last();
  await expect(second.locator(".interview-story-toggle")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await second.locator(".interview-story-toggle").click();
  await expect(first.locator(".interview-story-toggle")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(second.locator(".interview-story-toggle")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
});

test("upcoming interview reminders are static and use local time without a zone suffix", async ({
  page,
}) => {
  await page.evaluate(() => {
    const state = JSON.parse(sessionStorage.getItem("work-demo-current")!);
    const base = {
      body: "",
      tags: [],
      links: [],
      version: 1,
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:00:00Z",
    };
    state.records.push(
      {
        ...base,
        id: "upcoming-company",
        kind: "application",
        title: "Network engineer",
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
    sessionStorage.setItem("work-demo-current", JSON.stringify(state));
  });
  await page.reload();
  const reminder = page.locator(".interview-upcoming-card");
  await expect(reminder).toContainText("Network engineer");
  await expect(reminder).toContainText("Technical round");
  await expect(page.locator("a.interview-upcoming-card")).toHaveCount(0);
  await expect(reminder).not.toContainText("UTC");
});

test("behavioural story bank precedes compact notes without shrinking other tabs", async ({
  page,
}) => {
  const storyBank = page.locator(".interview-story-bank");
  const notesCanvas = page.locator(".interview-intro .rich-document-canvas");
  await expect(storyBank).toBeVisible();
  const order = await storyBank.evaluate(
    (story) =>
      story.compareDocumentPosition(
        document.querySelector(".interview-intro")!,
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  expect(order).toBeTruthy();
  await expect(notesCanvas).toHaveCSS("min-height", "0px");
  await expect(
    page.locator(".interview-intro .rich-document-canvas .rich-document-prose"),
  ).toHaveCSS("min-height", "0px");

  const technicalTab = page.getByRole("tab", {
    name: "Technical",
    exact: true,
  });
  await technicalTab.focus();
  await page.keyboard.press("Enter");
  await expect(technicalTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".interview-intro")).not.toHaveClass(
    /interview-intro-behavioural/,
  );
  await page.getByRole("button", { name: "Done editing" }).click();
  const technicalLayout = await page
    .locator(".interview-intro .rich-document-canvas")
    .evaluate((canvas) => {
      const rect = canvas.getBoundingClientRect();
      return {
        height: rect.height,
        bottom: rect.bottom,
        viewport: window.innerHeight,
        pageHeight: document.documentElement.scrollHeight,
      };
    });
  expect(technicalLayout.height).toBeGreaterThan(250);
  expect(
    Math.abs(technicalLayout.bottom - (technicalLayout.viewport - 50)),
  ).toBeLessThan(2);
  expect(technicalLayout.pageHeight).toBeLessThanOrEqual(
    technicalLayout.viewport,
  );
});
