import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("work-demo-active", "true"),
  );
  await page.goto("/home");
  await expect(
    page.getByRole("heading", { name: "Timeline", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    const state = JSON.parse(sessionStorage.getItem("work-demo-v1")!);
    state.goals = [];
    state.records = [];
    sessionStorage.setItem("work-demo-v1", JSON.stringify(state));
  });
  await page.goto("/direction");
});

test("goal progress persists and explicit completion never fabricates measurements", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add goal", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add goal", exact: true });
  await editor.getByLabel("Goal", { exact: true }).fill("Build portfolio");
  await editor.getByLabel("Target date", { exact: true }).fill("2030-11-01");
  await editor.getByText("Progress and details", { exact: true }).click();
  await editor.getByLabel("Progress measure").selectOption("manual");
  await editor.getByLabel("Target", { exact: true }).fill("10");
  await editor.getByLabel("Current progress", { exact: true }).fill("2");
  await editor.getByLabel("Unit", { exact: true }).fill("milestones");
  await editor.getByRole("button", { name: "Save goal", exact: true }).click();
  const card = page
    .locator(".goal-card")
    .filter({ hasText: "Build portfolio" });
  await expect(card).toContainText("2 / 10 milestones");
  let detail = page.getByRole("dialog", {
    name: "Build portfolio",
    exact: true,
  });
  await detail
    .getByRole("button", { name: "Mark complete", exact: true })
    .click();
  await expect(detail.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "20",
  );
  await expect(detail).toContainText("2 / 10 milestones");
  await detail.getByRole("button", { name: "Edit goal", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit goal", exact: true });
  await edit.getByLabel("Current progress", { exact: true }).fill("5");
  await edit.getByRole("button", { name: "Save goal", exact: true }).click();
  await page.reload();
  detail = page.getByRole("dialog", { name: "Build portfolio", exact: true });
  await expect(detail.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "50",
  );
  await detail.getByText("Progress history", { exact: true }).click();
  await expect(detail.locator(".goal-checkpoints")).toContainText(
    "5 milestones",
  );
  await expect(detail.locator(".goal-checkpoints")).toContainText(
    "2 milestones",
  );
});

test("dated milestones use actual completion and removing a goal keeps its backup", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add goal", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add goal", exact: true });
  await editor.getByLabel("Goal", { exact: true }).fill("Release project");
  await editor.getByText("Progress and details", { exact: true }).click();
  await editor.getByLabel("Progress measure").selectOption("milestones");
  await editor
    .getByRole("button", { name: "Add milestone", exact: true })
    .click();
  await editor.getByLabel("Milestone", { exact: true }).fill("Prototype");
  await editor
    .getByRole("button", { name: "Add milestone", exact: true })
    .click();
  await editor.getByLabel("Milestone", { exact: true }).nth(1).fill("Launch");
  await editor.getByRole("button", { name: "Save goal", exact: true }).click();
  const detail = page.getByRole("dialog", {
    name: "Release project",
    exact: true,
  });
  await detail.getByLabel("Prototype", { exact: false }).check();
  await expect(detail.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "50",
  );
  await expect(
    page.locator(".goal-card").filter({ hasText: "Release project" }),
  ).toContainText("1 / 2");
  await detail.locator("summary").filter({ hasText: "Remove goal" }).click();
  await detail
    .getByRole("button", { name: "Remove goal", exact: true })
    .click();
  await expect(
    page.locator(".goal-card").filter({ hasText: "Release project" }),
  ).toHaveCount(0);
  const goals = await page.evaluate(
    () => JSON.parse(sessionStorage.getItem("work-demo-v1")!).goals,
  );
  expect(goals).toHaveLength(1);
  expect(goals[0].deletedAt).toBeTruthy();
});

test("Home has source-linked appointments with scheduling managed in Applications", async ({
  page,
}) => {
  await page.goto("/home");
  await expect(
    page.getByRole("button", { name: "Add interview", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add goal", exact: true }),
  ).toHaveCount(0);
  await page.goto("/applications");
  await page
    .getByRole("button", { name: "New application", exact: true })
    .first()
    .click();
  const application = page.getByRole("dialog", {
    name: "New application",
    exact: true,
  });
  await application
    .getByLabel("Company", { exact: true })
    .fill("Example Company");
  await application
    .getByLabel("Role", { exact: true })
    .fill("Upcoming interview role");
  await application
    .getByRole("button", { name: "Save application", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Upcoming interview role", exact: true })
    .getByRole("button", { name: "Schedule interview", exact: true })
    .click();
  let editor = page.getByRole("dialog", {
    name: "Schedule interview",
    exact: true,
  });
  const day = await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return d.toISOString().slice(0, 10);
  });
  await editor.getByLabel("Date and local time").fill(`${day}T10:00`);
  await editor.getByLabel("Timezone", { exact: true }).fill("UTC");
  await editor.getByText("Details", { exact: true }).click();
  await editor
    .getByLabel("Interview title", { exact: true })
    .fill("Mock appointment");
  await editor
    .getByRole("button", { name: "Save interview", exact: true })
    .click();
  await page.goto("/home");
  const event = page
    .locator(".timeline-chart .timeline-event button")
    .filter({ hasText: "Mock appointment" });
  await expect(event).toBeVisible();
  await event.locator(".timeline-event-point").click();
  await expect(page).toHaveURL(/\/applications\?interview=/);
  editor = page.getByRole("dialog", { name: "Edit interview", exact: true });
  await editor.getByLabel("Date and local time").fill(`${day}T12:00`);
  await editor
    .getByRole("button", { name: "Save interview", exact: true })
    .click();
  await page.goto("/home");
  const localTime = await page.evaluate((date) => {
    const state = JSON.parse(sessionStorage.getItem("work-demo-v1")!);
    return new Intl.DateTimeFormat("en-AU", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: state.preferences.timezone,
    }).format(new Date(`${date}T12:00:00Z`));
  }, day);
  await expect(event).toContainText(localTime);
  const records = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("work-demo-v1")!).records.filter(
      (r: { kind: string }) => r.kind === "interview",
    ),
  );
  expect(records).toHaveLength(1);
  expect(records[0].data.startsAt).toContain("12:00");
});
