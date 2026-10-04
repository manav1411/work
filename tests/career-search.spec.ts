import { expect, test, type Page } from "@playwright/test";
import type { WorkRecord } from "../shared/model";

async function demoRecords(page: Page): Promise<WorkRecord[]> {
  return page.evaluate(
    () => JSON.parse(sessionStorage.getItem("work-demo-v1")!).records,
  );
}
async function createApplication(
  page: Page,
  role = "Backend engineer",
  status = "Saved",
) {
  await page
    .getByRole("button", { name: "New application", exact: true })
    .first()
    .click();
  const form = page.getByRole("dialog", {
    name: "New application",
    exact: true,
  });
  await form.getByLabel("Company", { exact: true }).fill("Example Company");
  await form.getByLabel("Role", { exact: true }).fill(role);
  await form.getByLabel("Status", { exact: true }).selectOption(status);
  await form
    .getByLabel("Listing link", { exact: true })
    .fill("https://example.com/vacancy");
  await form.getByLabel("Location", { exact: true }).fill("Melbourne · hybrid");
  await form
    .getByLabel("Notes", { exact: true })
    .fill("Ask about the backend platform team.");
  await form
    .getByRole("button", { name: "Save application", exact: true })
    .click();
  await expect(form).not.toBeVisible();
  return new URL(page.url()).searchParams.get("record")!;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("work-demo-active", "true"),
  );
  await page.goto("/applications");
  await expect(
    page.getByRole("heading", { name: /^Applications/ }),
  ).toBeVisible();
  await page.evaluate(() => {
    const state = JSON.parse(sessionStorage.getItem("work-demo-v1")!);
    state.records = [];
    state.goals = [];
    state.attachments = [];
    state.files = {};
    sessionStorage.setItem("work-demo-v1", JSON.stringify(state));
  });
  await page.reload();
});

