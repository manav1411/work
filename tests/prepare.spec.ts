import { expect, test } from "@playwright/test";
import { DEFAULT_PREFERENCES } from "../shared/model";
import { DEMO_STATS, DEMO_WEEKS } from "../src/features/learn/demo";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("work-demo-active", "true");
  });
});

test("demo Learn opens slides and shared homework without external calls or journals", async ({
  page,
}) => {
  const sourceRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/learning\/|manavdodia\.com\/api\//.test(request.url()))
      sourceRequests.push(request.url());
  });
  await page.goto("/learn");
  await expect(
    page.getByRole("heading", { name: "Learn.", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".learn-week-card")).toHaveCount(12);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  const week = page.locator(".learn-week-card").first();
  await week.getByRole("button", { name: "Slides", exact: true }).click();
  const slides = page.getByRole("dialog");
  await expect(
    slides.getByText("Demo slide deck.", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(
    slides.getByRole("heading", { name: "Binary search", exact: true }),
  ).toBeVisible();
  await slides.getByRole("button", { name: "Topic 2", exact: true }).click();
  await expect(
    slides.getByRole("heading", { name: "Complexity", exact: true }),
  ).toBeVisible();
  await slides
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await week.getByRole("button", { name: "Homework", exact: true }).click();
  const homework = page.getByRole("dialog");
  await homework
    .getByRole("checkbox", {
      name: "Run a Python solution locally",
      exact: true,
    })
    .check();
  await expect(
    homework.getByRole("checkbox", {
      name: "Run a Python solution locally",
      exact: true,
    }),
  ).toBeChecked();
  await expect(
    homework.getByRole("link", { name: "Binary Search", exact: true }),
  ).toHaveAttribute("href", "https://leetcode.com/problems/binary-search/");
  await expect(homework.getByRole("textbox")).toHaveCount(0);
  await homework
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page.reload();
  await page
    .locator(".learn-week-card")
    .first()
    .getByRole("button", { name: "Homework", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByRole("checkbox", {
      name: "Run a Python solution locally",
      exact: true,
    }),
  ).toBeChecked();
  expect(sourceRequests).toEqual([]);
});

test("Pomodoro pauses and persists one timer through reload and the homework context", async ({
  page,
}) => {
  await page.goto("/learn");
  const timer = page.locator(".learn-context-bar .learn-pomodoro");
  await timer.getByRole("button", { name: "Start timer", exact: true }).click();
  await expect(
    timer.getByRole("button", { name: "Pause timer", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    timer.getByRole("button", { name: "Pause timer", exact: true }),
  ).toBeVisible();
  await page
    .locator(".learn-week-card")
    .first()
    .getByRole("button", { name: "Homework", exact: true })
    .click();
  const homeworkTimer = page.getByRole("dialog").locator(".learn-pomodoro");
  await expect(
    homeworkTimer.getByRole("button", { name: "Pause timer", exact: true }),
  ).toBeVisible();
  await homeworkTimer
    .getByRole("button", { name: "Pause timer", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(
    timer.getByRole("button", { name: "Start timer", exact: true }),
  ).toBeVisible();
  await timer.getByRole("button", { name: "Reset timer", exact: true }).click();
  await expect(timer.getByLabel("Pomodoro time remaining")).toHaveText("25:00");
  await timer
    .getByRole("button", { name: "Timer settings", exact: true })
    .click();
  await timer.getByLabel("Work minutes", { exact: true }).fill("30");
  await timer.getByLabel("Break minutes", { exact: true }).fill("7");
  await timer.getByRole("button", { name: "Save", exact: true }).click();
  await expect(timer.getByLabel("Pomodoro time remaining")).toHaveText("30:00");
  await timer.getByRole("button", { name: "Break", exact: true }).click();
  await expect(timer.getByLabel("Break time remaining")).toHaveText("07:00");
});

test("an expired saved timer finishes accurately after a background interval", async ({
  page,
}) => {
  await page.goto("/learn");
  await page.getByRole("button", { name: "Start timer", exact: true }).click();
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) =>
      key.startsWith("work-pomodoro:"),
    )!;
    const state = JSON.parse(localStorage.getItem(key)!);
    state.endsAt = Date.now() - 5000;
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload();
  await expect(page.getByLabel("Pomodoro time remaining")).toHaveText("00:00");
  await expect(page.getByText("Complete", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start timer", exact: true }),
  ).toBeVisible();
});

test("roadmap and homework use the same confirmed problem history", async ({
  page,
}) => {
  await page.goto("/learn?view=roadmap&problem=binary-search");
  await expect(
    page.getByRole("heading", { name: "NeetCode 150", exact: true }),
  ).toBeVisible();
  const popover = page.locator(".learn-roadmap-popover");
  await expect(
    popover.getByRole("link", { name: "Binary Search", exact: true }),
  ).toBeVisible();
  await expect(popover.getByLabel("Confirmed solve")).toHaveCount(1);
  await page.getByRole("button", { name: "Weeks", exact: true }).click();
  await page
    .locator(".learn-week-card")
    .first()
    .getByRole("button", { name: "Homework", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Confirmed solve"),
  ).toHaveCount(1);
});

test("mobile topics scroll with no scrollbar and roadmap uses readable rows", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/learn");
  const tabs = page.getByRole("tablist", {
    name: "Learning topics",
    exact: true,
  });
  const dimensions = await tabs.evaluate((element) => ({
    width: element.clientWidth,
    scrollWidth: element.scrollWidth,
    scrollbar: getComputedStyle(element).scrollbarWidth,
    webkitDisplay: getComputedStyle(element, "::-webkit-scrollbar").display,
  }));
  expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.width);
  expect(dimensions.scrollbar).toBe("none");
  expect(dimensions.webkitDisplay).toBe("none");
  await page.getByRole("tab", { name: "DSA & Python", exact: true }).focus();
  await page.keyboard.press("End");
  await expect(
    page.getByRole("tab", {
      name: "Security-informed engineering",
      exact: true,
    }),
  ).toBeFocused();
  expect(await tabs.evaluate((element) => element.scrollLeft)).toBeGreaterThan(
    0,
  );
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await page.goto("/learn?view=roadmap&problem=binary-search");
  await expect(
    page
      .locator(".learn-roadmap-list")
      .getByRole("link", { name: "Binary Search", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("signed-in Learn uses authored source content and rolls back failed shared task writes", async ({
  page,
}) => {
  await page.addInitScript(() => {
    sessionStorage.removeItem("work-demo-active");
  });
  let sourceTask = false;
  let failWrite = false;
  const fresh = { fetchedAt: "2026-10-04T00:00:00.000Z", stale: false };
  const sourceWeek = {
    ...DEMO_WEEKS[0],
    title: "Live authored curriculum",
    slides: [{ content: "# Live authored slide" }],
    tasks: [{ id: "live-task", label: "Shared live task" }],
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/session")
      return route.fulfill({
        json: {
          user: {
            id: "synthetic-learn-owner",
            name: "Synthetic",
            email: "synthetic@example.invalid",
          },
          local: false,
          configured: true,
        },
      });
    if (path === "/api/preferences")
      return route.fulfill({
        json: {
          preferences: {
            ...DEFAULT_PREFERENCES,
            leetcode: "https://leetcode.com/u/synthetic-handle/",
          },
        },
      });
    if (path === "/api/records")
      return route.fulfill({ json: { records: [] } });
    if (path === "/api/learning/content")
      return route.fulfill({
        json: { data: { weeks: [sourceWeek] }, source: fresh },
      });
    if (path === "/api/learning/stats")
      return route.fulfill({
        json: {
          data: { ...DEMO_STATS, username: "synthetic-handle" },
          username: "synthetic-handle",
          configured: true,
          source: fresh,
        },
      });
    if (path === "/api/learning/progress") {
      if (route.request().method() === "POST") {
        expect(route.request().postDataJSON()).toEqual({
          taskId: "live-task",
          done: !sourceTask,
        });
        if (failWrite)
          return route.fulfill({
            status: 502,
            json: { error: "Shared task could not be saved." },
          });
        sourceTask = !sourceTask;
      }
      return route.fulfill({
        json: {
          data: { tasks: { "live-task": sourceTask } },
          username: "synthetic-handle",
          configured: true,
          source: fresh,
        },
      });
    }
    return route.fulfill({ json: { goals: [], connections: [], records: [] } });
  });
  await page.goto("/learn");
  await expect(
    page.getByRole("heading", {
      name: "Live authored curriculum",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".learn-week-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Homework", exact: true }).click();
  const task = page
    .getByRole("dialog")
    .getByRole("checkbox", { name: "Shared live task", exact: true });
  await task.check();
  await expect(task).toBeEnabled();
  expect(sourceTask).toBe(true);
  failWrite = true;
  await task.uncheck();
  await expect(task).toBeChecked();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Shared task could not be saved.",
  );
});
