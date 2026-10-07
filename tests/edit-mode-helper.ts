import { expect, type Page } from "@playwright/test";

export async function enterEditMode(page: Page, section: string) {
  await page.waitForLoadState("networkidle");
  const link = page
    .locator(".sidebar")
    .getByRole("link", { name: section, exact: true });
  await expect(link).toBeVisible();
  if (await link.getAttribute("data-editing")) return;
  await link.focus();
  await page.keyboard.down("Space");
  await expect(link).toHaveAttribute("data-editing", "true", { timeout: 8000 });
  await page.keyboard.up("Space");
}
