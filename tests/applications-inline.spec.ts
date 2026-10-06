import { expect, test } from "@playwright/test";
import { DEFAULT_PREFERENCES, type WorkRecord } from "../shared/model";
import {
  commonRecruitmentProcess,
  selectApplicationStatus,
} from "../shared/applications";
import { enterEditMode } from "./edit-mode-helper";

test("application status, process and scheduling stay inline and preserve each other", async ({
  page,
}) => {
  const base: WorkRecord = {
    id: "synthetic-app",
    kind: "application",
    title: "Platform engineer",
    body: "Long application note used to check that the row stays compact: prepare an example about making platform tooling easier to operate, document a measurable result, and bring a question about on-call ownership.",
    tags: [],
    links: [],
    version: 1,
    data: {
      company: "Google",
      location: "Melbourne, Australia — hybrid with occasional travel",
      recruitmentSteps: commonRecruitmentProcess(),
    },
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    deletedAt: null,
  };
  base.data = selectApplicationStatus(base, "Applied", "2026-10-05");
  const records = [base];
  await page.addInitScript(() => sessionStorage.removeItem("work-demo-active"));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path === "/api/session")
      return route.fulfill({
        json: {
          user: {
            id: "synthetic-app-owner",
            name: "Synthetic",
            email: "synthetic@example.invalid",
          },
          local: false,
          configured: true,
        },
      });
    if (path === "/api/preferences")
      return route.fulfill({ json: { preferences: DEFAULT_PREFERENCES } });
    if (path === "/api/records" && method === "GET")
      return route.fulfill({ json: { records } });
    if (path === "/api/records" && method === "POST") {
      const input = route.request().postDataJSON();
      const record = {
        ...base,
        ...input,
        id: `synthetic-${records.length}`,
        version: 1,
      };
      records.push(record);
      return route.fulfill({ json: { record } });
    }
    if (path.startsWith("/api/records/") && method === "PATCH") {
      const index = records.findIndex(
        (record) => record.id === path.split("/").at(-1),
      );
      const patch = route.request().postDataJSON();
      records[index] = {
        ...records[index],
        ...patch,
        version: records[index].version + 1,
      };
      return route.fulfill({ json: { record: records[index] } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto("/applications");
  const notesPreview = page
    .locator(".application-table .application-notes-preview")
    .first();
  await expect(notesPreview).toHaveAttribute("title", base.body);
  const noteOverflow = await notesPreview.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    textOverflow: getComputedStyle(element).textOverflow,
    boxWidth: element.getBoundingClientRect().width,
    lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
    height: element.getBoundingClientRect().height,
    cellWidth: element.parentElement?.getBoundingClientRect().width ?? 0,
    cellScrollWidth: element.parentElement?.scrollWidth ?? 0,
    cellClientWidth: element.parentElement?.clientWidth ?? 0,
  }));
  expect(noteOverflow.textOverflow).toBe("ellipsis");
  expect(noteOverflow.scrollWidth).toBeGreaterThan(noteOverflow.clientWidth);
  expect(noteOverflow.boxWidth).toBeLessThanOrEqual(noteOverflow.cellWidth + 1);
  expect(noteOverflow.cellScrollWidth).toBeLessThanOrEqual(
    noteOverflow.cellClientWidth + 1,
  );
  expect(noteOverflow.height).toBeLessThanOrEqual(noteOverflow.lineHeight + 1);
  await expect(
    page.locator(".application-table td[title*='Melbourne']").first(),
  ).toBeVisible();
  await notesPreview.hover();
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileNotesPreview = page
    .locator(".application-mobile-cards .application-notes-preview")
    .first();
  await expect(mobileNotesPreview).toHaveAttribute("title", base.body);
  const mobileOverflow = await mobileNotesPreview.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    textOverflow: getComputedStyle(element).textOverflow,
    boxWidth: element.getBoundingClientRect().width,
    lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
    height: element.getBoundingClientRect().height,
    parentWidth: element.parentElement?.getBoundingClientRect().width ?? 0,
  }));
  expect(mobileOverflow.textOverflow).toBe("ellipsis");
  expect(mobileOverflow.scrollWidth).toBeGreaterThan(
    mobileOverflow.clientWidth,
  );
  expect(mobileOverflow.boxWidth).toBeLessThanOrEqual(
    mobileOverflow.parentWidth + 1,
  );
  expect(mobileOverflow.height).toBeLessThanOrEqual(
    mobileOverflow.lineHeight + 1,
  );
  await mobileNotesPreview.hover();
  await page.setViewportSize({ width: 1280, height: 900 });
  await enterEditMode(page, "Applications");
  await page
    .getByRole("link", { name: "Platform engineer", exact: true })
    .first()
    .click();
  const details = page.getByRole("dialog");
  await details.getByRole("button", { name: "Add step", exact: true }).click();
  await details
    .getByRole("textbox", { name: "Step name", exact: true })
    .fill("Online assessment");
  await details.getByRole("textbox", { name: "Role", exact: true }).focus();
  await expect
    .poll(() => records[0].data.recruitmentSteps)
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Online assessment" }),
      ]),
    );
  await details.getByLabel("Status", { exact: true }).click();
  await page
    .getByRole("option", { name: "Online assessment", exact: true })
    .click();
  await expect.poll(() => records[0].data.selectedStepId).not.toBe("");
  await details
    .getByRole("textbox", { name: "Application notes", exact: true })
    .fill("Follow up with the platform team.");
  await details
    .getByRole("textbox", { name: "Application notes", exact: true })
    .blur();
  await expect
    .poll(() => records[0].body)
    .toBe("Follow up with the platform team.");
  expect(records[0].data.selectedStepId).toBeTruthy();
  await details.getByRole("button", { name: "Schedule", exact: true }).click();
  await details
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("OA window");
  await details
    .getByLabel("Date and time", { exact: true })
    .fill("2026-10-08T09:30");
  await details
    .getByRole("button", { name: "Schedule", exact: true })
    .last()
    .click();
  await expect
    .poll(() => records.filter((record) => record.kind === "interview").length)
    .toBe(1);
  expect(
    records.find((record) => record.kind === "interview")?.data,
  ).toMatchObject({
    applicationId: "synthetic-app",
    appointmentVersion: 2,
    stepId: records[0].data.selectedStepId,
  });
  await expect(details.getByText("OA window", { exact: true })).toBeVisible();
  await expect(details.getByRole("link", { name: /Prepare/ })).toHaveCount(0);
  await expect(
    details.getByRole("button", { name: "Edit process", exact: true }),
  ).toHaveCount(0);
});
