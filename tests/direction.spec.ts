import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_PREFERENCES, type WorkRecord } from "../shared/model";
import { EMPTY_GOAL, newGoal, type Goal } from "../shared/goals";
import { enterEditMode } from "./edit-mode-helper";

async function directionWorkspace(page: Page) {
  await page.clock.setFixedTime(new Date("2030-04-01T01:00:00Z"));
  const records: WorkRecord[] = [
    {
      id: "platform",
      title: "Platform engineering and distributed systems",
      body: "Build reliable services and understand their failure modes.",
      status: "Pursuing",
      date: "2030-06-20",
    },
    {
      id: "security",
      title: "Product security",
      body: "Explore threat modelling and authentication design.",
      status: "Exploring",
      date: "2030-09-01",
    },
    {
      id: "research",
      title: "Research",
      body: "A much longer set of research notes. ".repeat(60),
      status: "Future",
      date: "",
    },
  ].map((item, index) => ({
    id: item.id,
    kind: "path",
    title: item.title,
    body: item.body,
    data: {
      category: "direction",
      status: item.status,
      directionOrder: index,
      startDate: "2030-01-01",
      endDate: item.date,
      researchLinks: ["https://example.com/research"],
      researchLinkTitles: ["Research guide"],
    },
    tags: [],
    links: [],
    version: 1,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
  }));
  const goals: Goal[] = [
    newGoal({
      ...EMPTY_GOAL,
      title: "Ship a reliable service",
      directionId: "platform",
      startDate: "2030-03-01",
      targetDate: "2030-05-01",
      milestones: [
        {
          id: crypto.randomUUID(),
          title: "Deploy the prototype",
          date: "2030-04-01",
          done: false,
          completedAt: null,
        },
      ],
    }),
    newGoal({
      ...EMPTY_GOAL,
      title: "Threat-model the login flow",
      directionId: "security",
      targetDate: "2030-07-01",
    }),
    newGoal({
      ...EMPTY_GOAL,
      title: "Interview practice",
      directionId: "platform",
      measure: "neetcode150",
      target: 150,
      startDate: "2030-02-01",
      targetDate: "2030-05-01",
    }),
  ];
  await page.addInitScript(() => sessionStorage.removeItem("work-demo-active"));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path === "/api/session")
      return route.fulfill({
        json: {
          user: {
            id: "direction-owner",
            name: "Synthetic",
            email: "direction@example.invalid",
          },
          configured: true,
          local: false,
        },
      });
    if (path === "/api/preferences")
      return route.fulfill({ json: { preferences: DEFAULT_PREFERENCES } });
    if (path === "/api/records" && method === "GET")
      return route.fulfill({ json: { records, epoch: "direction-current" } });
    const record = records.find(
      (record) => path === `/api/records/${record.id}`,
    );
    if (record && method === "PATCH") {
      const patch = route.request().postDataJSON();
      if (patch.version !== record.version)
        return route.fulfill({
          status: 409,
          json: { error: "Version conflict" },
        });
      Object.assign(record, patch, { version: record.version + 1 });
      return route.fulfill({ json: { record } });
    }
    if (path === "/api/records/reorder" && method === "POST") {
      const { items, key } = route.request().postDataJSON();
      for (const item of items) {
        const record = records.find((record) => record.id === item.id)!;
        if (record.version !== item.version)
          return route.fulfill({
            status: 409,
            json: { error: "Version conflict" },
          });
        record.data[key] = item.order;
        record.version += 1;
      }
      return route.fulfill({ json: { records } });
    }
    if (path === "/api/goals" && method === "GET")
      return route.fulfill({ json: { goals } });
    if (path === "/api/goals" && method === "POST") {
      const goal = newGoal(route.request().postDataJSON());
      goals.push(goal);
      return route.fulfill({ json: { goal } });
    }
    const goal = goals.find((goal) => path === `/api/goals/${goal.id}`);
    if (goal && method === "PATCH") {
      const patch = route.request().postDataJSON();
      if (patch.version !== goal.version)
        return route.fulfill({
          status: 409,
          json: { error: "Version conflict" },
        });
      Object.assign(goal, patch, { version: goal.version + 1 });
      return route.fulfill({ json: { goal } });
    }
    return route.fulfill({ json: { records: [], events: [], goals: [] } });
  });
  return { records, goals };
}

