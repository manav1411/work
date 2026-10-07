import { expect, test, type Page } from "@playwright/test";
import { enterEditMode } from "./edit-mode-helper";
import type { WorkRecord } from "../shared/model";
import { validRichDocument } from "../shared/rich-content";

async function savedNote(page: Page) {
  return page.evaluate(
    () =>
      JSON.parse(sessionStorage.getItem("work-demo-current")!).records.find(
        (record: WorkRecord) =>
          record.data.category === "content-document" &&
          record.data.tabKey === "technical",
      ) as WorkRecord | undefined,
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    () => (
      localStorage.setItem("work:storage-schema", "current-workspace-2026-10"),
      sessionStorage.setItem("work-demo-active", "true")
    ),
  );
  await page.goto("/interviews?tab=technical");
  await expect(page.locator(".page-header h1")).toHaveText(/^Interviews/);
  await page.evaluate(() => {
    const state = JSON.parse(sessionStorage.getItem("work-demo-current")!);
    state.records = [];
    sessionStorage.setItem("work-demo-current", JSON.stringify(state));
  });
  await page.reload();
  await expect(page.locator(".interview-intro .tiptap")).toBeVisible();
  await enterEditMode(page, "Interviews");
});

test("slash search inserts a code block with keyboard selection and persists its language", async ({
  page,
}) => {
  const editor = page.locator(".interview-intro .tiptap");
  await editor.fill("");
  await editor.pressSequentially("/code");
  const menu = page.getByRole("listbox", { name: "Insert block" });
  await expect(menu.getByRole("option")).toHaveCount(1);
  await expect(menu.getByRole("option", { name: /Code/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  await expect(editor.locator("pre")).toHaveCount(1);
  await page.keyboard.insertText('print("Ready")');
  await page.getByRole("combobox", { name: "Code language" }).click();
  await page.getByRole("option", { name: "python", exact: true }).click();
  await expect
    .poll(async () => (await savedNote(page))?.body)
    .toContain('print("Ready")');
  const saved = await savedNote(page);
  const rich = saved!.data.richContent as {
    document: Parameters<typeof validRichDocument>[0];
  };
  expect(validRichDocument(rich.document)).toBe(true);
  await page.getByRole("button", { name: "Exit code block" }).click();
  await expect(editor).toBeFocused();
  await page.keyboard.insertText("Next idea");
  await expect(
    editor.locator("p").filter({ hasText: "Next idea" }),
  ).toHaveCount(1);
  await expect
    .poll(async () => (await savedNote(page))?.body)
    .toContain("Next idea");
  await page.reload();
  await expect(editor.locator("pre code.language-python")).toHaveText(
    'print("Ready")',
  );
  await expect(editor).toHaveAttribute("contenteditable", "false");
  await expect(page.locator(".rich-word-count")).toHaveCount(0);
  await expect(page.locator(".rich-document-heading")).toHaveCount(0);
});

test("slash menu filters lists, supports arrow navigation, empty results and dismissal", async ({
  page,
}) => {
  const editor = page.locator(".interview-intro .tiptap");
  await editor.fill("");
  await editor.pressSequentially("/list");
  const menu = page.getByRole("listbox", { name: "Insert block" });
  await expect(menu.getByRole("option")).toHaveCount(3);
  await page.keyboard.press("ArrowDown");
  await expect(
    menu.getByRole("option", { name: /Numbered list/ }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("First step");
  await expect(editor.locator("ol li")).toHaveText("First step");
  await page
    .getByRole("button", { name: "Clear formatting", exact: true })
    .click();
  await editor.fill("");
  await editor.pressSequentially("/doesnotexist");
  await expect(menu).toContainText("No blocks found");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(editor).toHaveText("/doesnotexist");
  await editor.fill("A slash inside a sentence /code");
  await expect(menu).toBeHidden();
});

test("Command and Control formatting shortcuts and undo preserve rich text", async ({
  page,
}) => {
  const editor = page.locator(".interview-intro .tiptap");
  await editor.fill("");
  await page.keyboard.press("Meta+b");
  await page.keyboard.insertText("Bold thought");
  await expect(editor.locator("strong")).toHaveText("Bold thought");
  await expect(
    page.getByRole("button", { name: "Bold (⌘/Ctrl+B)", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Control+b");
  await page.keyboard.insertText(" plain thought");
  await expect(editor.locator("strong")).toHaveText("Bold thought");
  await page.keyboard.press("Meta+i");
  await page.keyboard.insertText(" italic");
  await expect(editor.locator("em")).toHaveText(" italic");
  await page.keyboard.press("Meta+i");
  await page.keyboard.press("Meta+u");
  await page.keyboard.insertText(" underline");
  await expect(editor.locator("u")).toHaveText(" underline");
  await expect
    .poll(async () => (await savedNote(page))?.body)
    .toContain("underline");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(editor.locator("u")).toHaveCount(0);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(editor.locator("u")).toHaveText(" underline");
});

test("link shortcut keeps the selected text and rejects unsafe addresses", async ({
  page,
}) => {
  const editor = page.locator(".interview-intro .tiptap");
  await editor.fill("Reference");
  await editor.press("Meta+a");
  await editor.press("Meta+k");
  await page
    .getByRole("textbox", { name: "Link address" })
    .fill("javascript:alert(1)");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("valid HTTP or HTTPS");
  await page
    .getByRole("textbox", { name: "Link address" })
    .fill("example.com/guide");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(editor.getByRole("link", { name: "Reference" })).toHaveAttribute(
    "href",
    "https://example.com/guide",
  );
  await expect
    .poll(async () => (await savedNote(page))?.body)
    .toBe("Reference");
});

test("pasted Markdown becomes structured headings, checklists, and code", async ({
  page,
}) => {
  const editor = page.locator(".interview-intro .tiptap");
  await editor.fill("");
  await editor.evaluate((element) => {
    const clipboard = new DataTransfer();
    clipboard.setData(
      "text/plain",
      "## Practice\n\n- [ ] Review complexity\n\n```python\nprint(42)\n```",
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: clipboard,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(editor.locator("h2")).toHaveText("Practice");
  await expect(editor.locator('ul[data-type="taskList"]')).toContainText(
    "Review complexity",
  );
  await expect(editor.locator("pre code")).toHaveText("print(42)");
  await expect
    .poll(async () => (await savedNote(page))?.body)
    .toContain("print(42)");
  const saved = await savedNote(page);
  expect(
    validRichDocument(
      (saved!.data.richContent as { document: unknown }).document,
    ),
  ).toBe(true);
});

test("mobile slash menu and toolbar fit the viewport in both themes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const editor = page.locator(".interview-intro .tiptap");
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (value) => (document.documentElement.dataset.theme = value),
      theme,
    );
    await editor.fill("");
    await editor.pressSequentially("/table");
    const menu = page.getByRole("listbox", { name: "Insert block" });
    await expect(menu).toBeVisible();
    const bounds = await menu.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    await page.keyboard.press("Escape");
  }
});

test("Tab indents text blocks and Shift+Tab outdents without changing their text", async ({
  page,
}) => {
  const editor = page.locator(".interview-intro .tiptap");
  await editor.fill("A supporting thought");
  await editor.press("Tab");
  await expect(editor.locator("p").first()).toHaveAttribute("data-indent", "1");
  await expect(editor.locator("p").first()).toHaveCSS("margin-left", "24px");
  await editor.press("Tab");
  await expect(editor.locator("p").first()).toHaveAttribute("data-indent", "1");
  await expect
    .poll(async () => JSON.stringify((await savedNote(page))?.data.richContent))
    .toContain('"indent":1');
  await editor.press("Shift+Tab");
  await expect(editor.locator("p").first()).not.toHaveAttribute(
    "data-indent",
    "1",
  );
  await expect(editor).toHaveText("A supporting thought");
  await editor.press("Tab");
  await expect
    .poll(async () => JSON.stringify((await savedNote(page))?.data.richContent))
    .toContain('"indent":1');
  await page.reload();
  await expect(editor.locator("p").first()).toHaveCSS("margin-left", "24px");
});

test("Tab nests list items and inserts code indentation; Shift+Tab reverses each", async ({
  page,
}) => {
  const editor = page.locator(".interview-intro .tiptap");
  await editor.fill("");
  await editor.pressSequentially("/bullet");
  await editor.press("Enter");
  await page.keyboard.insertText("Parent");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("Child");
  await page.keyboard.press("Tab");
  await expect(editor.locator("li li")).toHaveText("Child");
  await page.keyboard.press("Shift+Tab");
  await expect(editor.locator("li li")).toHaveCount(0);
  await page.getByRole("combobox", { name: "Block style" }).click();
  await page.getByRole("option", { name: "Code", exact: true }).click();
  await editor.locator("pre").click();
  await page.keyboard.press("Meta+ArrowLeft");
  await page.keyboard.press("Tab");
  await expect(editor.locator("pre code")).toContainText("  ");
  await page.keyboard.press("Shift+Tab");
  expect(await editor.locator("pre code").innerText()).not.toMatch(/^ {2}/);
});

test("a text block stops at one level deeper than the preceding block", async ({
  page,
}) => {
  const editor = page.locator(".interview-intro .tiptap");
  await editor.fill("Parent thought");
  await editor.press("Tab");
  await editor.press("Enter");
  await page.keyboard.insertText("Supporting thought");
  await editor.press("Tab");
  await expect(
    editor.locator("p").filter({ hasText: "Supporting thought" }),
  ).toHaveAttribute("data-indent", "2");
  await editor.press("Tab");
  await editor.press("Tab");
  await expect(
    editor.locator("p").filter({ hasText: "Supporting thought" }),
  ).toHaveAttribute("data-indent", "2");
  await editor.press("Shift+Tab");
  await expect(
    editor.locator("p").filter({ hasText: "Supporting thought" }),
  ).toHaveAttribute("data-indent", "1");
  await expect
    .poll(async () => (await savedNote(page))?.body)
    .toContain("Supporting thought");
});
