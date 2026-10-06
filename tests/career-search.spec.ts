import { expect, test, type Page } from "@playwright/test";
import type { WorkRecord } from "../shared/model";
import { enterEditMode } from "./edit-mode-helper";

function samplePdf(): Buffer {
  const stream = "BT /F1 16 Tf 24 90 Td (PDF preview fixture) Tj ET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 140] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const crossReference = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${crossReference}\n%%EOF`;
  return Buffer.from(pdf, "ascii");
}

async function demoRecords(page: Page): Promise<WorkRecord[]> {
  return page.evaluate(
    () => JSON.parse(sessionStorage.getItem("work-demo-v1")!).records,
  );
}
async function chooseOption(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
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
  await form.getByRole("combobox", { name: "Status", exact: true }).click();
  await page.getByRole("option", { name: status, exact: true }).click();
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
  await enterEditMode(page, "Applications");
});

test("edit mode stays active when switching between application views", async ({
  page,
}) => {
  const editingStatus = page
    .getByRole("status")
    .filter({ hasText: "Editing Applications" });
  await expect(editingStatus).toBeVisible();
  await page.getByRole("tab", { name: /On your radar/ }).click();
  await expect(page).toHaveURL(/tab=radar/);
  await expect(editingStatus).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add company", exact: true }).first(),
  ).toBeVisible();

  await page.getByRole("tab", { name: /Applications/ }).click();
  await expect(page).not.toHaveURL(/tab=radar/);
  await expect(editingStatus).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New application", exact: true }).first(),
  ).toBeVisible();
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
  const detail = page.getByRole("dialog");
  await expect(
    detail.getByRole("heading", { name: "Documents", exact: true }),
  ).toHaveCount(0);
  await detail
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await enterEditMode(page, "Applications");
  await page.getByRole("link", { name: "E2E backend engineer" }).click();
  const role = detail.getByLabel("Role", { exact: true });
  await role.fill("Network engineer");
  await role.blur();
  await expect
    .poll(
      async () =>
        (await demoRecords(page)).find((item) => item.id === applicationId)
          ?.title,
    )
    .toBe("Network engineer");
  const applicationDate = detail.getByLabel("Application date", {
    exact: true,
  });
  await applicationDate.fill("2026-10-02");
  await applicationDate.blur();
  const deadline = detail.getByLabel("Deadline", { exact: true });
  await deadline.fill("2030-12-20");
  await deadline.blur();
  const followUp = detail.getByLabel("Follow-up", { exact: true });
  await followUp.fill("2030-12-21");
  await followUp.blur();
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
  await page
    .getByLabel("Search applications", { exact: true })
    .fill("engineer");
  await expect(page.locator(".application-table tbody tr")).toHaveCount(1);
  await page.getByLabel("Search applications", { exact: true }).fill("missing");
  await expect(
    page.getByText("No matching applications", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Search applications", { exact: true })
    .fill("engineer");
  await chooseOption(page, "Filter application status", "Applied");
  await chooseOption(page, "Sort applications", "Company A–Z");
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
  await enterEditMode(page, "Applications");
  await page
    .getByRole("button", { name: "Add company", exact: true })
    .first()
    .click();
  const companyCard = page.locator(".radar-card").last();
  await companyCard.getByLabel("Company", { exact: true }).fill("Radar Labs");
  await companyCard
    .getByLabel("Careers page", { exact: true })
    .fill("https://example.com/careers");
  await companyCard
    .getByLabel("Company notes", { exact: true })
    .fill("Useful developer infrastructure.");
  await expect
    .poll(async () =>
      (await demoRecords(page)).some(
        (item) => item.kind === "company" && item.title === "Radar Labs",
      ),
    )
    .toBe(true);
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
    await enterEditMode(page, "Applications");
  }
  await page.getByRole("button", { name: "Done editing", exact: true }).click();
  const radarCard = page.locator(".radar-card").last();
  await expect(radarCard.locator(".radar-title-row h3 a")).toHaveAttribute(
    "href",
    "https://example.com/careers",
  );
  await expect(
    radarCard.getByRole("link", { name: "Careers", exact: true }),
  ).toHaveAttribute("href", "https://example.com/careers");
  await enterEditMode(page, "Applications");
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
    .getByRole("button", { name: "Delete Technical interview", exact: true })
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

test("named uploaded PDFs preview in Work without canvas collisions", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/documents");
  await enterEditMode(page, "Documents");
  await page.getByRole("button", { name: "Add document", exact: true }).click();
  const otherDocuments = page
    .locator(".documents-page > section")
    .filter({ has: page.getByRole("heading", { name: "Other documents" }) });
  const form = otherDocuments.locator("form");
  await form.getByLabel("Name", { exact: true }).fill("Resume for Google");
  await form.getByLabel("Upload file", { exact: true }).setInputFiles({
    name: "resume-google.pdf",
    mimeType: "application/pdf",
    buffer: samplePdf(),
  });
  await form.getByRole("button", { name: "Add document", exact: true }).click();
  await expect(form).not.toBeVisible();
  const card = page
    .locator(".document-card")
    .filter({ hasText: "Resume for Google" });
  const preview = page.locator(".document-viewer-inline .latex-pdf-preview");
  await expect(preview.locator("canvas")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Resume for Google", exact: true }),
  ).toBeVisible();
  const actionHeights = await Promise.all(
    ["Download", "Delete Resume for Google", "Close document preview"].map(
      async (name) =>
        page
          .getByRole("button", { name, exact: true })
          .evaluate((button) => button.getBoundingClientRect().height),
    ),
  );
  expect(new Set(actionHeights)).toEqual(new Set([40]));
  const titleAndActions = await page
    .locator(".document-viewer-toolbar")
    .evaluate((toolbar) => {
      const title = toolbar.querySelector(".document-viewer-title")!;
      const actions = toolbar.querySelector(".inline-actions")!;
      const titleRect = title.getBoundingClientRect();
      const actionsRect = actions.getBoundingClientRect();
      return Math.abs(
        titleRect.top +
          titleRect.height / 2 -
          actionsRect.top -
          actionsRect.height / 2,
      );
    });
  expect(titleAndActions).toBeLessThan(8);
  for (const width of [1000, 680, 1280]) {
    await page.setViewportSize({ width, height: 820 });
    await page.waitForTimeout(250);
  }
  expect(
    pageErrors.some((message) =>
      message.includes(
        "Cannot use the same canvas during multiple render() operations",
      ),
    ),
  ).toBe(false);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const downloaded = await download;
  expect(downloaded.suggestedFilename()).toBe("resume-google.pdf");
  await page
    .getByRole("button", { name: "Close document preview", exact: true })
    .click();
  await expect(preview).toHaveCount(0);
  await expect(
    card.getByRole("button", { name: "Delete Resume for Google", exact: true }),
  ).toHaveCount(0);
  const openDocument = card.getByRole("button", {
    name: "Open document Resume for Google",
    exact: true,
  });
  const idleCardColor = await card.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await openDocument.hover();
  await expect
    .poll(() =>
      card.evaluate((element) => getComputedStyle(element).backgroundColor),
    )
    .not.toBe(idleCardColor);
  await openDocument.click();
  const deleteButton = page.getByRole("button", {
    name: "Delete Resume for Google",
    exact: true,
  });
  await expect(deleteButton).toBeVisible();
  await deleteButton.click();
  await page
    .getByRole("dialog", { name: "Delete Resume for Google?", exact: true })
    .getByRole("button", { name: "Delete document", exact: true })
    .click();
  await expect(
    page.locator(".document-card").filter({ hasText: "Resume for Google" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Recently deleted documents",
      exact: true,
    }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Add document", exact: true }).click();
  const textForm = otherDocuments.locator("form");
  await textForm
    .getByLabel("Name", { exact: true })
    .fill("Sample resume outline");
  await textForm.getByLabel("Upload file", { exact: true }).setInputFiles({
    name: "sample-resume.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      [
        "Resume outline",
        "Experience",
        "Software engineer",
        "Built a useful system",
        "Improved reliability",
        "Education",
        "Computer science",
        "Projects",
        "A small project",
        "Skills",
      ].join("\n"),
    ),
  });
  await textForm
    .getByRole("button", { name: "Add document", exact: true })
    .click();
  const textPreview = page.locator(
    ".document-viewer-inline .document-preview-text",
  );
  await expect(textPreview).toContainText("Resume outline");
  await expect
    .poll(() =>
      page
        .locator(".document-viewer-inline")
        .evaluate((viewer) => viewer.getBoundingClientRect().height),
    )
    .toBeLessThan(400);
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
