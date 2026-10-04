import { expect, test } from "@playwright/test";

test("retired connector route exposes no connection controls and keeps imported records", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("work-demo-active", "true"),
  );
  await page.goto("/settings");
  await page.getByRole("heading", { name: /^Settings/ }).waitFor();
  await page.evaluate(() => {
    const state = JSON.parse(sessionStorage.getItem("work-demo-v1")!);
    const at = "2026-01-01T00:00:00Z";
    state.records.push({
      id: "existing-notion-record",
      kind: "note",
      title: "Existing Notion source",
      body: "Preserved imported contents",
      tags: [],
      links: [],
      data: {
        connectorSource: {
          id: "notion-source",
          provider: "notion",
          url: "https://www.notion.so/existing",
          lastFetchedAt: at,
          sourceUpdatedAt: at,
          available: true,
        },
      },
      version: 1,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    });
    state.connectors = {
      connections: [
        {
          id: "existing-notion-connection",
          provider: "notion",
          accountId: "existing-account",
          label: "Existing Notion account",
          status: "paused",
          config: {
            selections: [
              {
                id: "notion-source",
                recordId: "existing-notion-record",
                title: "Existing Notion source",
                url: "https://www.notion.so/existing",
              },
            ],
          },
          snapshot: {},
          createdAt: at,
          lastSuccessAt: at,
          lastAttemptAt: at,
          nextSyncAt: null,
          error: null,
        },
      ],
      runs: [],
      activity: [],
      suggestions: [],
    };
    sessionStorage.setItem("work-demo-v1", JSON.stringify(state));
  });
  await page.goto("/connectors");
  await expect(page).toHaveURL(/\/settings\?legacy=connectors#recovery$/);
  await expect(page.locator(".legacy-recovery-note")).toContainText(
    "Connectors has been retired",
  );
  await expect(
    page.getByRole("button", { name: "Connect profile", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .getByRole("link", { name: "Connectors", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Existing connections", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Saved records and files", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Overleaf documents", exact: true }),
  ).toHaveCount(0);
  const state = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("work-demo-v1")!),
  );
  expect(
    state.records.find(
      (row: { id: string }) => row.id === "existing-notion-record",
    ).body,
  ).toBe("Preserved imported contents");
});

test("clearing the direct LeetCode username prevents retired connector settings from reappearing", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("work-demo-active", "true"),
  );
  await page.goto("/settings");
  await page.getByRole("heading", { name: /^Settings/ }).waitFor();
  await page.evaluate(() => {
    const state = JSON.parse(sessionStorage.getItem("work-demo-v1")!);
    const at = "2026-01-01T00:00:00Z";
    state.preferences.leetcode = "previous_handle";
    state.connectors = {
      connections: [
        {
          id: "existing-leetcode",
          provider: "leetcode",
          accountId: "previous_handle",
          label: "previous_handle",
          status: "connected",
          config: { username: "previous_handle" },
          snapshot: {},
          createdAt: at,
          lastSuccessAt: at,
          lastAttemptAt: at,
          nextSyncAt: null,
          error: null,
        },
      ],
      runs: [],
      activity: [],
      suggestions: [],
    };
    sessionStorage.setItem("work-demo-v1", JSON.stringify(state));
  });
  await page.reload();
  await expect(
    page.getByLabel("LeetCode username", { exact: true }),
  ).toHaveValue("previous_handle");
  await page.getByLabel("LeetCode username", { exact: true }).fill("");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".settings-save-status")).toHaveText("Saved");
  await page.reload();
  await expect(
    page.getByLabel("LeetCode username", { exact: true }),
  ).toHaveValue("");
  const state = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("work-demo-v1")!),
  );
  expect(state.preferences.leetcode).toBe("");
});
