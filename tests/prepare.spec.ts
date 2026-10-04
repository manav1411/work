import { expect, test } from "@playwright/test";
import { DEFAULT_PREFERENCES, type WorkRecord } from "../shared/model";
import { DEMO_STATS } from "../src/features/learn/demo";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("work-demo-active", "true"),
  );
});

test("Learn opens the roadmap and tasteful resources without Weeks or NeetCode destinations", async ({
  page,
}) => {
  const sourceRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/learning\/|manavdodia\.com\/api\//.test(request.url()))
      sourceRequests.push(request.url());
  });
  await page.goto("/learn?problem=binary-search");
  await expect(
    page.getByRole("heading", { name: "DSA & Python roadmap", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "150 problem roadmap", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Weeks", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".learn-week-card")).toHaveCount(0);
  await expect(page.locator('a[href*="neetcode.io"]')).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "LeetCode problems", exact: true }),
  ).toHaveAttribute("href", "https://leetcode.com/problemset/");
  await expect(
    page.getByRole("link", { name: "Python tutorial", exact: true }),
  ).toHaveAttribute("href", "https://docs.python.org/3/tutorial/");
  const popover = page.locator(".learn-roadmap-popover");
  await expect(
    popover.getByRole("link", { name: "Binary Search", exact: true }),
  ).toHaveAttribute("href", "https://leetcode.com/problems/binary-search/");
  await expect(popover.getByLabel("Confirmed solve")).toHaveCount(1);
  expect(sourceRequests).toEqual([]);
});

