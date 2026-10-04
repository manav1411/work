import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { DEFAULT_PREFERENCES, type WorkRecord } from "../shared/model";

async function openDemo(page: Page, route = "/home") {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("work-shell-test-initialized")) {
      sessionStorage.setItem("work-demo-active", "true");
      sessionStorage.setItem("work-shell-test-initialized", "true");
    }
  });
  await page.goto(route);
  await page.locator("main h1").waitFor();
}

function legacyNote(): WorkRecord {
  return {
    id: "synthetic-retired-note",
    kind: "note",
    title: "Existing Notion preparation",
    body: "Preserve this existing preparation and original file.",
    tags: [],
    links: [],
    data: {},
    version: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
  };
}

test("six destinations and the account menu work with keyboard, pointer, and sign-out", async ({
  page,
}) => {
  await page.route("**/api/session", (route) =>
    route.fulfill({ json: { user: null, local: false, configured: false } }),
  );
  await openDemo(page);
  const nav = page.getByRole("navigation", {
    name: "Main navigation",
    exact: true,
  });
  await expect(nav.getByRole("link")).toHaveText([
    "Home",
    "Learn",
    "Applications",
    "Interviews",
    "Documents",
    "Your Direction",
  ]);
  const account = page
    .locator(".sidebar")
    .getByRole("button", { name: "Account: Demo" });
  await account.focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("menuitem", { name: "Settings", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("menuitem", { name: "Leave demo", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(account).toBeFocused();
  await account.click();
  await page.locator("main h1").click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.keyboard.press("c");
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await account.click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: /^Settings/ })).toBeVisible();
  await account.click();
  await page.getByRole("menuitem", { name: "Leave demo", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem("work-demo-active")),
  ).toBeNull();
});

test("mobile navigation fits, traps drawer focus, and returns focus on close", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDemo(page, "/settings");
  await expect(
    page
      .getByRole("navigation", { name: "Mobile navigation" })
      .getByRole("link"),
  ).toHaveText(["Home", "Learn", "Applications"]);
  await expect(
    page.getByRole("button", { name: "More navigation", exact: true }),
  ).toBeVisible();
  const trigger = page.getByRole("button", {
    name: "Open navigation",
    exact: true,
  });
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "Navigation", exact: true });
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByRole("link", { name: "Work home", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    drawer.getByRole("button", { name: "Account: Demo" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page
    .locator(".mobile-account")
    .getByRole("button", { name: "Account: Demo" })
    .click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  for (const route of [
    "/home",
    "/learn",
    "/applications",
    "/documents",
    "/interviews",
    "/direction",
    "/settings",
  ]) {
    await page.goto(route);
    await page.locator("main h1").waitFor();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(390);
    await expect(
      page.getByRole("heading", { name: "This page could not load" }),
    ).toHaveCount(0);
  }
});

test("compact preferences persist without altering existing records", async ({
  page,
}) => {
  await openDemo(page, "/settings");
  const before = await page.evaluate(
    () => JSON.parse(sessionStorage.getItem("work-demo-v1")!).records,
  );
  await page
    .getByLabel("Timezone", { exact: true })
    .fill("America/Los_Angeles");
  await page
    .getByLabel("LeetCode username", { exact: true })
    .fill("https://example.com/not-a-profile");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".toast-error")).toContainText("LeetCode");
  await page
    .getByLabel("LeetCode username", { exact: true })
    .fill("https://leetcode.com/u/synthetic_engineer/");
  await page.getByLabel("Reduce motion", { exact: true }).check();
  await page.getByLabel("Appearance", { exact: true }).selectOption("dark");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("status", { name: "" }).filter({ hasText: /^Saved$/ }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Timezone", { exact: true })).toHaveValue(
    "America/Los_Angeles",
  );
  await expect(
    page.getByLabel("LeetCode username", { exact: true }),
  ).toHaveValue("synthetic_engineer");
  await expect(page.locator("html")).toHaveAttribute(
    "data-reduce-motion",
    "true",
  );
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  for (const route of [
    "/home",
    "/learn",
    "/applications",
    "/interviews",
    "/documents",
    "/direction",
  ]) {
    await page.goto(route);
    await page.locator("main h1").waitFor();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  }
  await page.goto("/settings");
  await page.getByLabel("Appearance", { exact: true }).selectOption("light");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(
    await page.evaluate(
      () => JSON.parse(sessionStorage.getItem("work-demo-v1")!).records,
    ),
  ).toEqual(before);
  await expect(
    page.getByRole("button", { name: /career starter/i }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Choose import files")).toHaveCount(0);
});

test("legacy aliases preserve selected context and retired records remain exportable", async ({
  page,
}) => {
  await openDemo(page, "/settings");
  const note = legacyNote();
  await page.evaluate((row) => {
    const state = JSON.parse(sessionStorage.getItem("work-demo-v1")!);
    state.records.push(row);
    state.records.push({
      ...row,
      id: "legacy-resume-file",
      kind: "asset",
      title: "Retired PDF résumé",
      data: { type: "resume" },
    });
    sessionStorage.setItem("work-demo-v1", JSON.stringify(state));
  }, note);
  await page.goto("/today");
  await expect(page).toHaveURL(/\/home$/);
  await page.goto("/assets");
  await expect(page).toHaveURL(/\/documents$/);
  await page.goto("/assets?record=legacy-resume-file");
  await expect(page).toHaveURL(/\/documents\?record=legacy-resume-file$/);
  await expect(
    page.getByRole("heading", { name: "Retired PDF résumé", exact: true }),
  ).toBeVisible();
  await page.goto("/practice?record=two-sum");
  await expect(page).toHaveURL(/\/learn\?view=roadmap&problem=two-sum$/);
  await page.goto("/focus");
  await expect(page).toHaveURL(/\/learn$/);
  await page.goto(`/notes?record=${note.id}`);
  await expect(page).toHaveURL(
    /\/settings\?legacy=notes&record=synthetic-retired-note#recovery$/,
  );
  await expect(page.locator(".legacy-recovery-note")).toContainText(note.title);
  await expect(page.getByLabel("Note content")).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download backup", exact: true })
    .first()
    .click();
  const downloaded = await download;
  const backup = JSON.parse(await readFile((await downloaded.path())!, "utf8"));
  expect(
    backup.records.find((row: WorkRecord) => row.id === note.id).body,
  ).toBe(note.body);
});

test("full backups restore goals and legacy files additively and repeated restores stay idempotent", async ({
  page,
}) => {
  await openDemo(page, "/settings");
  const note = legacyNote();
  await page.evaluate((row) => {
    const state = JSON.parse(sessionStorage.getItem("work-demo-v1")!);
    state.records.push(row);
    state.records.push({
      ...row,
      id: "backup-path",
      kind: "path",
      title: "Explore backend ownership",
      body: "Longer-term route",
      data: {},
    });
    if (state.goals.length) state.goals[0].directionId = "backup-path";
    state.records.push({
      ...row,
      id: "backup-application",
      kind: "application",
      title: "Backup interview role",
      body: "",
      data: {
        company: "Backup Company",
        applicationStatus: "Applied",
        recruitmentSteps: [
          {
            id: "backup-round",
            title: "Technical interview",
            kind: "interview",
            state: "Planned",
            date: "",
          },
          {
            id: "backup-archived-round",
            title: "Previous round",
            kind: "interview",
            state: "Cancelled",
            date: "",
            archived: true,
          },
        ],
      },
    });
    state.records.push({
      ...row,
      id: "backup-appointment",
      kind: "interview",
      title: "Backup appointment",
      body: "",
      links: ["backup-application"],
      data: {
        applicationId: "backup-application",
        stepId: "backup-archived-round",
        startsAt: "2030-12-01T09:00:00Z",
        timezone: "UTC",
        status: "Scheduled",
      },
    });
    state.records.push({
      ...row,
      id: "backup-preparation",
      kind: "note",
      title: "Backup round preparation",
      data: {
        category: "interview-preparation",
        applicationId: "backup-application",
        interviewId: "backup-appointment",
        storyIds: [],
      },
    });
    state.attachments.push({
      id: "synthetic-original-file",
      recordId: row.id,
      filename: "original-preparation.txt",
      contentType: "text/plain",
      size: 17,
      createdAt: row.createdAt,
    });
    state.files["synthetic-original-file"] = btoa("Original contents");
    sessionStorage.setItem("work-demo-v1", JSON.stringify(state));
  }, note);
  await page.reload();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download backup", exact: true })
    .click();
  const file = await download;
  const archive = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(archive.version).toBe(2);
  expect(
    archive.attachments.find(
      (row: { id: string }) => row.id === "synthetic-original-file",
    ).base64,
  ).toBe(Buffer.from("Original contents").toString("base64"));
  const restore = async () => {
    await page.getByLabel("Choose Work backup", { exact: true }).setInputFiles({
      name: "work-backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(archive)),
    });
    await page
      .getByRole("button", { name: "Restore backup", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Restore this backup?" })
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  };
  await restore();
  const restored = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("work-demo-v1")!),
  );
  expect(restored.records.length).toBe(archive.records.length * 2);
  expect(restored.goals.length).toBe(archive.goals.length * 2);
  expect(
    restored.records.some(
      (row: WorkRecord) => row.id === note.id && row.body === note.body,
    ),
  ).toBe(true);
  expect(restored.attachments.length).toBe(archive.attachments.length * 2);
  const copiedAppointment = restored.records.find(
    (record: WorkRecord) =>
      record.title === "Backup appointment" &&
      record.id !== "backup-appointment",
  );
  const copiedApplication = restored.records.find(
    (record: WorkRecord) => record.id === copiedAppointment.data.applicationId,
  );
  expect(copiedApplication.id).not.toBe("backup-application");
  expect(copiedAppointment.data.stepId).not.toBe("backup-archived-round");
  expect(
    copiedApplication.data.recruitmentSteps.some(
      (step: { id: string; archived: boolean }) =>
        step.id === copiedAppointment.data.stepId && step.archived,
    ),
  ).toBe(true);
  const copiedPreparation = restored.records.find(
    (record: WorkRecord) =>
      record.title === "Backup round preparation" &&
      record.id !== "backup-preparation",
  );
  expect(copiedPreparation.data).toMatchObject({
    applicationId: copiedApplication.id,
    interviewId: copiedAppointment.id,
  });
  if (archive.goals.length) {
    const copiedGoal = restored.goals.find(
      (goal: { id: string; title: string }) =>
        goal.title === archive.goals[0].title &&
        goal.id !== archive.goals[0].id,
    );
    expect(copiedGoal.directionId).not.toBe("backup-path");
    expect(
      restored.records.find(
        (record: WorkRecord) => record.id === copiedGoal.directionId,
      )?.title,
    ).toBe("Explore backend ownership");
  }
  const count = restored.records.length;
  await restore();
  expect(
    await page.evaluate(
      () => JSON.parse(sessionStorage.getItem("work-demo-v1")!).records.length,
    ),
  ).toBe(count);
  const versionOne = { ...archive, version: 1 };
  delete versionOne.goals;
  await page.getByLabel("Choose Work backup", { exact: true }).setInputFiles({
    name: "work-backup-v1.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(versionOne)),
  });
  await page
    .getByRole("button", { name: "Restore backup", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Restore this backup?" })
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const restoredLegacy = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("work-demo-v1")!),
  );
  expect(restoredLegacy.records.length).toBe(count + archive.records.length);
  expect(restoredLegacy.goals.length).toBe(restored.goals.length);
  await expect(
    page.getByText("Saved records and files", { exact: true }),
  ).toHaveCount(0);
  const restoredFiles = restoredLegacy.attachments.filter(
    (attachment: { filename: string }) =>
      attachment.filename === "original-preparation.txt",
  );
  expect(restoredFiles).toHaveLength(3);
  for (const attachment of restoredFiles)
    expect(restoredLegacy.files[attachment.id]).toBe(
      Buffer.from("Original contents").toString("base64"),
    );
});

test("device drafts survive reload, export, and retry while sign-out waits for sync", async ({
  page,
}) => {
  let offline = true;
  let signedOut = false;
  const account = {
    id: "synthetic-offline-account",
    name: "Synthetic Engineer",
    email: "synthetic@example.invalid",
  };
  let application: WorkRecord = {
    ...legacyNote(),
    id: "synthetic-application",
    kind: "application",
    title: "Synthetic Company — Engineer",
    body: "",
    links: ["preserved-link"],
    data: { company: "Synthetic Company", role: "Engineer", stage: "Saved" },
  };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === "/api/session")
      return route.fulfill({
        json: {
          user: signedOut ? null : account,
          configured: true,
          local: false,
        },
      });
    if (url.pathname === "/api/preferences")
      return route.fulfill({ json: { preferences: DEFAULT_PREFERENCES } });
    if (url.pathname === "/api/records")
      return route.fulfill({ json: { records: [application] } });
    if (url.pathname === "/api/connectors")
      return route.fulfill({ json: { connections: [] } });
    if (
      url.pathname === `/api/records/${application.id}` &&
      method === "PATCH"
    ) {
      if (offline) return route.abort("internetdisconnected");
      const patch = route.request().postDataJSON();
      delete patch.version;
      application = {
        ...application,
        ...patch,
        version: application.version + 1,
      };
      return route.fulfill({ json: { record: application } });
    }
    if (url.pathname === "/api/auth/sign-out") {
      signedOut = true;
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({
      status: 404,
      json: { error: "Unexpected test request" },
    });
  });
  await page.goto(`/applications?record=${application.id}`);
  await page
    .getByRole("button", { name: "Edit application", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Edit application",
    exact: true,
  });
  await editor.getByLabel("Status", { exact: true }).selectOption("Applied");
  await editor
    .getByRole("button", { name: "Save application", exact: true })
    .click();
  await expect(editor).not.toBeVisible();
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: /Device drafts/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.locator(".toast-error")).toContainText(/device drafts/i);
  expect(signedOut).toBe(false);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download device drafts", exact: true })
    .click();
  const archive = await download;
  const drafts = JSON.parse(await readFile((await archive.path())!, "utf8"));
  expect(drafts.drafts[0].patch.data.applicationStatus).toBe("Applied");
  expect(drafts.drafts[0].patch.links).toEqual(["preserved-link"]);
  offline = false;
  await page.getByRole("button", { name: "Retry sync", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /Device drafts/ }),
  ).toHaveCount(0);
  expect(application.data.applicationStatus).toBe("Applied");
  expect(application.data.stage).toBe("Saved");
  expect(application.links).toEqual(["preserved-link"]);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  expect(signedOut).toBe(true);
});
