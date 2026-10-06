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
    "\\documentclass{article}\n\\begin{document}\nPrimary wording\n\\end{document}\n";
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
      return route.fulfill({ json: { records } });
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
        deletedAt: null,
      };
      records.push(record);
      return route.fulfill({ json: { record } });
    }
    if (/^\/api\/records\/[^/]+\/attachments$/.test(path))
      return route.fulfill({ json: { attachments: [] } });
    const recordRoute = /^\/api\/records\/([^/]+)$/.exec(path);
    if (recordRoute && method === "GET")
      return route.fulfill({
        json: { record: records.find((item) => item.id === recordRoute[1]) },
      });
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
          revisionId: `revision-${++revision}`,
        };
        record.data.latexProject = { revisionId: project.revisionId };
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
          latexProject: { revisionId: `revision-${++revision}` },
        };
        const project = {
          ...structuredClone(original),
          revisionId: (target.data.latexProject as { revisionId: string })
            .revisionId,
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
              id: `job-${input.revisionId}`,
              revisionId: input.revisionId,
              status: "failed",
              createdAt: new Date().toISOString(),
              log: "Synthetic compiler fixture: compilation unavailable.",
            },
          },
        });
      }
    }
    return route.fulfill({ json: { records: [] } });
  });
  await page.goto("/documents");
  await enterEditMode(page, "Documents");
  await page.locator("#document-family-resume").click();
  await page
    .getByRole("button", { name: "New blank resume", exact: true })
    .click();
  await page
    .locator(".document-create-form")
    .getByLabel("Name", { exact: true })
    .fill("Resume");
  await page
    .getByRole("button", { name: "Create document", exact: true })
    .click();
  const editor = page.locator(
    ".latex-source-editor .cm-content[contenteditable=true]",
  );
  await expect(editor).toBeVisible();
  await editor.fill(source);
  await expect
    .poll(() => projects.get("asset-1")?.files[0].content)
    .toBe(source);
  await page.getByRole("button", { name: "Copy Resume", exact: true }).click();
  const copy = page.locator(".document-create-form");
  await copy.getByLabel("Name", { exact: true }).fill("Security resume");
  await copy.getByRole("button", { name: "Create copy", exact: true }).click();
  await expect(page).toHaveURL(/\/documents\?record=asset-2$/);
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
});
