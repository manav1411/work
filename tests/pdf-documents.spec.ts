import { expect, test, type Page } from "@playwright/test";
import {
  DEFAULT_PREFERENCES,
  type Attachment,
  type WorkRecord,
} from "../shared/model";
import { enterEditMode } from "./edit-mode-helper";

function samplePdf() {
  const text = "BT /F1 18 Tf 36 240 Td (Uploaded PDF text) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

async function expectShellLayout(page: Page, top: number) {
  await expect(page.locator("#primary-sidebar")).toHaveCSS("position", "fixed");
  await expect
    .poll(() =>
      page
        .locator("#main-content")
        .evaluate(
          (element) => element.getBoundingClientRect().top + window.scrollY,
        ),
    )
    .toBe(top);
}

test("uploaded PDFs keep the page layout stable across previews, reloads and navigation", async ({
  page,
}) => {
  const pdf = samplePdf();
  const records: WorkRecord[] = [];
  const attachment: Attachment = {
    id: "uploaded-pdf",
    recordId: "pdf-document",
    filename: "sample.pdf",
    contentType: "application/pdf",
    size: pdf.length,
    createdAt: new Date().toISOString(),
  };
  let uploaded = false;
  await page.addInitScript(() => sessionStorage.removeItem("work-demo-active"));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path === "/api/session")
      return route.fulfill({
        json: {
          user: {
            id: "pdf-layout-owner",
            name: "Synthetic",
            email: "synthetic@example.invalid",
          },
          local: false,
          configured: true,
        },
      });
    if (path === "/api/preferences")
      return route.fulfill({ json: { preferences: DEFAULT_PREFERENCES } });
    if (path === "/api/records" && method === "POST") {
      const record: WorkRecord = {
        body: "",
        tags: [],
        links: [],
        ...route.request().postDataJSON(),
        id: attachment.recordId,
        version: 1,
        createdAt: attachment.createdAt,
        updatedAt: attachment.createdAt,
        deletedAt: null,
      };
      records.push(record);
      return route.fulfill({ json: { record } });
    }
    if (path === "/api/records") return route.fulfill({ json: { records } });
    if (path === `/api/records/${attachment.recordId}`) {
      if (method === "PATCH") {
        Object.assign(records[0], route.request().postDataJSON());
        records[0].version++;
      }
      return route.fulfill({ json: { record: records[0] } });
    }
    if (path === `/api/records/${attachment.recordId}/attachments`) {
      if (method === "POST") {
        uploaded = true;
        return route.fulfill({ json: { attachment } });
      }
      return route.fulfill({
        json: { attachments: uploaded ? [attachment] : [] },
      });
    }
    if (path === `/api/attachments/${attachment.id}`)
      return route.fulfill({ contentType: "application/pdf", body: pdf });
    return route.fulfill({ json: { records: [] } });
  });

  await page.goto("/documents");
  await enterEditMode(page, "Documents");
  const top = await page
    .locator("#main-content")
    .evaluate(
      (element) => element.getBoundingClientRect().top + window.scrollY,
    );
  await page.getByRole("button", { name: "Add document", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("PDF layout fixture");
  await page.getByLabel("Upload file").setInputFiles({
    name: attachment.filename,
    mimeType: attachment.contentType,
    buffer: pdf,
  });
  await page
    .locator("form")
    .getByRole("button", { name: "Add document", exact: true })
    .click();
  const viewer = page.locator(".document-viewer .textLayer");
  await expect(viewer).toContainText("Uploaded PDF text");
  await expectShellLayout(page, top);
  // Text remains selectable and aligned over the rendered PDF canvas.
  await expect(viewer.locator("span").first()).toHaveCSS(
    "position",
    "absolute",
  );
  await expect(viewer.locator("span").first()).toHaveCSS("user-select", "text");
  await expect(viewer.locator("span").first()).toHaveCSS(
    "color",
    "rgba(0, 0, 0, 0)",
  );
  await expect
    .poll(() =>
      viewer
        .locator("span")
        .first()
        .evaluate((span) => Number.parseFloat(getComputedStyle(span).fontSize)),
    )
    .toBeGreaterThan(0);
  await page.reload();
  await expect(viewer).toContainText("Uploaded PDF text");
  await expectShellLayout(page, top);

  await page.getByRole("button", { name: "Close document preview" }).click();
  const thumbnail = page.locator(".document-thumbnail .textLayer");
  await expect(thumbnail).toContainText("Uploaded PDF text");
  await expectShellLayout(page, top);
  await page.reload();
  await expect(thumbnail).toContainText("Uploaded PDF text");
  await expectShellLayout(page, top);

  await page
    .locator(".sidebar")
    .getByRole("link", { name: "Applications", exact: true })
    .click();
  await expect(page).toHaveURL(/\/applications$/);
  await expectShellLayout(page, top);
  await page.reload();
  await expectShellLayout(page, top);
  await page
    .locator(".sidebar")
    .getByRole("link", { name: "Documents", exact: true })
    .click();
  await expect(thumbnail).toContainText("Uploaded PDF text");
  await expectShellLayout(page, top);
});
