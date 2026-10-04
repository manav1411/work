import { expect, test, type Page } from "@playwright/test";
import type { WorkRecord } from "../shared/model";

async function demoRecords(page: Page): Promise<WorkRecord[]> {
  return page.evaluate(
    () =>
      JSON.parse(sessionStorage.getItem("work-demo-v1") || '{"records":[]}')
        .records,
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("work-demo-active", "true"),
  );
  await page.goto("/applications");
  await expect(
    page.getByRole("heading", { name: /^Applications/ }),
  ).toBeVisible();
});

test("Overleaf destinations replace authoring while preserving existing résumé content", async ({
  page,
}) => {
  await page.evaluate(() => {
    const state = JSON.parse(sessionStorage.getItem("work-demo-v1")!);
    state.records.push({
      id: "legacy-resume",
      kind: "asset",
      title: "Existing résumé",
      body: "Previously submitted résumé text.",
      tags: ["legacy"],
      links: [],
      data: {
        type: "resume",
        overleaf: "https://www.overleaf.com/project/oldproject",
        resume: { name: "Example Engineer" },
        primaryAttachmentId: "preserved-pdf",
      },
      version: 3,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      deletedAt: null,
    });
    sessionStorage.setItem("work-demo-v1", JSON.stringify(state));
  });
  await page.goto("/documents");
  await expect(page.getByRole("heading", { name: /^Documents/ })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open in Overleaf" }),
  ).toHaveAttribute("href", "https://www.overleaf.com/project/oldproject");
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await page.getByRole("button", { name: "Edit résumé link" }).click();
  const dialog = page.getByRole("dialog", { name: "Résumé link" });
  await dialog
    .getByLabel("Overleaf URL")
    .fill("https://www.overleaf.com/project/newproject");
  await dialog.getByRole("button", { name: "Save link" }).click();
  await expect(dialog).not.toBeVisible();
  const resume = (await demoRecords(page)).find(
    (item) => item.id === "legacy-resume",
  )!;
  expect(resume.body).toBe("Previously submitted résumé text.");
  expect(resume.data).toMatchObject({
    sourceUrl: "https://www.overleaf.com/project/newproject",
    resume: { name: "Example Engineer" },
    primaryAttachmentId: "preserved-pdf",
  });
  expect(resume.tags).toEqual(["legacy"]);
  await page.getByRole("button", { name: "Edit cover letter link" }).click();
  const letter = page.getByRole("dialog", { name: "Cover letter link" });
  await letter
    .getByLabel("Overleaf URL")
    .fill("https://example.com/not-overleaf");
  await letter.getByRole("button", { name: "Save link" }).click();
  await expect(letter.getByRole("alert")).toContainText("Overleaf");
  await letter
    .getByLabel("Overleaf URL")
    .fill("https://www.overleaf.com/read/letterproject");
  await letter.getByRole("button", { name: "Save link" }).click();
  await expect(letter).not.toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open in Overleaf" }),
  ).toHaveCount(2);
});

test("create a minimal application and maintain dates and document destinations without changing submitted snapshots", async ({
  page,
}) => {
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await page
    .getByRole("button", { name: "New application", exact: true })
    .first()
    .click();
  const create = page.getByRole("dialog", { name: "New application" });
  await expect(create.getByRole("textbox")).toHaveCount(3);
  await create.getByLabel("Company", { exact: true }).fill("Example Company");
  await create.getByLabel("Role", { exact: true }).fill("E2E backend engineer");
  await create.getByLabel("Stage", { exact: true }).selectOption("Applied");
  await create.getByLabel("Vacancy URL").fill("https://example.com/vacancy");
  await create
    .getByRole("button", { name: "Save application", exact: true })
    .click();
  await expect(create).not.toBeVisible();
  const applicationId = new URL(page.url()).searchParams.get("record")!;
  await page.evaluate((id) => {
    const state = JSON.parse(sessionStorage.getItem("work-demo-v1")!);
    const application = state.records.find(
      (item: WorkRecord) => item.id === id,
    );
    application.body = "Existing application detail retained for export.";
    application.data.assetVersions = [
      {
        assetId: "submitted-resume",
        version: 2,
        title: "Submitted résumé",
        label: "Submitted",
        body: "Exact submitted text",
        attachmentId: "submitted-pdf",
        capturedAt: "2026-01-01T00:00:00Z",
      },
    ];
    sessionStorage.setItem("work-demo-v1", JSON.stringify(state));
  }, applicationId);
  await page.reload();
  const detail = page.getByRole("dialog", { name: "E2E backend engineer" });
  await detail.getByRole("button", { name: "Edit application" }).click();
  const edit = page.getByRole("dialog", { name: "Edit application" });
  await edit.getByLabel("Deadline", { exact: true }).fill("2026-12-20");
  await edit.getByLabel("Follow-up", { exact: true }).fill("2026-12-21");
  await edit
    .getByLabel("Résumé URL")
    .fill("https://www.overleaf.com/project/applicationresume");
  await edit
    .getByLabel("Notion preparation URL")
    .fill("https://www.notion.so/preparation");
  await edit
    .getByLabel("Contact", { exact: true })
    .fill("Recruiter · recruiter@example.com");
  await edit.getByRole("button", { name: "Save application" }).click();
  await expect(edit).not.toBeVisible();
  await expect(
    detail.getByRole("link", { name: "Résumé", exact: true }),
  ).toHaveAttribute(
    "href",
    "https://www.overleaf.com/project/applicationresume",
  );
  await expect(
    detail.getByRole("link", { name: "Preparation in Notion" }),
  ).toBeVisible();
  const saved = (await demoRecords(page)).find(
    (item) => item.id === applicationId,
  )!;
  expect(saved.body).toBe("Existing application detail retained for export.");
  expect(saved.data).toMatchObject({
    company: "Example Company",
    stage: "Applied",
    deadline: "2026-12-20",
    followUp: "2026-12-21",
    assetVersions: [
      { body: "Exact submitted text", attachmentId: "submitted-pdf" },
    ],
  });
});