test("Databases supports multiple readings and optional notes that persist after reload", async ({
  page,
}) => {
  await page.goto("/learn?track=databases");
  const section = page.locator(".learn-reading-card").first();
  for (const [name, url] of [
    [
      "PostgreSQL concurrency",
      "https://www.postgresql.org/docs/current/mvcc.html",
    ],
    ["SQLite transactions", "https://www.sqlite.org/lang_transaction.html"],
  ]) {
    await section
      .getByRole("button", { name: "Add resource", exact: true })
      .click();
    const form = page.getByRole("dialog", {
      name: "Add resource",
      exact: true,
    });
    await form.getByLabel("Name", { exact: true }).fill(name);
    await form.getByLabel("Link", { exact: true }).fill(url);
    await form.getByRole("button", { name: "Save", exact: true }).click();
    await expect(form).not.toBeVisible();
  }
  await section
    .getByRole("button", { name: "Add notes section", exact: true })
    .click();
  const notes = page.getByRole("dialog", {
    name: "Add notes section",
    exact: true,
  });
  await notes.getByLabel("Name", { exact: true }).fill("Isolation notes");
  await notes.getByRole("button", { name: "Save", exact: true }).click();
  const noteCard = section
    .locator(".content-section-card")
    .filter({ hasText: "Isolation notes" });
  await noteCard
    .getByRole("button", { name: "Write notes", exact: true })
    .click();
  await noteCard
    .getByLabel("Isolation notes", { exact: true })
    .fill(
      "## Read committed\n\n- [ ] Compare repeatable read\n\nKeep this personal example.",
    );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(sessionStorage.getItem("work-demo-v1")!).records.find(
            (record: WorkRecord) => record.title === "Isolation notes",
          )?.body,
      ),
    )
    .toContain("Keep this personal example.");
  await page.reload();
  await expect(
    section.getByRole("link", { name: "PostgreSQL concurrency", exact: true }),
  ).toBeVisible();
  await expect(
    section.getByRole("link", { name: "SQLite transactions", exact: true }),
  ).toBeVisible();
  await expect(
    noteCard.getByRole("heading", { name: "Read committed", exact: true }),
  ).toBeVisible();
  await section
    .getByRole("button", { name: "Edit SQLite transactions", exact: true })
    .click();
  const edit = page.getByRole("dialog", { name: "Edit resource", exact: true });
  await edit
    .getByLabel("Name", { exact: true })
    .fill("SQLite transaction reference");
  await edit.getByRole("button", { name: "Save", exact: true }).click();
  const resource = section
    .locator(".content-resource-card")
    .filter({ hasText: "SQLite transaction reference" });
  await resource
    .getByRole("button", { name: "Delete resource", exact: true })
    .click();
  await resource
    .getByRole("button", { name: "Confirm delete resource", exact: true })
    .click();
  await expect(resource).toHaveCount(0);
  await page.reload();
  await expect(
    section.getByRole("link", { name: "PostgreSQL concurrency", exact: true }),
  ).toBeVisible();
  await expect(
    section.getByRole("link", {
      name: "SQLite transaction reference",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("Pomodoro pauses, persists through reload, and settings remain usable", async ({
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
  await timer.getByRole("button", { name: "Pause timer", exact: true }).click();
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

test("mobile topics scroll with keyboard and retain expressive selected state", async ({
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
  await page
    .getByRole("tab", { name: "Backend engineering", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "Backend engineering", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const selected = await page
    .getByRole("tab", { name: "Backend engineering", exact: true })
    .evaluate((element) => ({
      color: getComputedStyle(element).color,
      background: getComputedStyle(element).backgroundColor,
    }));
  expect(selected.color).toBe("rgb(255, 255, 255)");
  expect(selected.background).not.toBe("rgba(0, 0, 0, 0)");
  await page.goto("/learn?problem=binary-search");
  await expect(
    page
      .locator(".learn-roadmap-list")
      .getByRole("link", { name: "Binary Search", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});

test("signed-in private learning notes use owned records and never write to public learning source", async ({
  page,
}) => {
  await page.addInitScript(() => sessionStorage.removeItem("work-demo-active"));
  const records: WorkRecord[] = [];
  const learningWrites: string[] = [];
  const privateWrites: string[] = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
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
          preferences: { ...DEFAULT_PREFERENCES, leetcode: "synthetic-handle" },
        },
      });
    if (path.startsWith("/api/learning/") && method !== "GET")
      learningWrites.push(path);
    if (path === "/api/learning/stats")
      return route.fulfill({
        json: {
          data: { ...DEMO_STATS, username: "synthetic-handle" },
          username: "synthetic-handle",
          configured: true,
          source: { fetchedAt: "2026-10-04T00:00:00Z", stale: true },
        },
      });
    if (path === "/api/records" && method === "GET")
      return route.fulfill({ json: { records } });
    if (path === "/api/records" && method === "POST") {
      const input = route.request().postDataJSON();
      privateWrites.push(path);
      const record = {
        ...input,
        id: crypto.randomUUID(),
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
        tags: [],
        links: [],
      };
      records.push(record);
      return route.fulfill({ json: { record } });
    }
    if (path.startsWith("/api/records/") && method === "PATCH") {
      const record = records.find(
        (record) => record.id === path.split("/").pop(),
      )!;
      const patch = route.request().postDataJSON();
      privateWrites.push(path);
      Object.assign(record, patch, { version: record.version + 1 });
      return route.fulfill({ json: { record } });
    }
    return route.fulfill({ json: { goals: [], records: [] } });
  });
  await page.goto("/learn");
  await expect(
    page.getByText("synthetic-handle · Cached data", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Databases", exact: true }).click();
  const section = page.locator(".learn-reading-card").first();
  await section
    .getByRole("button", { name: "Add notes section", exact: true })
    .click();
  const form = page.getByRole("dialog", {
    name: "Add notes section",
    exact: true,
  });
  await form
    .getByLabel("Name", { exact: true })
    .fill("Private learning context");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await section
    .getByRole("button", { name: "Write notes", exact: true })
    .click();
  await section
    .getByLabel("Private learning context", { exact: true })
    .fill("Private notes must stay in Work.");
  await expect
    .poll(
      () =>
        records.find((record) => record.title === "Private learning context")
          ?.body,
    )
    .toBe("Private notes must stay in Work.");
  expect(privateWrites.length).toBeGreaterThanOrEqual(2);
  expect(learningWrites).toEqual([]);
});

test("scoped notes retain conflicts through reload and retry only after an explicit decision", async ({
  page,
}) => {
  await page.addInitScript(() => sessionStorage.removeItem("work-demo-active"));
  const records: WorkRecord[] = [];
  let failWrites = false;
  let writes = 0;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path === "/api/session")
      return route.fulfill({
        json: {
          user: {
            id: "synthetic-conflict-owner",
            name: "Synthetic",
            email: "conflict@example.invalid",
          },
          local: false,
          configured: true,
        },
      });
    if (path === "/api/preferences")
      return route.fulfill({
        json: { preferences: { ...DEFAULT_PREFERENCES, leetcode: "" } },
      });
    if (path === "/api/records" && method === "GET")
      return route.fulfill({ json: { records } });
    if (path === "/api/records" && method === "POST") {
      const input = route.request().postDataJSON();
      const record = {
        ...input,
        id: crypto.randomUUID(),
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
        tags: [],
        links: [],
      };
      records.push(record);
      return route.fulfill({ json: { record } });
    }
    if (path.startsWith("/api/records/") && method === "PATCH") {
      writes++;
      const record = records.find(
        (record) => record.id === path.split("/").pop(),
      )!;
      if (failWrites) {
        record.body = "Latest text saved on another device.";
        record.version++;
        return route.fulfill({
          status: 409,
          json: {
            error:
              "This note changed on another device. Review the saved text.",
          },
        });
      }
      const patch = route.request().postDataJSON();
      Object.assign(record, patch, { version: record.version + 1 });
      return route.fulfill({ json: { record } });
    }
    return route.fulfill({
      json: {
        goals: [],
        records: [],
        data: {},
        configured: false,
        source: { stale: false, fetchedAt: null },
      },
    });
  });
  await page.goto("/learn?track=databases");
  const section = page.locator(".learn-reading-card").first();
  await section
    .getByRole("button", { name: "Add notes section", exact: true })
    .click();
  const form = page.getByRole("dialog", {
    name: "Add notes section",
    exact: true,
  });
  await form
    .getByLabel("Name", { exact: true })
    .fill("Conflict isolation notes");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  const note = section
    .locator(".content-section-card")
    .filter({ hasText: "Conflict isolation notes" });
  await note.getByRole("button", { name: "Write notes", exact: true }).click();
  await note
    .getByLabel("Conflict isolation notes", { exact: true })
    .fill("Original saved notes.");
  await expect
    .poll(
      () =>
        records.find((record) => record.title === "Conflict isolation notes")
          ?.body,
    )
    .toBe("Original saved notes.");
  failWrites = true;
  await note
    .getByLabel("Conflict isolation notes", { exact: true })
    .fill("Keep my unsaved transaction example.");
  await expect(note.getByRole("alert")).toContainText(
    "changed on another device",
  );
  await expect(
    note.getByLabel("Conflict isolation notes", { exact: true }),
  ).toHaveValue("Keep my unsaved transaction example.");
  const attempts = writes;
  await page.reload();
  await expect(note).toContainText("Keep my unsaved transaction example.");
  await expect(
    note.getByRole("button", { name: "Retry save", exact: true }),
  ).toBeVisible();
  // Wait beyond the normal autosave debounce to verify a restored conflict is paused.
  await page.waitForTimeout(1100);
  expect(writes).toBe(attempts);
  await note.getByText("Compare with saved text", { exact: true }).click();
  await expect(note).toContainText("Latest text saved on another device.");
  failWrites = false;
  await note.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect
    .poll(
      () =>
        records.find((record) => record.title === "Conflict isolation notes")
          ?.body,
    )
    .toBe("Keep my unsaved transaction example.");
  expect(writes).toBe(attempts + 1);
  await page.reload();
  await expect(
    note.getByRole("button", { name: "Retry save", exact: true }),
  ).toHaveCount(0);
  await expect(note).toContainText("Keep my unsaved transaction example.");
});
