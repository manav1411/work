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
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
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
  test.setTimeout(60_000);
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
      };
      records.push(record);
      return route.fulfill({ json: { record } });
    }
    if (path === "/api/records")
      return route.fulfill({ json: { records, epoch: "test-current" } });
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
    return route.fulfill({ json: { epoch: "test-current", records: [] } });
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

  const preview = page.locator(".document-viewer .latex-pdf-preview");
  const canvas = preview.locator(".latex-pdf-sheet canvas").first();
  const initialWidth = await canvas.evaluate((element) =>
    Number.parseFloat(element.style.width),
  );
  const initialFitFrames = await preview.evaluate(async (element) => {
    const canvasElement = element.querySelector("canvas")!;
    const frames: Array<{
      width: number;
      height: number;
      viewportHeight: number;
      boundsWidth: number;
    }> = [];
    for (let frame = 0; frame < 8; frame++) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const bounds = canvasElement.getBoundingClientRect();
      frames.push({
        width: Number(canvasElement.style.width.replace("px", "")),
        height: Number(canvasElement.style.height.replace("px", "")),
        viewportHeight: element.clientHeight,
        boundsWidth: bounds.width,
      });
    }
    return frames;
  });
  expect(
    new Set(
      initialFitFrames.map(
        ({ width, height, viewportHeight }) =>
          `${width.toFixed(1)}:${height.toFixed(1)}:${viewportHeight}`,
      ),
    ).size,
  ).toBe(1);
  expect(initialFitFrames.every((frame) => frame.boundsWidth > 0)).toBe(true);
  const initialCenter = await preview.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const canvasBounds = element
      .querySelector("canvas")!
      .getBoundingClientRect();
    return {
      canvasX: canvasBounds.left + canvasBounds.width / 2,
      canvasY: canvasBounds.top + canvasBounds.height / 2,
      viewportX: bounds.left + element.clientWidth / 2,
      viewportY: bounds.top + element.clientHeight / 2,
    };
  });
  expect(
    Math.abs(initialCenter.canvasX - initialCenter.viewportX),
  ).toBeLessThan(3);
  expect(
    Math.abs(initialCenter.canvasY - initialCenter.viewportY),
  ).toBeLessThan(3);
  const zoomValue = preview.locator(".latex-pdf-zoom-controls output");
  await expect(zoomValue).toHaveText("Fit");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(zoomValue).not.toHaveText("Fit");
  await expect
    .poll(() =>
      canvas.evaluate((element) => Number.parseFloat(element.style.width)),
    )
    .toBeGreaterThan(initialWidth);
  const buttonZoomCenter = await preview.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const canvasBounds = element
      .querySelector("canvas")!
      .getBoundingClientRect();
    return {
      canvasX: canvasBounds.left + canvasBounds.width / 2,
      canvasY: canvasBounds.top + canvasBounds.height / 2,
      viewportX: bounds.left + element.clientWidth / 2,
      viewportY: bounds.top + element.clientHeight / 2,
    };
  });
  expect(
    Math.abs(buttonZoomCenter.canvasX - buttonZoomCenter.viewportX),
  ).toBeLessThan(3);
  expect(
    Math.abs(buttonZoomCenter.canvasY - buttonZoomCenter.viewportY),
  ).toBeLessThan(3);
  for (let step = 0; step < 5; step++)
    await page.getByRole("button", { name: "Zoom in" }).click();
  await expect
    .poll(() =>
      canvas.evaluate((element) => Number.parseFloat(element.style.width)),
    )
    .toBeGreaterThan(initialWidth * 2.8);
  const zoomedWidth = await canvas.evaluate((element) =>
    Number.parseFloat(element.style.width),
  );
  await expect
    .poll(() =>
      preview.evaluate((element) => element.scrollWidth > element.clientWidth),
    )
    .toBe(true);
  const horizontalPan = await preview.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
    element.scrollTop = element.scrollHeight;
    const canvasBounds = element
      .querySelector("canvas")!
      .getBoundingClientRect();
    const controlsBounds = element
      .querySelector(".latex-pdf-zoom-controls")!
      .getBoundingClientRect();
    const previewBounds = element.getBoundingClientRect();
    return {
      scrollLeft: element.scrollLeft,
      viewportRight: previewBounds.right,
      canvasRight: canvasBounds.right,
      viewportLeft: previewBounds.left,
      controlsLeft: controlsBounds.left,
      controlsRight: controlsBounds.right,
      viewportTop: previewBounds.top,
      controlsTop: controlsBounds.top,
      viewportBottom: previewBounds.bottom,
      controlsBottom: controlsBounds.bottom,
    };
  });
  expect(horizontalPan.scrollLeft).toBeGreaterThan(0);
  expect(horizontalPan.canvasRight).toBeLessThanOrEqual(
    horizontalPan.viewportRight,
  );
  expect(horizontalPan.canvasRight).toBeGreaterThan(
    horizontalPan.viewportRight - 45,
  );
  expect(horizontalPan.controlsLeft).toBeGreaterThan(
    horizontalPan.viewportLeft,
  );
  expect(horizontalPan.controlsRight).toBeLessThan(horizontalPan.viewportRight);
  expect(horizontalPan.controlsTop).toBeGreaterThanOrEqual(
    horizontalPan.viewportTop,
  );
  expect(horizontalPan.controlsBottom).toBeLessThan(
    horizontalPan.viewportBottom,
  );
  await page.getByRole("button", { name: "Fit to page" }).click();
  await expect(zoomValue).toHaveText("Fit");
  await expect
    .poll(() =>
      canvas.evaluate((element) => Number.parseFloat(element.style.width)),
    )
    .toBeLessThan(zoomedWidth);
  await expect
    .poll(() =>
      canvas.evaluate((element) => Number.parseFloat(element.style.width)),
    )
    .toBeLessThanOrEqual(initialWidth + 1);
  const resetWidth = await canvas.evaluate((element) =>
    Number.parseFloat(element.style.width),
  );
  expect(Math.abs(resetWidth - initialWidth)).toBeLessThan(1.5);
  await expectShellLayout(page, top);
  const wheelAnchor = await canvas.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    };
  });
  await preview.evaluate((element, anchor) => {
    element.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        clientX: anchor.x,
        clientY: anchor.y,
        deltaY: -150,
      }),
    );
  }, wheelAnchor);
  await expect
    .poll(() =>
      canvas.evaluate((element) => Number.parseFloat(element.style.width)),
    )
    .toBeGreaterThan(initialWidth);
  const canvasAfterWheel = await canvas.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    };
  });
  expect(Math.abs(canvasAfterWheel.x - wheelAnchor.x)).toBeLessThan(3);
  expect(Math.abs(canvasAfterWheel.y - wheelAnchor.y)).toBeLessThan(3);
  const wheelZoomedWidth = await canvas.evaluate((element) =>
    Number.parseFloat(element.style.width),
  );
  await preview.evaluate((element) => {
    const canvasElement = element.querySelector("canvas");
    const bounds = canvasElement!.getBoundingClientRect();
    element.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.top + bounds.height / 2,
        deltaY: 150,
      }),
    );
  });
  await expect
    .poll(() =>
      canvas.evaluate((element) => Number.parseFloat(element.style.width)),
    )
    .toBeLessThan(wheelZoomedWidth);

  const pinchPrevented = await preview.evaluate((element) => {
    const canvasElement = element.querySelector("canvas");
    const bounds = canvasElement!.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const touch = (identifier: number, clientX: number) =>
      new Touch({
        identifier,
        target: element,
        clientX,
        clientY: centerY,
        screenX: clientX,
        screenY: centerY,
      });
    const dispatch = (
      type: string,
      touches: Touch[],
      changedTouches: Touch[],
    ) => {
      const event = new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches,
        targetTouches: touches,
        changedTouches,
      });
      element.dispatchEvent(event);
      return event;
    };
    const start = [touch(1, centerX - 40), touch(2, centerX + 40)];
    dispatch("touchstart", start, start);
    const wider = [touch(1, centerX - 70), touch(2, centerX + 70)];
    return {
      prevented: dispatch("touchmove", wider, wider).defaultPrevented,
      centerX,
      centerY,
    };
  });
  expect(pinchPrevented.prevented).toBe(true);
  await expect
    .poll(() =>
      canvas.evaluate((element) => Number.parseFloat(element.style.width)),
    )
    .toBeGreaterThan(initialWidth);
  const canvasAfterPinch = await canvas.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    };
  });
  expect(Math.abs(canvasAfterPinch.x - pinchPrevented.centerX)).toBeLessThan(3);
  expect(Math.abs(canvasAfterPinch.y - pinchPrevented.centerY)).toBeLessThan(3);
  const pinchZoomedWidth = await canvas.evaluate((element) =>
    Number.parseFloat(element.style.width),
  );
  const pinchOutPrevented = await preview.evaluate((element) => {
    const canvasElement = element.querySelector("canvas");
    const bounds = canvasElement!.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const touch = (identifier: number, clientX: number) =>
      new Touch({
        identifier,
        target: element,
        clientX,
        clientY: centerY,
        screenX: clientX,
        screenY: centerY,
      });
    const dispatch = (
      type: string,
      touches: Touch[],
      changedTouches: Touch[],
    ) => {
      const event = new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches,
        targetTouches: touches,
        changedTouches,
      });
      element.dispatchEvent(event);
      return event;
    };
    const start = [touch(1, centerX - 70), touch(2, centerX + 70)];
    dispatch("touchstart", start, start);
    const narrower = [touch(1, centerX - 35), touch(2, centerX + 35)];
    const move = dispatch("touchmove", narrower, narrower);
    dispatch("touchend", [], start);
    return move.defaultPrevented;
  });
  expect(pinchOutPrevented).toBe(true);
  await expect
    .poll(() =>
      canvas.evaluate((element) => Number.parseFloat(element.style.width)),
    )
    .toBeLessThan(pinchZoomedWidth);
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
