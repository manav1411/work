import { expect, test } from "@playwright/test";
import { DEFAULT_PREFERENCES, type WorkRecord } from "../shared/model";
import { DEMO_STATS } from "../src/features/learn/demo";
import { enterEditMode } from "./edit-mode-helper";

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
    page.getByRole("heading", { name: "Roadmap", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".learn-roadmap")).toContainText("/150");
  const roadmapNotes = page.locator(".learn-roadmap + .rich-document");
  await expect(roadmapNotes).toHaveCount(1);
  await expect(roadmapNotes.locator(".rich-document-canvas")).toHaveCSS(
    "min-height",
    "0px",
  );
  await expect(
    roadmapNotes.locator(".rich-document-canvas .rich-document-prose"),
  ).toHaveCSS("min-height", "0px");
  await expect
    .poll(() =>
      roadmapNotes.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).marginTop),
      ),
    )
    .toBe(24);
  const selectedTrack = page.getByRole("tab", {
    name: "DSA & Python",
    exact: true,
  });
  await selectedTrack.hover();
  await expect
    .poll(() =>
      selectedTrack.evaluate((tab) => getComputedStyle(tab).transform),
    )
    .toBe("none");
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
  await expect(popover.getByLabel("Solved")).toHaveCount(1);
  expect(sourceRequests).toEqual([]);
  await enterEditMode(page, "Learn");
  await expect(page.locator(".learn-track-tabs .sort-handle")).toHaveCount(
    await page.getByRole("tab").count(),
  );
  await expect(page.locator(".learn-page .rich-block-handle")).toHaveCount(0);
  await expect
    .poll(() =>
      selectedTrack.evaluate((tab) => tab.getBoundingClientRect().height),
    )
    .toBe(40);
  const databasesTab = page.getByRole("tab", {
    name: "Databases",
    exact: true,
  });
  await databasesTab.focus();
  await page.keyboard.press("Enter");
  await expect(databasesTab).toHaveAttribute("aria-selected", "true");
  const databasesCanvas = page.locator(
    ".learn-page .rich-document-canvas",
  );
  await expect
    .poll(() =>
      databasesCanvas.evaluate((canvas) => getComputedStyle(canvas).minHeight),
    )
    .not.toBe("0px");
  await expect(page.locator(".learn-page .rich-block-handle")).toHaveCount(0);
  const deleteTab = page.getByRole("button", {
    name: "Delete tab",
    exact: true,
  });
  await expect(deleteTab).toBeVisible();
  const deleteStyle = await deleteTab.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const tabListRect = document
      .querySelector('[role="tablist"][aria-label="Learning tabs"]')!
      .getBoundingClientRect();
    const style = getComputedStyle(button);
    return {
      background: style.backgroundColor,
      borderColor: style.borderColor,
      borderStyle: style.borderStyle,
      belowTabBar: rect.top >= tabListRect.bottom,
      rightAlignedToTabBox: Math.abs(rect.right - (tabListRect.right - 8)) < 1,
    };
  });
  expect(deleteStyle).toEqual({
    background: "rgb(255, 222, 220)",
    borderColor: "rgb(133, 44, 38)",
    borderStyle: "solid",
    belowTabBar: true,
    rightAlignedToTabBox: true,
  });
});

test("learning tabs are single notes pages and save independently", async ({
  page,
}) => {
  await page.goto("/learn?track=databases");
  await expect(page.locator(".learn-reading-card")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add section" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Delete section" }),
  ).toHaveCount(0);
  await expect(page.locator(".learn-page .rich-document")).toHaveCount(1);
  await enterEditMode(page, "Learn");
  const editor = page.locator(".learn-page .rich-document-prose");
  await editor.fill("Compare isolation levels with a real transaction.");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(sessionStorage.getItem("work-demo-v1")!).records.find(
            (record: WorkRecord) =>
              record.kind === "note" &&
              record.data.category === "content-document" &&
              record.data.track === "databases",
          )?.body,
      ),
    )
    .toContain("Compare isolation levels");
  const databaseDocument = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("work-demo-v1")!).records.find(
      (record: WorkRecord) =>
        record.kind === "note" &&
        record.data.category === "content-document" &&
        record.data.track === "databases",
    ),
  );
  expect(databaseDocument.data.scope).toBe("learn");
  expect(databaseDocument.data.topicId).toBeUndefined();
  expect(databaseDocument.data.seedId).toBeUndefined();
  await page.reload();
  await enterEditMode(page, "Learn");
  await expect(page.locator(".learn-page .rich-document-prose")).toContainText(
    "Compare isolation levels",
  );
  const databasesTab = page.getByRole("tab", {
    name: "Databases",
    exact: true,
  });
  const backendTab = page.getByRole("tab", {
    name: "Backend engineering",
    exact: true,
  });
  await backendTab.focus();
  await page.keyboard.press("Enter");
  await expect(backendTab).toHaveAttribute("aria-selected", "true");
  const backendEditor = page.locator(".learn-page .rich-document-prose");
  await backendEditor.fill("Document API failure modes.");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(sessionStorage.getItem("work-demo-v1")!).records.find(
            (record: WorkRecord) =>
              record.kind === "note" &&
              record.data.category === "content-document" &&
              record.data.track === "backend",
          )?.body,
      ),
    )
    .toContain("Document API failure modes");
  await databasesTab.focus();
  await page.keyboard.press("Enter");
  await expect(databasesTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".learn-page .rich-document-prose")).toContainText(
    "Compare isolation levels",
  );
  await expect(
    page.locator(".learn-page .rich-document-prose"),
  ).not.toContainText("Document API failure modes");
});