test("tracker replaces spreadsheet fields, supports search/filter, and preserves submitted snapshots", async ({
  page,
}) => {
  const applicationId = await createApplication(
    page,
    "E2E backend engineer",
    "Applied",
  );
  await page.evaluate((id) => {
    const state = JSON.parse(sessionStorage.getItem("work-demo-v1")!);
    const application = state.records.find(
      (item: WorkRecord) => item.id === id,
    );
    application.data.stage = "Interview";
    application.data.history = [
      { stage: "Interview", previous: "Applied", at: "2026-10-01T00:00:00Z" },
    ];
    application.data.assetVersions = [
      {
        assetId: "submitted-resume",
        version: 2,
        body: "Exact submitted text",
        attachmentId: "submitted-pdf",
      },
    ];
    sessionStorage.setItem("work-demo-v1", JSON.stringify(state));
  }, applicationId);
  await page.reload();
  const detail = page.getByRole("dialog", {
    name: "E2E backend engineer",
    exact: true,
  });
  await expect(
    detail.getByRole("heading", { name: "Documents", exact: true }),
  ).toHaveCount(0);
  await detail
    .getByRole("button", { name: "Edit application", exact: true })
    .click();
  const edit = page.getByRole("dialog", {
    name: "Edit application",
    exact: true,
  });
  await edit.getByLabel("Application date", { exact: true }).fill("2026-10-02");
  await edit.getByLabel("Deadline", { exact: true }).fill("2030-12-20");
  await edit.getByLabel("Follow-up", { exact: true }).fill("2030-12-21");
  await edit
    .getByLabel("Contact", { exact: true })
    .fill("Recruiter · recruiter@example.com");
  await edit
    .getByRole("button", { name: "Save application", exact: true })
    .click();
  await expect(edit).not.toBeVisible();
  const saved = (await demoRecords(page)).find(
    (item) => item.id === applicationId,
  )!;
  expect(saved.data).toMatchObject({
    company: "Example Company",
    applicationStatus: "Applied",
    applicationDate: "2026-10-02",
    location: "Melbourne · hybrid",
    stage: "Interview",
    history: [{ stage: "Interview" }],
    assetVersions: [
      { body: "Exact submitted text", attachmentId: "submitted-pdf" },
    ],
  });
  await detail
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(page.getByRole("columnheader")).toHaveText([
    "Company",
    "Role",
    "Listing link",
    "Status",
    "Application date",
    "Location",
    "Notes",
  ]);
  await page.getByLabel("Search applications", { exact: true }).fill("backend");
  await expect(page.locator(".application-table tbody tr")).toHaveCount(1);
  await page.getByLabel("Filter application status").selectOption("Rejected");
  await expect(
    page.getByText("No matching applications", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Filter application status").selectOption("Applied");
  await page.getByLabel("Sort applications").selectOption("company");
  await expect(page.locator(".application-table tbody tr")).toContainText(
    "Melbourne · hybrid",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".application-mobile-cards")).toContainText(
    "Ask about the backend platform team.",
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});

test("radar company can create multiple applications and deletion retains company names", async ({
  page,
}) => {
  await page.getByRole("tab", { name: /On your radar/ }).click();
  await page
    .getByRole("button", { name: "Add company", exact: true })
    .first()
    .click();
  const form = page.getByRole("dialog", {
    name: "Add radar company",
    exact: true,
  });
  await form.getByLabel("Company name", { exact: true }).fill("Radar Labs");
  await form
    .getByLabel("Careers link", { exact: true })
    .fill("https://example.com/careers");
  await form
    .getByLabel("Why it interests you", { exact: true })
    .fill("Useful developer infrastructure.");
  await form.getByRole("button", { name: "Save company", exact: true }).click();
  const company = (await demoRecords(page)).find(
    (item) => item.kind === "company",
  )!;
  for (const role of ["Platform engineer", "Backend engineer"]) {
    await page
      .getByRole("button", { name: "Add application", exact: true })
      .click();
    const application = page.getByRole("dialog", {
      name: "New application",
      exact: true,
    });
    await expect(
      application.getByLabel("Company", { exact: true }),
    ).toHaveValue("Radar Labs");
    await application.getByLabel("Role", { exact: true }).fill(role);
    await application
      .getByRole("button", { name: "Save application", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: role, exact: true })
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await page.getByRole("tab", { name: /On your radar/ }).click();
  }
  await page
    .getByRole("button", { name: "Delete Radar Labs", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Delete radar company?", exact: true })
    .getByRole("button", { name: "Delete Radar Labs", exact: true })
    .click();
  let applications = (await demoRecords(page)).filter(
    (item) => item.kind === "application",
  );
  expect(applications).toHaveLength(2);
  expect(
    applications.every(
      (item) => item.data.company === "Radar Labs" && !item.deletedAt,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(
    (await demoRecords(page)).find((item) => item.id === company.id)?.deletedAt,
  ).toBeNull();
  applications = (await demoRecords(page)).filter(
    (item) => item.kind === "application",
  );
  expect(applications).toHaveLength(2);
});

test("custom process keeps multiple appointments separate and preserves prep when a step is removed", async ({
  page,
}) => {
  const applicationId = await createApplication(
    page,
    "Interview role",
    "Applied",
  );
  const detail = page.getByRole("dialog", {
    name: "Interview role",
    exact: true,
  });
  await detail
    .getByRole("button", { name: "Edit process", exact: true })
    .click();
  let process = page.getByRole("dialog", {
    name: "Recruitment process",
    exact: true,
  });
  await process
    .getByRole("button", { name: "Start with a common process", exact: true })
    .click();
  const tech = process.locator(".process-editor-step").filter({
    has: page
      .getByLabel("Step name", { exact: true })
      .and(page.locator('input[value="Technical interview"]')),
  });
  // Editing a title through an empty draft must not remove its step.
  await process.getByLabel("Step name", { exact: true }).nth(3).fill("");
  await expect(process.locator(".process-editor-step")).toHaveCount(5);
  await process
    .getByLabel("Step name", { exact: true })
    .nth(3)
    .fill("Technical interview");
  await tech
    .getByRole("button", {
      name: "Move Technical interview earlier",
      exact: true,
    })
    .click();
  await process
    .getByRole("button", { name: "Save process", exact: true })
    .click();
  const app = (await demoRecords(page)).find(
    (item) => item.id === applicationId,
  )!;
  const steps = app.data.recruitmentSteps as {
    id: string;
    title: string;
    state: string;
    archived?: boolean;
  }[];
  const stepId = steps.find((step) => step.title === "Technical interview")!.id;
  expect(steps.map((step) => step.title)).toEqual([
    "Application",
    "Online assessment",
    "Technical interview",
    "Behavioural interview",
    "Offer",
  ]);
  for (const [title, time] of [
    ["Technical conversation", "2030-12-15T10:00"],
    ["Follow-up conversation", "2030-12-16T11:00"],
  ]) {
    await detail
      .locator(".recruitment-step")
      .filter({ hasText: "Technical interview" })
      .getByRole("button", { name: "Schedule appointment", exact: true })
      .click();
    const schedule = page.getByRole("dialog", {
      name: "Schedule interview",
      exact: true,
    });
    await schedule.getByLabel("Date and local time").fill(time);
    await schedule
      .getByLabel("Timezone", { exact: true })
      .fill("Australia/Melbourne");
    await schedule.getByText("Details", { exact: true }).click();
    await schedule.getByLabel("Interview title", { exact: true }).fill(title);
    await schedule
      .getByRole("button", { name: "Save interview", exact: true })
      .click();
    await expect(schedule).not.toBeVisible();
  }
  const interviews = (await demoRecords(page)).filter(
    (item) => item.kind === "interview",
  );
  expect(interviews).toHaveLength(2);
  expect(
    interviews.every(
      (item) =>
        item.data.applicationId === applicationId &&
        item.data.stepId === stepId,
    ),
  ).toBe(true);
  expect(interviews[0].data.startsAt).toBe("2030-12-14T23:00:00.000Z");
  await detail
    .getByRole("button", { name: "Technical conversation", exact: true })
    .click();
  const edit = page.getByRole("dialog", {
    name: "Edit interview",
    exact: true,
  });
  await edit.getByLabel("Date and local time").fill("2030-12-15T12:00");
  await edit.getByLabel("Status", { exact: true }).selectOption("Completed");
  await edit
    .getByRole("button", { name: "Save interview", exact: true })
    .click();
  let updated = (await demoRecords(page)).find(
    (item) => item.id === applicationId,
  )!;
  expect(updated.data.applicationStatus).toBe("Applied");
  expect(
    (updated.data.recruitmentSteps as typeof steps).find(
      (step) => step.id === stepId,
    )!.state,
  ).toBe("Planned");
  await detail
    .getByRole("button", { name: "Edit process", exact: true })
    .click();
  process = page.getByRole("dialog", {
    name: "Recruitment process",
    exact: true,
  });
  await process
    .getByRole("button", { name: "Remove Technical interview", exact: true })
    .click();
  await process
    .getByRole("button", { name: "Save process", exact: true })
    .click();
  updated = (await demoRecords(page)).find(
    (item) => item.id === applicationId,
  )!;
  expect(
    (updated.data.recruitmentSteps as typeof steps).find(
      (step) => step.id === stepId,
    )?.archived,
  ).toBe(true);
  await detail
    .getByRole("link", { name: "Prepare", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/interviews\?interview=/);
  await expect(
    page.getByRole("heading", { name: "Technical conversation", exact: true }),
  ).toBeVisible();
  expect(
    (await demoRecords(page)).filter((item) => item.kind === "interview"),
  ).toHaveLength(2);
});

test("named uploaded documents open inside Work and preserve previous uploaded copies", async ({
  page,
}) => {
  await page.goto("/documents");
  await page.getByRole("button", { name: "Add document", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Add document", exact: true });
  await form
    .getByLabel("Document name", { exact: true })
    .fill("Resume for Google");
  await form
    .getByLabel("Upload a file (optional)", { exact: true })
    .setInputFiles({
      name: "resume-google.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\nSynthetic document\n%%EOF"),
    });
  await form
    .getByRole("button", { name: "Save document", exact: true })
    .click();
  await expect(form).not.toBeVisible();
  const card = page
    .locator(".document-card")
    .filter({ hasText: "Resume for Google" });
  await card
    .getByRole("button", { name: "Open document", exact: true })
    .click();
  await expect(
    page.locator('iframe[title="Uploaded copy of Resume for Google"]'),
  ).toHaveAttribute("src", /^blob:/);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const downloaded = await download;
  expect(downloaded.suggestedFilename()).toBe("resume-google.pdf");
  await page
    .getByRole("button", { name: "Edit document", exact: true })
    .click();
  const edit = page.getByRole("dialog", { name: "Edit document", exact: true });
  await edit
    .getByLabel("Document name", { exact: true })
    .fill("Google resume v2");
  await edit
    .getByLabel("Replace uploaded copy (optional)", { exact: true })
    .setInputFiles({
      name: "resume-google-v2.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\nSynthetic second copy\n%%EOF"),
    });
  await edit
    .getByRole("button", { name: "Save document", exact: true })
    .click();
  await expect(edit).not.toBeVisible();
  await expect(
    page.locator('iframe[title="Uploaded copy of Google resume v2"]'),
  ).toBeVisible();
  const state = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("work-demo-v1")!),
  );
  expect(state.attachments).toHaveLength(2);
  expect(Object.keys(state.files)).toHaveLength(2);
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete Google resume v2", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Delete Google resume v2?", exact: true })
    .getByRole("button", { name: "Delete document", exact: true })
    .click();
  await expect(
    page.locator(".document-card").filter({ hasText: "Google resume v2" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Recently deleted documents", exact: true })
    .click();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(
    page.locator(".document-card").filter({ hasText: "Google resume v2" }),
  ).toBeVisible();
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
        startsAt: "2030-12-01T09:00:00Z",
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
  const edit = page.getByRole("dialog", {
    name: "Edit interview",
    exact: true,
  });
  await expect(edit.getByLabel("Application", { exact: true })).toHaveValue("");
  await edit.getByLabel("Date and local time").fill("2030-12-02T09:00");
  await edit
    .getByRole("button", { name: "Save interview", exact: true })
    .click();
  await expect(edit).not.toBeVisible();
  const record = (await demoRecords(page)).find(
    (item) => item.id === "standalone-interview",
  )!;
  expect(record.body).toBe("Existing notes preserved.");
  expect(record.data).toMatchObject({
    applicationId: "",
    isMock: true,
    startsAt: "2030-12-02T09:00:00.000Z",
  });
});
