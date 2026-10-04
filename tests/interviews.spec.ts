import { expect, test } from "@playwright/test";
import type { WorkRecord } from "../shared/model";

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
});

test("behavioural and technical main text persist independently and STAR stories remain reusable", async ({
  page,
}) => {
  const intro = page.locator(".interview-intro");
  await intro.getByRole("button", { name: "Write notes", exact: true }).click();
  await intro
    .getByLabel("Behavioural main text", { exact: true })
    .fill("Lead with the decision and my contribution.");
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
  await page.getByRole("tab", { name: "Technical", exact: true }).click();
  await intro.getByRole("button", { name: "Write notes", exact: true }).click();
  await intro
    .getByLabel("Technical main text", { exact: true })
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
  await page.getByRole("tab", { name: "Behavioural", exact: true }).click();
  await page
    .getByRole("button", { name: "Add STAR story", exact: true })
    .click();
  const story = page.getByRole("dialog", {
    name: "Add STAR story",
    exact: true,
  });
  await story
    .getByLabel("Story title", { exact: true })
    .fill("Resolving the deployment disagreement");
  await story
    .getByLabel("Competencies", { exact: true })
    .fill("conflict, ownership");
  for (const [label, text] of [
    ["Situation", "Two teams disagreed about release timing."],
    ["Task", "I owned reaching an agreed release plan."],
    ["Action", "I compared rollback risks and proposed a staged release."],
    ["Result", "We released with a monitored rollback point."],
  ])
    await story.getByLabel(label, { exact: true }).fill(text);
  await story.getByRole("button", { name: "Save story", exact: true }).click();
  await expect(story).not.toBeVisible();
  const card = page
    .locator(".interview-story-card")
    .filter({ hasText: "Resolving the deployment disagreement" });
  await expect(card).toContainText("staged release");
  await page.getByLabel("Filter story competency").selectOption("conflict");
  await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(page.locator(".interview-story-card")).toHaveCount(2);
  const copy = page
    .locator(".interview-story-card")
    .filter({ hasText: "Resolving the deployment disagreement (copy)" });
  await copy.getByRole("button", { name: "Delete story", exact: true }).click();
  await copy
    .getByRole("button", { name: "Confirm delete story", exact: true })
    .click();
  await expect(page.locator(".interview-story-card")).toHaveCount(1);
  await page.reload();
  await expect(intro).toContainText(
    "Lead with the decision and my contribution.",
  );
  await expect(page.locator(".interview-story-card")).toHaveCount(1);
  await page.getByRole("tab", { name: "Technical", exact: true }).click();
  await expect(intro).toContainText("Clarify constraints before coding.");
});

test("custom preparation tabs support rename, ordering and optional notes", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add tab", exact: true }).click();
  let form = page.getByRole("dialog", {
    name: "Add preparation tab",
    exact: true,
  });
  await form
    .getByLabel("Tab name", { exact: true })
    .fill("System design notes");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("tab", { name: "System design notes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Rename System design notes", exact: true })
    .click();
  form = page.getByRole("dialog", {
    name: "Rename preparation tab",
    exact: true,
  });
  await form.getByLabel("Tab name", { exact: true }).fill("Architecture notes");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("button", { name: "Move Architecture notes left", exact: true })
    .click();
  await expect(
    page
      .getByRole("tablist", { name: "Interview preparation tabs", exact: true })
      .getByRole("tab"),
  ).toHaveText(["Behavioural", "Architecture notes", "Technical"]);
  await page.getByRole("button", { name: "Delete tab", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm delete tab", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "Architecture notes", exact: true }),
  ).toHaveCount(0);
});

test("appointment preparation creates content only on save and references the same reusable story", async ({
  page,
}) => {
  const ids = await page.evaluate(() => {
    const state = JSON.parse(sessionStorage.getItem("work-demo-v1")!);
    const applicationId = crypto.randomUUID(),
      interviewId = crypto.randomUUID(),
      storyId = crypto.randomUUID();
    const base = {
      body: "",
      tags: [],
      links: [],
      version: 1,
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:00:00Z",
      deletedAt: null,
    };
    state.records.push({
      ...base,
      id: applicationId,
      kind: "application",
      title: "Platform engineer",
      data: { company: "Example Company", applicationStatus: "Applied" },
    });
    state.records.push({
      ...base,
      id: interviewId,
      kind: "interview",
      title: "Behavioural round",
      links: [applicationId],
      data: {
        applicationId,
        startsAt: "2030-12-15T10:00:00Z",
        timezone: "UTC",
        status: "Scheduled",
      },
    });
    state.records.push({
      ...base,
      id: storyId,
      kind: "story",
      title: "Ownership under ambiguity",
      tags: ["ownership"],
      data: {
        situation: "Unclear requirements.",
        task: "Find a useful first milestone.",
        action: "Proposed a small prototype.",
        result: "The team agreed on scope.",
      },
    });
    sessionStorage.setItem("work-demo-v1", JSON.stringify(state));
    return { applicationId, interviewId, storyId };
  });
  await page.goto(`/interviews?interview=${ids.interviewId}`);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem("work-demo-v1")!).records.filter(
          (record: WorkRecord) =>
            record.data.category === "interview-preparation",
        ).length,
    ),
  ).toBe(0);
  await page
    .locator(".interview-intro")
    .getByRole("button", { name: "Write notes", exact: true })
    .click();
  await page
    .getByLabel("Interview preparation", { exact: true })
    .fill("Ask about feedback and onboarding.");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(sessionStorage.getItem("work-demo-v1")!).records.find(
            (record: WorkRecord) =>
              record.data.category === "interview-preparation",
          )?.body,
      ),
    )
    .toBe("Ask about feedback and onboarding.");
  await page
    .getByText("Choose from your story bank (0 selected)", { exact: true })
    .click();
  await page.getByLabel("Ownership under ambiguity", { exact: false }).check();
  await expect(
    page.locator(".interview-selected-stories .interview-story-card"),
  ).toContainText("Proposed a small prototype.");
  const records = await page.evaluate(
    () =>
      JSON.parse(sessionStorage.getItem("work-demo-v1")!)
        .records as WorkRecord[],
  );
  expect(records.filter((record) => record.kind === "story")).toHaveLength(1);
  expect(
    records.find((record) => record.data.category === "interview-preparation")
      ?.data,
  ).toMatchObject({
    interviewId: ids.interviewId,
    applicationId: ids.applicationId,
    storyIds: [ids.storyId],
  });
  await page
    .getByRole("link", { name: "Appointment details", exact: true })
    .click();
  const edit = page.getByRole("dialog", {
    name: "Edit interview",
    exact: true,
  });
  await edit.getByLabel("Status", { exact: true }).selectOption("Cancelled");
  await edit
    .getByRole("button", { name: "Save interview", exact: true })
    .click();
  await page.goto(`/interviews?interview=${ids.interviewId}`);
  await expect(page.locator(".interview-preparation-heading")).toContainText(
    "Cancelled",
  );
  await expect(page.locator(".interview-intro")).toContainText(
    "Ask about feedback and onboarding.",
  );
  await expect(
    page.locator(".interview-selected-stories .interview-story-card"),
  ).toContainText("Ownership under ambiguity");
});