test("learning topic tabs can be reordered from their drag handles", async ({
  page,
}) => {
  await page.goto("/learn");
  await enterEditMode(page, "Learn");
  const tabs = page.locator(".learn-track-tabs [role=tab]");
  const order = () =>
    tabs.evaluateAll((items) =>
      items.map((item) => item.getAttribute("aria-label")),
    );
  const before = await order();
  const handle = page.locator(".learn-track-tabs .sort-handle").first();
  const start = await handle.boundingBox();
  const target = await page
    .locator(".learn-track-tabs > .sortable-item")
    .nth(1)
    .boundingBox();
  expect(start).not.toBeNull();
  expect(target).not.toBeNull();
  await page.mouse.move(
    start!.x + start!.width / 2,
    start!.y + start!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    target!.x + target!.width / 2,
    target!.y + target!.height / 2,
    { steps: 6 },
  );
  await page.mouse.up();
  await expect.poll(order).not.toEqual(before);
  await expect(page.locator(".learn-page .rich-block-handle")).toHaveCount(0);
});

test("Pomodoro pauses, persists through reload, and settings remain usable", async ({
  page,
}) => {
  await page.goto("/learn");
  const timer = page.locator(".learn-pomodoro").first();
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

test("an expired saved timer immediately starts the next phase and sounds an alert", async ({
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
  await expect(page.getByLabel("Break time remaining")).not.toHaveText("00:00");
  await expect(page.locator(".learn-timer-alarm")).toContainText(
    "Focus complete",
  );
  await expect(
    page.getByRole("button", { name: "Pause timer", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Turn off timer alert" }).click();
  await expect(page.locator(".learn-timer-alarm")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Pause timer", exact: true }),
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
    page.getByRole("link", { name: "@synthetic-handle", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".learn-calendar-freshness")).toContainText(
    "Cached",
  );
  await enterEditMode(page, "Learn");
  const databasesTab = page.getByRole("tab", {
    name: "Databases",
    exact: true,
  });
  await databasesTab.focus();
  await page.keyboard.press("Enter");
  await expect(databasesTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".learn-page .rich-block-handle")).toHaveCount(0);
  await expect(page.locator(".learn-reading-card")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add section" })).toHaveCount(
    0,
  );
  await page
    .locator(".learn-page .rich-document-prose")
    .fill("Private database notes must stay in Work.");
  await expect
    .poll(
      () =>
        records.find(
          (record) =>
            record.data.category === "content-document" &&
            record.data.scope === "learn" &&
            record.data.track === "databases",
        )?.body,
    )
    .toContain("Private database notes must stay in Work.");
  expect(privateWrites.length).toBeGreaterThanOrEqual(1);
  expect(learningWrites).toEqual([]);
});

test("track notes retain conflicts through reload until the draft is reviewed", async ({
  page,
}) => {
  test.setTimeout(45_000);
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
  await enterEditMode(page, "Learn");
  const editor = page.locator(".learn-page .rich-document-prose");
  await editor.fill("Original saved notes.");
  await expect
    .poll(
      () =>
        records.find(
          (record) =>
            record.data.category === "content-document" &&
            record.data.track === "databases",
        )?.body,
    )
    .toBe("Original saved notes.");
  failWrites = true;
  await editor.fill("Keep my unsaved transaction example.");
  await expect(page.getByRole("alert")).toContainText(
    "changed on another device",
  );
  await expect(editor).toHaveText("Keep my unsaved transaction example.");
  const attempts = writes;
  await page.reload();
  await expect(editor).toContainText("Keep my unsaved transaction example.");
  await expect(
    page.getByRole("button", { name: "Keep reviewed draft", exact: true }),
  ).toBeVisible();
  // Wait beyond the normal autosave debounce to verify a restored conflict is paused.
  await page.waitForTimeout(1100);
  expect(writes).toBe(attempts);
  await page.getByText("Compare saved content", { exact: true }).click();
  failWrites = false;
  await page
    .getByRole("button", { name: "Keep reviewed draft", exact: true })
    .click();
  await expect
    .poll(
      () =>
        records.find(
          (record) =>
            record.data.category === "content-document" &&
            record.data.track === "databases",
        )?.body,
    )
    .toBe("Keep my unsaved transaction example.");
  expect(writes).toBe(attempts + 1);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Keep reviewed draft", exact: true }),
  ).toHaveCount(0);
  await expect(editor).toContainText("Keep my unsaved transaction example.");
});
