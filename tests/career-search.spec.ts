import { expect, test, type Page } from "@playwright/test";
import type { WorkRecord } from "../shared/model";

async function demoRecords(page: Page): Promise<WorkRecord[]> {
  return page.evaluate(
    () =>
      JSON.parse(sessionStorage.getItem("work-demo-v1") || '{"records":[]}')
        .records,
  );
}

function syntheticPDF(text: string): Buffer {
  const stream = `BT /F1 12 Tf 10 100 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

test.beforeEach(async ({ page }) => {
  // Every browser context gets an isolated, explicitly labelled preview workspace.
  await page.addInitScript(() =>
    sessionStorage.setItem("work-demo-active", "true"),
  );
  await page.goto("/today");
  await expect(
    page.getByText(
      "Preview workspace. Sample records and edits stay in this tab.",
    ),
  ).toBeVisible();
});

test("tailor a structured résumé, preserve its submitted version, and prepare a linked interview", async ({
  page,
}) => {
  await page.goto("/assets");
  await page.getByRole("button", { name: /Create a career asset/ }).click();
  const assetDialog = page.getByRole("dialog", {
    name: "Create a career asset",
  });
  await assetDialog.getByLabel("Asset title").fill("E2E résumé — backend");
  await assetDialog.getByLabel("Name").fill("Example Engineer");
  await assetDialog.getByLabel("Version label").fill("Submitted version");
  await assetDialog
    .getByRole("button", { name: "+ Add role", exact: true })
    .click();
  await assetDialog.getByLabel("Role title").fill("Software engineer");
  await assetDialog.getByLabel("Organisation / context").fill("Example team");
  await assetDialog.getByLabel("Bullets").fill("Built a tested endpoint.");
  await assetDialog
    .getByRole("button", { name: "Save career asset", exact: true })
    .click();
  await expect(assetDialog).not.toBeVisible();
  const assetId = new URL(page.url()).searchParams.get("record")!;

  await page.goto("/applications");
  await page.getByRole("button", { name: /Capture an opportunity/ }).click();
  const applicationDialog = page.getByRole("dialog", {
    name: "Capture a real opportunity",
  });
  await applicationDialog
    .getByLabel("Role title")
    .fill("E2E software engineer opportunity");
  await applicationDialog
    .getByLabel("Company", { exact: true })
    .selectOption({ label: "Google" });
  await applicationDialog
    .getByLabel("Location / working arrangement")
    .fill("Melbourne");
  await applicationDialog
    .getByLabel("Vacancy URL")
    .fill("https://example.com/test-vacancy");
  await applicationDialog
    .getByLabel("Job description snapshot & notes")
    .fill(
      "Synthetic test vacancy. Build backend services and explain tradeoffs.",
    );
  await applicationDialog.getByLabel("Stage").selectOption("Applied");
  await applicationDialog.getByLabel("Date-only deadline").fill("2026-12-20");
  await applicationDialog
    .getByLabel("Next action")
    .fill("Prepare one engineering example");
  await applicationDialog
    .getByRole("group", { name: "Exact résumé / letter / answer versions" })
    .getByRole("checkbox", { name: /E2E résumé — backend/ })
    .check();
  await applicationDialog
    .getByRole("button", { name: "Save opportunity", exact: true })
    .click();
  await expect(applicationDialog).not.toBeVisible();
  const applicationId = new URL(page.url()).searchParams.get("record")!;

  await page.goto(`/assets?record=${assetId}`);
  await page.getByRole("button", { name: "Edit asset", exact: true }).click();
  const editAssetDialog = page.getByRole("dialog", {
    name: "Edit career asset",
  });
  await editAssetDialog.getByLabel("Version label").fill("Later version");
  await editAssetDialog
    .getByLabel("Bullets")
    .fill("Later résumé text that was not submitted.");
  await editAssetDialog
    .getByRole("button", { name: "Save career asset", exact: true })
    .click();
  await expect(editAssetDialog).not.toBeVisible();
  const application = (await demoRecords(page)).find(
    (record) => record.id === applicationId,
  )!;
  expect(application.data.assetVersions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        assetId,
        label: "Submitted version",
        body: expect.stringContaining("Built a tested endpoint."),
      }),
    ]),
  );
  expect(JSON.stringify(application.data.assetVersions)).not.toContain(
    "Later résumé text",
  );
  expect(application.data.deadline).toBe("2026-12-20");
  expect(application.data.history).toEqual(
    expect.arrayContaining([expect.objectContaining({ stage: "Applied" })]),
  );
  expect(application.data.submittedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  await page.goto(`/applications?record=${applicationId}`);
  await page
    .getByRole("link", { name: "Schedule interview ↗", exact: true })
    .click();
  const interviewDialog = page.getByRole("dialog", {
    name: "Schedule interview",
  });
  await expect(interviewDialog).toBeVisible();
  await interviewDialog
    .getByLabel("Interview title")
    .fill("E2E linked coding interview");
  await interviewDialog
    .getByLabel("Date and local time")
    .fill("2026-12-15T10:00");
  await interviewDialog
    .getByRole("button", { name: "Save interview", exact: true })
    .click();
  await expect(interviewDialog).not.toBeVisible();
  await expect(
    page.getByText("Your preparation view", { exact: true }),
  ).toBeVisible();
  const interview = (await demoRecords(page)).find(
    (record) => record.title === "E2E linked coding interview",
  )!;
  expect(interview.links).toContain(applicationId);
  expect(interview.data.startsAt).toBe("2026-12-14T23:00:00.000Z");
});

test("reuse one verified contribution in both a behavioural story and résumé bullet", async ({
  page,
}) => {
  await page.goto("/evidence");
  await page.getByRole("button", { name: /Capture an achievement/ }).click();
  const dialog = page.getByRole("dialog", { name: "Capture an achievement" });
  await dialog.getByLabel("What changed?").fill("E2E debugging evidence");
  await dialog
    .getByLabel("Your contribution")
    .fill("Added request tracing and a reproducible test.");
  await dialog
    .getByLabel("Actual outcome / impact")
    .fill("The failure could be reproduced reliably.");
  await dialog
    .getByLabel("I have checked these claims against the evidence.")
    .check();
  await dialog
    .getByRole("button", { name: "Save evidence", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const evidenceId = new URL(page.url()).searchParams.get("record")!;
  await page
    .getByRole("button", { name: "Create a behavioural story", exact: true })
    .click();
  await expect(page).toHaveURL(/\/interviews\?record=/);
  let records = await demoRecords(page);
  const story = records.find(
    (record) =>
      record.kind === "story" && record.title === "E2E debugging evidence",
  )!;
  expect(story.links).toContain(evidenceId);
  expect(story.data.action).toBe(
    "Added request tracing and a reproducible test.",
  );
  expect(story.data.result).toBe("The failure could be reproduced reliably.");
  await page.goto(`/evidence?record=${evidenceId}`);
  await page
    .getByRole("button", { name: "Create a résumé bullet", exact: true })
    .click();
  await expect(page).toHaveURL(/\/assets\?record=/);
  records = await demoRecords(page);
  const bullet = records.find(
    (record) =>
      record.kind === "asset" &&
      record.title === "E2E debugging evidence — résumé bullet",
  )!;
  expect(bullet.links).toContain(evidenceId);
  expect(bullet.data.verified).toBe(true);
  expect(bullet.body).toBe(
    "Added request tracing and a reproducible test. The failure could be reproduced reliably.",
  );
});

test("complete a project milestone and create a linked case-study note", async ({
  page,
}) => {
  await page.goto("/projects");
  await page.getByRole("button", { name: /Create a project/ }).click();
  const dialog = page.getByRole("dialog", { name: "Plan a project" });
  await dialog.getByLabel("Project name").fill("E2E small engineering project");
  await dialog
    .getByLabel("Scope / problem to solve")
    .fill("A synthetic example of a small, testable feature.");
  await dialog
    .getByLabel("Milestones")
    .fill("Build the smallest useful version\nExplain one tradeoff");
  await dialog
    .getByRole("button", { name: "Use template", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Save project", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const projectId = new URL(page.url()).searchParams.get("record")!;
  await page
    .getByRole("checkbox", {
      name: "Build the smallest useful version",
      exact: true,
    })
    .check();
  await expect
    .poll(async () => {
      const project = (await demoRecords(page)).find(
        (record) => record.id === projectId,
      )!;
      return (project.data.milestones as { text: string; done: boolean }[])[0]
        .done;
    })
    .toBe(true);
  await page
    .getByRole("button", { name: "Create a case-study note", exact: true })
    .click();
  await expect(page).toHaveURL(/\/notes\?record=/);
  const note = (await demoRecords(page)).find(
    (record) => record.title === "E2E small engineering project — case study",
  )!;
  expect(note.links).toContain(projectId);
  expect(note.body).toContain("## Engineering decision");
});

test("save a weekly review and explicitly turn a priority into a next-week action", async ({
  page,
}) => {
  await page.goto("/review");
  await page.getByRole("button", { name: /Write a weekly review/ }).click();
  const dialog = page.getByRole("dialog", { name: "A small weekly reset" });
  await dialog.getByLabel("Review title").fill("E2E weekly reset");
  await dialog
    .getByLabel("What meaningful work did you complete?")
    .fill("Captured useful engineering evidence.");
  await dialog
    .getByLabel("What was difficult to start?")
    .fill("The task was too vague. Start with one sentence.");
  await dialog
    .getByLabel("What are next week’s priorities?")
    .fill("E2E explain a backend tradeoff");
  await dialog
    .getByRole("button", { name: "Save review", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const reviewId = new URL(page.url()).searchParams.get("record")!;
  await page
    .getByRole("button", { name: "Make a next-week action", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Action created", exact: true }),
  ).toBeDisabled();
  const action = (await demoRecords(page)).find(
    (record) =>
      record.kind === "action" &&
      record.title === "E2E explain a backend tradeoff",
  )!;
  expect(action.links).toContain(reviewId);
  expect(action.data.status).toBe("todo");
  expect(action.data.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await page.goto("/today");
  await expect(
    page.getByText("E2E explain a backend tradeoff", { exact: true }).first(),
  ).toBeVisible();
});

test("keep career comparison terms and ratings unknown until explicitly supplied", async ({
  page,
}) => {
  await page.goto("/career");
  await page.getByRole("button", { name: /Create a decision/ }).click();
  const dialog = page.getByRole("dialog", { name: "Create a decision" });
  await dialog.getByLabel("Title").fill("E2E real options comparison");
  await dialog
    .getByRole("button", { name: "+ Add an option", exact: true })
    .click();
  await dialog
    .getByLabel("Option / role name")
    .fill("Potential role to research");
  await dialog
    .getByRole("button", { name: "Save worksheet", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const decision = (await demoRecords(page)).find(
    (record) => record.title === "E2E real options comparison",
  )!;
  expect(decision.data.options).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        title: "Potential role to research",
        base: "",
        currency: "",
        confirmation: "Unknown",
        nonNegotiables: "Unknown",
        scores: {},
      }),
    ]),
  );
  await expect(
    page.getByText("Incomplete ratings", { exact: true }),
  ).toBeVisible();
});

test("retain the exact submitted PDF after uploading a newer résumé export", async ({
  page,
}) => {
  await page.goto("/assets");
  await page.getByRole("button", { name: /Create a career asset/ }).click();
  const dialog = page.getByRole("dialog", { name: "Create a career asset" });
  await dialog.getByLabel("Asset title").fill("E2E PDF résumé");
  await dialog
    .getByRole("button", { name: "Save career asset", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const assetId = new URL(page.url()).searchParams.get("record")!;
  await page
    .locator(".asset-upload-label input")
    .setInputFiles({
      name: "submitted.pdf",
      mimeType: "application/pdf",
      buffer: syntheticPDF("Submitted version"),
    });
  await expect(page.getByText("submitted.pdf", { exact: true })).toBeVisible();
  const firstPDF = (await demoRecords(page)).find(
    (record) => record.id === assetId,
  )!.data.primaryAttachmentId;
  expect(firstPDF).toBeTruthy();
  await page.goto("/applications");
  await page.getByRole("button", { name: /Capture an opportunity/ }).click();
  const applicationDialog = page.getByRole("dialog", {
    name: "Capture a real opportunity",
  });
  await applicationDialog.getByLabel("Role title").fill("E2E PDF submission");
  await applicationDialog
    .getByRole("group", { name: "Exact résumé / letter / answer versions" })
    .getByRole("checkbox", { name: /E2E PDF résumé/ })
    .check();
  await applicationDialog
    .getByRole("button", { name: "Save opportunity", exact: true })
    .click();
  await expect(applicationDialog).not.toBeVisible();
  const applicationId = new URL(page.url()).searchParams.get("record")!;
  await page.goto(`/assets?record=${assetId}`);
  await page
    .locator(".asset-upload-label input")
    .setInputFiles({
      name: "newer.pdf",
      mimeType: "application/pdf",
      buffer: syntheticPDF("Later version"),
    });
  await expect(page.getByText("newer.pdf", { exact: true })).toBeVisible();
  const records = await demoRecords(page);
  expect(
    records.find((record) => record.id === assetId)!.data.primaryAttachmentId,
  ).not.toBe(firstPDF);
  expect(
    records.find((record) => record.id === applicationId)!.data.assetVersions,
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        attachmentId: firstPDF,
        attachmentName: "submitted.pdf",
      }),
    ]),
  );
  const submittedRow = page
    .locator(".asset-file")
    .filter({ hasText: "submitted.pdf" });
  await expect(
    submittedRow.getByRole("button", { name: "Remove", exact: true }),
  ).toBeDisabled();
  await expect(submittedRow).toContainText("Preserved for 1 application");
});
