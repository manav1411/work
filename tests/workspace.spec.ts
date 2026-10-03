import { expect, test } from "@playwright/test";

test.describe("shared workspace journeys", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() =>
      sessionStorage.setItem("work-demo-active", "true"),
    );
  });
  test("keyboard capture, global search and a recovered focus session", async ({
    page,
  }) => {
    await page.goto("/today");
    await page.getByRole("heading", { name: "Hey, Manav." }).waitFor();
    await page.keyboard.press("c");
    const capture = page.getByRole("dialog", {
      name: "Catch it before it goes",
    });
    await capture
      .getByRole("button", { name: "Next step", exact: true })
      .click();
    await capture.getByLabel("Give it a name").fill("Synthetic shared capture");
    await capture
      .getByRole("button", { name: "Keep this", exact: true })
      .click();
    await expect(capture).not.toBeVisible();
    await page.keyboard.press("Control+k");
    const search = page.getByRole("dialog", { name: "Find your thread" });
    await search.getByRole("textbox").fill("Synthetic shared capture");
    await search
      .getByRole("button", { name: /Synthetic shared capture/ })
      .click();
    await page.goto("/focus");
    await page
      .getByLabel("Action to focus on")
      .selectOption({ label: "Synthetic shared capture" });
    await page.getByRole("button", { name: "Start a little focus" }).click();
    await page
      .getByLabel("Your thinking, as you go")
      .fill("A synthetic reflection worth keeping.");
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.reload();
    await expect(page.getByLabel("Your thinking, as you go")).toHaveValue(
      "A synthetic reflection worth keeping.",
    );
    await page.getByLabel("I finished the linked action").check();
    await page.getByRole("button", { name: "Done for now" }).click();
    const state = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("work-demo-v1")!),
    );
    expect(
      state.records.find(
        (row: { title: string; kind: string }) =>
          row.title === "Synthetic shared capture" && row.kind === "action",
      ).data.status,
    ).toBe("done");
    expect(
      state.records.find((row: { kind: string }) => row.kind === "focus").body,
    ).toContain("synthetic reflection");
  });
  test("import, skip duplicates, undo, recover trash and restore an additive backup", async ({
    page,
  }) => {
    await page.goto("/settings/import-export");
    const upload = {
      name: "synthetic-note.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "# Synthetic import\n\nA safe sample for recovery tests.",
      ),
    };
    await page
      .getByLabel("Choose import files", { exact: true })
      .setInputFiles(upload);
    await page.getByRole("button", { name: "Import 1 records" }).click();
    await expect(
      page.getByText("1 created · 0 updated · 0 skipped.", { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Choose import files", { exact: true })
      .setInputFiles(upload);
    await page.getByRole("button", { name: "Import 1 records" }).click();
    await expect(
      page.getByText("0 created · 0 updated · 1 skipped.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Undo import", exact: true })
      .first()
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    await page.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Restore", exact: true }),
    ).toHaveCount(0);
    const archive = await page.evaluate(() => {
      const state = JSON.parse(sessionStorage.getItem("work-demo-v1")!);
      return {
        format: "work-export",
        version: 1,
        exportedAt: new Date().toISOString(),
        records: state.records,
        revisions: state.revisions,
        attachments: state.attachments,
        preferences: state.preferences,
      };
    });
    const oldCount = archive.records.length;
    await page.getByLabel("Choose Work backup").setInputFiles({
      name: "work-backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(archive)),
    });
    await page
      .getByRole("button", { name: "Restore as separate archive" })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(sessionStorage.getItem("work-demo-v1")!).records.length,
        ),
      )
      .toBe(oldCount * 2);
    expect(
      await page.evaluate(
        (ids) =>
          ids.every((id: string) =>
            JSON.parse(sessionStorage.getItem("work-demo-v1")!).records.some(
              (row: { id: string }) => row.id === id,
            ),
          ),
        archive.records.map((row: { id: string }) => row.id),
      ),
    ).toBe(true);
  });
  test("saved preferences change theme and dates without changing records", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page
      .getByLabel("What should we call you?")
      .fill("Synthetic Engineer");
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    await page
      .getByLabel("Timezone", { exact: true })
      .fill("America/Los_Angeles");
    await page.getByLabel("Reduce motion and animated interactions").check();
    await page.getByRole("button", { name: "Save my preferences" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.getByLabel("What should we call you?")).toHaveValue(
      "Synthetic Engineer",
    );
    await expect(page.locator("html")).toHaveAttribute(
      "data-reduce-motion",
      "true",
    );
  });
  test("every launch area fits a phone and renders without page errors", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const route of [
      "today",
      "focus",
      "learn",
      "practice",
      "interviews",
      "companies",
      "applications",
      "network",
      "career",
      "evidence",
      "projects",
      "assets",
      "notes",
      "resources",
      "review",
      "settings",
      "settings/import-export",
    ]) {
      await page.goto(`/${route}`);
      await page.locator("main h1").waitFor();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(390);
      await expect(page.getByText("This page needs a fresh start")).toHaveCount(
        0,
      );
    }
    expect(errors).toEqual([]);
  });
});

test("private local API edits survive reconnect and queued writes retain their links", async ({
  page,
}) => {
  test.skip(
    !!process.env.CI && process.env.WORK_TEST_LOCAL !== "true",
    "CI demo tests are independent of runtime credentials; backend tests cover storage.",
  );
  const session = await page.request.get("/api/session");
  const identity = await session.json();
  test.skip(!identity.local, "Only emulated local fixtures may run this test.");
  const prefix = `Synthetic offline ${crypto.randomUUID()}`;
  const created: string[] = [];
  try {
    await page.goto("/notes");
    await page.getByRole("button", { name: "New note", exact: true }).click();
    await page.getByLabel("Note title", { exact: true }).fill(prefix);
    await page.getByRole("button", { name: "Save now", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Saved");
    const id = new URL(page.url()).searchParams.get("record")!;
    created.push(id);
    await page.route("**/api/records/**", (route) =>
      route.request().method() === "PATCH"
        ? route.abort("internetdisconnected")
        : route.continue(),
    );
    await page
      .getByLabel("Note content", { exact: true })
      .fill("Synthetic offline body, retained on this device.");
    await page.getByRole("button", { name: "Save now", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("sync pending");
    await page.unroute("**/api/records/**");
    await page
      .getByRole("link", { name: "Make it yours", exact: true })
      .click();
    await page.getByRole("heading", { name: "Make it yours." }).waitFor();
    const sync = page.getByRole("button", { name: "Try syncing", exact: true });
    if (await sync.count()) await sync.click();
    await expect(
      page.getByRole("heading", { name: /Your device drafts/ }),
    ).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`/api/records/${id}`)).json()).record
            .body,
      )
      .toBe("Synthetic offline body, retained on this device.");
  } finally {
    for (const id of created) {
      await page.request
        .delete(`/api/records/${id}`, { timeout: 2000 })
        .catch(() => undefined);
      await page.request
        .delete(`/api/records/${id}/permanent`, { timeout: 2000 })
        .catch(() => undefined);
    }
  }
});