test("schedule and reschedule the same application interview with timezone and meeting details", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "New application", exact: true })
    .first()
    .click();
  const create = page.getByRole("dialog", { name: "New application" });
  await create.getByLabel("Company", { exact: true }).fill("Example Company");
  await create.getByLabel("Role", { exact: true }).fill("E2E interview role");
  await create.getByRole("button", { name: "Save application" }).click();
  await expect(create).not.toBeVisible();
  const applicationId = new URL(page.url()).searchParams.get("record")!;
  const detail = page.getByRole("dialog", { name: "E2E interview role" });
  await detail.getByRole("button", { name: "Schedule interview" }).click();
  const schedule = page.getByRole("dialog", { name: "Schedule interview" });
  await schedule.getByLabel("Date and local time").fill("2026-12-15T10:00");
  await schedule
    .getByLabel("Timezone", { exact: true })
    .fill("Australia/Melbourne");
  await schedule
    .getByLabel("Meeting URL")
    .fill("https://meet.example.com/technical");
  await schedule.getByRole("button", { name: "Save interview" }).click();
  await expect(schedule).not.toBeVisible();
  const first = (await demoRecords(page)).find(
    (item) => item.title === "E2E interview role — interview",
  )!;
  expect(first.links).toContain(applicationId);
  expect(first.data).toMatchObject({
    applicationId,
    startsAt: "2026-12-14T23:00:00.000Z",
    meetingUrl: "https://meet.example.com/technical",
  });
  await detail
    .getByRole("button", {
      name: "E2E interview role — interview",
      exact: true,
    })
    .click();
  const edit = page.getByRole("dialog", { name: "Edit interview" });
  await edit.getByLabel("Date and local time").fill("2026-12-16T11:00");
  await edit.getByRole("button", { name: "Save interview" }).click();
  await expect(edit).not.toBeVisible();
  const interviews = (await demoRecords(page)).filter(
    (item) => item.id === first.id,
  );
  expect(interviews).toHaveLength(1);
  expect(interviews[0].data.startsAt).toBe("2026-12-16T00:00:00.000Z");
  await detail
    .getByRole("button", {
      name: "E2E interview role — interview",
      exact: true,
    })
    .click();
  await edit.getByLabel("Status", { exact: true }).selectOption("Cancelled");
  await edit.getByRole("button", { name: "Save interview" }).click();
  await expect(edit).not.toBeVisible();
  expect(
    (await demoRecords(page)).find((item) => item.id === first.id)!.data.status,
  ).toBe("Cancelled");
});

test("standalone appointment links remain editable without inventing an application", async ({
  page,
}) => {
  await page.evaluate(() => {
    const state = JSON.parse(sessionStorage.getItem("work-demo-v1")!);
    state.records.push({
      id: "standalone-interview",
      kind: "interview",
      title: "Practice with a friend",
      body: "Existing notes preserved.",
      tags: [],
      links: [],
      data: {
        startsAt: "2026-12-01T09:00:00Z",
        timezone: "UTC",
        isMock: true,
        status: "Scheduled",
      },
      version: 1,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      deletedAt: null,
    });
    sessionStorage.setItem("work-demo-v1", JSON.stringify(state));
  });
  await page.goto("/applications?interview=standalone-interview");
  const edit = page.getByRole("dialog", { name: "Edit interview" });
  await expect(edit.getByLabel("Application", { exact: true })).toHaveValue("");
  await edit.getByLabel("Date and local time").fill("2026-12-02T09:00");
  await edit.getByRole("button", { name: "Save interview" }).click();
  await expect(edit).not.toBeVisible();
  const record = (await demoRecords(page)).find(
    (item) => item.id === "standalone-interview",
  )!;
  expect(record.body).toBe("Existing notes preserved.");
  expect(record.data).toMatchObject({
    applicationId: "",
    isMock: true,
    startsAt: "2026-12-02T09:00:00.000Z",
  });
});