test("goals start unfocused, show all details when selected, and dismiss on outside click", async ({
  page,
}) => {
  const { goals } = await directionWorkspace(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/goals");
  const picker = page.getByRole("tablist", { name: "Goals", exact: true });
  await expect(picker.getByRole("tab")).toHaveCount(3, { timeout: 15000 });
  await expect(page.getByRole("tabpanel")).toHaveCount(0);
  await expect(page.locator(".direction-timeline")).not.toContainText("Today");
  await expect(
    page.locator('.direction-timeline-kind[data-kind="goal"]'),
  ).toHaveCount(2);
  await expect(
    page.locator('.direction-timeline-kind[data-kind="action"]'),
  ).toHaveCount(3);
  await expect(
    page.locator('.direction-timeline-kind[data-kind="task"]'),
  ).toHaveCount(1);
  await expect(
    page
      .locator(".direction-timeline-item")
      .filter({ hasText: "Deploy the prototype" }),
  ).toContainText("Task");
  await expect(picker.locator('[aria-selected="true"]')).toHaveCount(0);
  const heights = await picker
    .getByRole("tab")
    .evaluateAll((tabs) =>
      tabs.map((tab) => tab.getBoundingClientRect().height),
    );
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
  const timelineBox = await page.locator(".direction-overview").boundingBox(),
    pickerBox = await picker.boundingBox();
  expect(timelineBox!.y + timelineBox!.height).toBeLessThan(pickerBox!.y);
  await picker.getByRole("tab").first().click();
  const detail = page.getByRole("tabpanel");
  await expect(detail).toContainText("Build reliable services");
  await expect(detail.locator(".schedule-today")).toContainText("Today");
  await expect(
    detail.getByRole("link", { name: "Research guide" }),
  ).toBeVisible();
  await expect(detail.getByRole("heading", { name: /^Actions/ })).toBeVisible();
  await expect(
    detail.getByRole("heading", {
      name: "Ship a reliable service",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    detail.getByRole("progressbar", { name: "NeetCode progress" }),
  ).toBeVisible();
  await expect(detail.locator("details")).toHaveCount(0);
  await expect(detail.locator(".goal-inline-card h3")).toHaveText([
    "Interview practice",
    "Ship a reliable service",
  ]);
  const progressBar = await detail
    .getByRole("progressbar", { name: "NeetCode progress" })
    .boundingBox();
  expect(progressBar!.width).toBeLessThan(120);
  await expect(
    detail.getByRole("heading", { name: "Notes", exact: true }),
  ).toBeVisible();
  if (process.env.WORK_DIRECTION_SCREENSHOTS)
    await page.screenshot({
      path: "/tmp/work-goals-desktop.png",
      fullPage: true,
    });
  await page.getByRole("heading", { name: /^Goals\.?$/ }).click();
  await expect(detail).toHaveCount(0);
  await picker.getByRole("tab").first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    picker.getByRole("tab", { name: "Product security", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(detail).toContainText("Explore threat modelling");
  await page
    .locator(".direction-timeline-item")
    .filter({ hasText: "Deploy the prototype" })
    .click();
  await expect(picker.getByRole("tab").first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(`#direction-item-${goals[0].id}`)).toBeVisible();
  await page.goto(`/direction?goal=${goals[1].id}`);
  await expect(page).toHaveURL(new RegExp(`/goals\\?action=${goals[1].id}`));
  await expect(
    picker.getByRole("tab", { name: "Product security", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await expect(detail).toBeVisible();
  }
  if (process.env.WORK_DIRECTION_SCREENSHOTS)
    await page.screenshot({
      path: "/tmp/work-goals-mobile-dark.png",
      fullPage: true,
    });
  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);
});

test("switching and clearing goals saves drafts; new actions belong to the focused goal", async ({
  page,
}) => {
  const { records, goals } = await directionWorkspace(page);
  await page.goto("/goals");
  await page.getByRole("tab").first().click();
  await enterEditMode(page, "Goals");
  await page
    .locator('[data-goal-id="platform"]')
    .getByLabel("Goal name", { exact: true })
    .fill("Reliable platform systems");
  await page
    .locator(".direction-notes .tiptap")
    .fill("Preserve this draft while switching goals.");
  await page
    .getByRole("tab", { name: "Product security", exact: true })
    .click();
  await expect(
    page
      .locator('[data-goal-id="security"]')
      .getByLabel("Goal name", { exact: true }),
  ).toHaveValue("Product security");
  await expect.poll(() => records[0].title).toBe("Reliable platform systems");
  await expect
    .poll(() => records[0].body)
    .toBe("Preserve this draft while switching goals.");
  await page
    .getByRole("tabpanel")
    .getByRole("button", { name: "Add action", exact: true })
    .click();
  await expect.poll(() => goals.length).toBe(4);
  expect(goals[3].goalIds).toEqual(["security"]);
  const action = page.locator(`#direction-item-${goals[3].id}`);
  await action
    .getByLabel("Action name", { exact: true })
    .fill("Review authentication boundaries");
  await page.getByRole("heading", { name: /^Goals\.?$/ }).click();
  await expect(page.getByRole("tabpanel")).toHaveCount(0);
  expect(goals[3].title).toBe("Review authentication boundaries");
  await page
    .getByRole("tab", { name: "Reliable platform systems", exact: true })
    .click();
  await expect(page.locator(".direction-notes .tiptap")).toContainText(
    "Preserve this draft",
  );
  const handle = page
    .getByRole("tablist", { name: "Goals", exact: true })
    .getByRole("button", { name: /^Drag to arrange/ })
    .first();
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(handle).toHaveAttribute("aria-pressed", "true");
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "over droppable area platform" }),
  ).toHaveCount(1);
  await page.keyboard.press("ArrowRight");
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "over droppable area security" }),
  ).toBeVisible();
  await page.keyboard.press("Space");
  await expect
    .poll(() => Number(records[0].data.directionOrder))
    .toBeGreaterThan(Number(records[1].data.directionOrder));
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "Reliable platform systems", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});

