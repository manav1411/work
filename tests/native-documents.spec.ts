import { expect, test } from "@playwright/test";
import { DEFAULT_PREFERENCES, type WorkRecord } from "../shared/model";
import type { LatexProject } from "../shared/latex";
import { enterEditMode } from "./edit-mode-helper";

test("native documents expand inline, save source and copy independently", async ({
  page,
}) => {
  const records: WorkRecord[] = [];
  const projects = new Map<string, LatexProject>();
  let revision = 0;
  const source =
    "\\documentclass{article}\n% Resume source\n\\begin{document}\nPrimary wording $x_1 = 2$\n\\end{document}\n";
  const tailored = source.replace("Primary wording", "Security wording");
  await page.addInitScript(() => sessionStorage.removeItem("work-demo-active"));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path === "/api/session")
      return route.fulfill({
        json: {
          user: {
            id: "synthetic-document-owner",
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
      return route.fulfill({ json: { records, epoch: "test-current" } });
    if (path === "/api/records" && method === "POST") {
      const input = route.request().postDataJSON();
      const record: WorkRecord = {
        ...input,
        id: `asset-${records.length + 1}`,
        version: 1,
        tags: [],
        links: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      records.push(record);
      return route.fulfill({ json: { record } });
    }
    if (/^\/api\/records\/[^/]+\/attachments$/.test(path))
      return route.fulfill({ json: { attachments: [] } });
    const recordRoute = /^\/api\/records\/([^/]+)$/.exec(path);
    if (recordRoute) {
      const record = records.find((item) => item.id === recordRoute[1])!;
      if (method === "GET") return route.fulfill({ json: { record } });
      if (method === "PATCH") {
        const input = route.request().postDataJSON();
        if (input.version !== record.version)
          return route.fulfill({
            status: 409,
            json: { error: "Revision conflict", record },
          });
        record.title = input.title ?? record.title;
        record.version++;
        return route.fulfill({ json: { record } });
      }
    }
    const match = /^\/api\/latex\/([^/]+)(.*)$/.exec(path);
    if (match) {
      const [, id, tail] = match;
      const record = records.find((item) => item.id === id)!;
      if (!tail && method === "GET")
        return route.fulfill({
          json: { project: projects.get(id) || null, configured: true },
        });
      if (!tail && method === "PUT") {
        const input = route.request().postDataJSON();
        if (input.expectedVersion !== record.version)
          return route.fulfill({
            status: 409,
            json: { error: "Revision conflict" },
          });
        record.version++;
        const project: LatexProject = {
          files: input.files,
          engine: input.engine,
          mainFile: input.mainFile,
          version: record.version,
          sourceId: `revision-${++revision}`,
        };
        record.data.latexProject = { sourceId: project.sourceId };
        projects.set(id, structuredClone(project));
        return route.fulfill({ json: { project, record } });
      }
      if (tail === "/copy" && method === "POST") {
        const input = route.request().postDataJSON();
        const target = records.find((item) => item.id === input.targetAssetId)!;
        const original = projects.get(id)!;
        target.version++;
        target.data = {
          ...target.data,
          latexProject: { sourceId: `revision-${++revision}` },
        };
        const project = {
          ...structuredClone(original),
          sourceId: (target.data.latexProject as { sourceId: string }).sourceId,
          version: target.version,
        };
        projects.set(target.id, project);
        return route.fulfill({ json: { project, record: target } });
      }
      if (tail === "/compile") {
        const input = route.request().postDataJSON();
        // Intentionally no PDF: this checks browser behavior, not real TeX output.
        return route.fulfill({
          json: {
            job: {
              id: `job-${input.sourceId}`,
              sourceId: input.sourceId,
              status: "failed",
              createdAt: new Date().toISOString(),
              log: "Synthetic compiler fixture: compilation unavailable.",
            },
          },
        });
      }
    }
    return route.fulfill({ json: { epoch: "test-current", records: [] } });
  });
  await page.goto("/documents");
  await enterEditMode(page, "Documents");
  await page.locator("#document-family-resume").click();
  await page
    .getByRole("button", { name: "New blank resume", exact: true })
    .click();
  await expect(page).toHaveURL(/\/documents\?record=asset-1$/);
  await enterEditMode(page, "Documents");
  const resumeName = page.getByLabel("Resume document name", { exact: true });
  await resumeName.fill("Resume");
  await resumeName.blur();
  const editor = page.locator(
    ".latex-source-editor .cm-content[contenteditable=true]",
  );
  await expect(editor).toBeVisible();
  await editor.fill(source);
  await expect
    .poll(() => projects.get("asset-1")?.files[0].content)
    .toBe(source);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    const contrast = await editor.evaluate((content) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      const luminance = (color: string) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const rgb = context.getImageData(0, 0, 1, 1).data;
        const linear = Array.from(rgb)
          .slice(0, 3)
          .map((value) => {
            const channel = value / 255;
            return channel <= 0.04045
              ? channel / 12.92
              : ((channel + 0.055) / 1.055) ** 2.4;
          });
        return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
      };
      const background = getComputedStyle(
        content.closest(".cm-editor")!,
      ).backgroundColor;
      return Array.from(content.querySelectorAll(".cm-line span")).map(
        (span) => {
          const foreground = luminance(getComputedStyle(span).color);
          const line = getComputedStyle(
            span.closest(".cm-line")!,
          ).backgroundColor;
          const paper = luminance(
            line === "rgba(0, 0, 0, 0)" ? background : line,
          );
          return {
            text: span.textContent,
            ratio:
              (Math.max(foreground, paper) + 0.05) /
              (Math.min(foreground, paper) + 0.05),
          };
        },
      );
    });
    expect(contrast.length).toBeGreaterThan(5);
    for (const token of contrast)
      expect(token.ratio, `${theme}: ${token.text}`).toBeGreaterThanOrEqual(
        4.5,
      );
  }
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  await page.getByRole("button", { name: "Copy Resume", exact: true }).click();
  await expect(page).toHaveURL(/\/documents\?record=asset-2$/);
  await enterEditMode(page, "Documents");
  const copyName = page
    .getByRole("tab", { name: "Resume (copy)", exact: true })
    .getByLabel("Resume document name", { exact: true });
  await copyName.fill("Security resume");
  await copyName.blur();
  await expect(
    page.getByRole("heading", { name: /^Documents\.?$/, exact: true }),
  ).toBeVisible();
  await expect(editor).toBeVisible();
  await editor.fill(tailored);
  await expect
    .poll(() => projects.get("asset-2")?.files[0].content)
    .toBe(tailored);
  expect(projects.get("asset-1")?.files[0].content).toBe(source);
  await page.getByRole("button", { name: "Close Resume", exact: true }).click();
  await expect(page).toHaveURL(/\/documents$/);
  await expect(page.locator(".document-family-expanded")).toHaveCount(0);

  await page
    .getByRole("button", { name: "Add link", exact: true })
    .first()
    .click();
  await page.getByLabel("Link name", { exact: true }).fill("Portfolio");
  await page
    .getByLabel("Portfolio URL", { exact: true })
    .fill("portfolio.example.com");
  await page.waitForTimeout(1_000);
  expect(records.some((record) => record.kind === "resource")).toBe(false);
  await page
    .getByRole("button", { name: "Add link", exact: true })
    .last()
    .click();
  await expect
    .poll(() => records.some((record) => record.kind === "resource"))
    .toBe(true);
});