test("goals wrap into rows and every goal is editable without focusing it", async ({
  page,
}) => {
  const { records } = await directionWorkspace(page);
  records.push(
    ...Array.from({ length: 3 }, (_, index) => ({
      ...records[0],
      id: `extra-${index}`,
      title: `Additional goal ${index + 1}`,
      data: { ...records[0].data, directionOrder: index + 3 },
    })),
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/goals");
  const picker = page.getByRole("tablist", { name: "Goals", exact: true });
  await expect(picker.getByRole("tab")).toHaveCount(6);
  const boxes = await picker.locator(".direction-choice").evaluateAll((cards) =>
    cards.map((card) => {
      const { x, y, width } = card.getBoundingClientRect();
      return { x, y, width };
    }),
  );
  expect(boxes[0].y).toBe(boxes[2].y);
  expect(boxes[3].y).toBeGreaterThan(boxes[0].y);
  expect(boxes[3].x).toBe(boxes[0].x);
  expect(boxes[0].x).toBeLessThan(boxes[1].x);
  expect(boxes[1].x).toBeLessThan(boxes[2].x);
  expect(
    await picker.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  for (const [width, columns] of [
    [1280, 3],
    [800, 2],
    [390, 1],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    for (const index of [0, 4]) {
      await picker.getByRole("tab").nth(index).click();
      const detail = page.getByRole("tabpanel");
      await expect(detail.locator(".direction-card")).toBeVisible();
      const lastInRow = Math.min(
        5,
        Math.floor(index / columns) * columns + columns - 1,
      );
      await expect
        .poll(async () => {
          const row = await picker
            .locator(".direction-choice")
            .nth(lastInRow)
            .boundingBox();
          const panel = await detail.boundingBox();
          return Math.abs(panel!.y - row!.y - row!.height - 12);
        })
        .toBeLessThan(1);
      if (lastInRow < 5) {
        const next = await picker
          .locator(".direction-choice")
          .nth(lastInRow + 1)
          .boundingBox();
        const panel = await detail.boundingBox();
        expect(Math.abs(next!.y - panel!.y - panel!.height - 12)).toBeLessThan(
          1,
        );
      }
    }
  }
  await page.getByRole("heading", { name: /^Goals\.?$/ }).click();
  await expect(page.getByRole("tabpanel")).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await enterEditMode(page, "Goals");
  await expect(page.getByRole("tabpanel")).toHaveCount(0);
  await expect(picker.getByLabel("Goal name", { exact: true })).toHaveCount(6);
  for (const card of await picker.locator(".direction-choice").all()) {
    await expect(card.getByLabel("Goal name", { exact: true })).toBeVisible();
    await expect(
      card.getByRole("combobox", { name: "Goal status", exact: true }),
    ).toBeVisible();
    expect(
      await card.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return [
          ...element.querySelectorAll(
            ".goal-preview-edit input:not([type=hidden]), .themed-date-trigger",
          ),
        ].every((input) => {
          const box = input.getBoundingClientRect();
          return (
            box.y >= bounds.y &&
            box.bottom <= bounds.bottom &&
            box.x >= bounds.x &&
            box.right <= bounds.right
          );
        });
      }),
    ).toBe(true);
  }
  const security = picker.locator('[data-goal-id="security"]');
  await security.getByLabel("End date", { exact: true }).fill("2030-10-01");
  await security
    .getByLabel("Goal name", { exact: true })
    .fill("Secure product design");
  await page.getByRole("heading", { name: /^Goals\.?$/ }).click();
  await expect.poll(() => records[1].data.endDate).toBe("2030-10-01");
  await expect.poll(() => records[1].title).toBe("Secure product design");
  for (const width of [800, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const columns = await picker.evaluate(
      (element) =>
        getComputedStyle(element).gridTemplateColumns.split(" ").length,
    );
    expect(columns).toBe(width === 800 ? 2 : 1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
});

test("one action supports multiple goals and cannot lose its last goal", async ({
  page,
}) => {
  const { goals } = await directionWorkspace(page);
  await page.goto("/goals");
  await page.getByRole("tab").first().click();
  await enterEditMode(page, "Goals");
  const action = page.locator(`#direction-item-${goals[0].id}`);
  await expect(
    action.getByRole("checkbox", {
      name: "Platform engineering and distributed systems",
      exact: true,
    }),
  ).toBeDisabled();
  const editHeight = await action.boundingBox();
  expect(editHeight!.height).toBeLessThan(330);
  await action
    .getByRole("checkbox", { name: "Product security", exact: true })
    .check();
  await page
    .getByRole("tab", { name: "Product security", exact: true })
    .click();
  await expect.poll(() => goals[0].goalIds).toEqual(["platform", "security"]);
  await expect(action).toBeVisible();
  await action
    .getByRole("button", { name: "Mark complete", exact: true })
    .click();
  await page
    .getByRole("tab", {
      name: "Platform engineering and distributed systems",
      exact: true,
    })
    .click();
  await expect(
    action.getByRole("button", { name: "Reopen", exact: true }),
  ).toBeVisible();
  expect(goals).toHaveLength(3);
  await action
    .getByRole("checkbox", { name: "Product security", exact: true })
    .uncheck();
  await page
    .getByRole("tab", { name: "Product security", exact: true })
    .click();
  await expect(action).toHaveCount(0);
  expect(goals[0].goalIds).toEqual(["platform"]);
});

test("one-day actions appear as events with a date anchored to their marker", async ({
  page,
}) => {
  const { goals } = await directionWorkspace(page);
  await page.goto("/goals");
  await page.getByRole("tab").first().click();
  await enterEditMode(page, "Goals");
  const action = page.locator(`#direction-item-${goals[0].id}`);
  const schedule = action.getByRole("combobox", {
    name: "Schedule",
    exact: true,
  });
  await schedule.click();
  await page
    .getByRole("option", { name: "One-day event", exact: true })
    .click();
  await action.getByLabel("Event date", { exact: true }).fill("2030-04-01");
  await page
    .getByRole("tab", { name: "Product security", exact: true })
    .click();
  expect(goals[0].scheduleKind).toBe("event");
  expect(goals[0].startDate).toBe("2030-04-01");
  expect(goals[0].targetDate).toBe("2030-04-01");
  await page.getByRole("tab").first().click();
  await expect(action.locator(".schedule-span.is-point")).toHaveCount(1);
  await expect(action.locator(".action-status")).toHaveText("Today");
  await expect(action.locator(".action-status")).not.toContainText(
    "In progress",
  );
  const point = await action.locator(".schedule-span").boundingBox();
  const label = await action.locator(".action-date-point").boundingBox();
  expect(
    Math.abs(point!.x + point!.width / 2 - (label!.x + label!.width / 2)),
  ).toBeLessThan(2);
});
