import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.removeItem("work-demo-active"));
  await page.route("**/api/session", (route) =>
    route.fulfill({ json: { user: null, local: false, configured: true } }),
  );
});

test("sign-up uses Work's forms and supports code paste, leading zeros, and verification", async ({
  page,
}) => {
  let registration: Record<string, unknown> | undefined;
  await page.route("**/api/auth/sign-up/email", (route) => {
    registration = route.request().postDataJSON();
    return route.fulfill({ json: { user: { id: "synthetic-owner" } } });
  });
  await page.route("**/api/auth/sign-in/email", (route) =>
    route.fulfill({
      status: 401,
      json: {
        error: {
          code: "ACCOUNT_NOT_FOUND",
          message:
            "No account uses this email yet. Choose Sign up to create one.",
        },
      },
    }),
  );
  await page.route("**/api/auth/email-otp/verify-email", (route) => {
    expect(route.request().postDataJSON()).toEqual({
      email: "owner@example.invalid",
      otp: "012345",
    });
    return route.fulfill({ json: { status: true } });
  });
  await page.goto("/sign-in");
  await expect(
    page.getByRole("heading", { name: "Sign up or sign in" }),
  ).toBeVisible();
  await page.getByLabel("Email address").fill("owner@example.invalid");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-password-123");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
    "type",
    "text",
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Choose Sign up");
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue(
    "synthetic-password-123",
  );
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await expect(page).toHaveURL(/verify-email$/);
  expect(registration).toEqual({
    email: "owner@example.invalid",
    password: "synthetic-password-123",
  });
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...sessionStorage, ...localStorage }),
    ),
  ).not.toContain("synthetic-password-123");
  await expect(page.getByRole("button", { name: /Resend in/ })).toBeDisabled();
  // A reload retains only the email flow; a password is never persisted.
  await page.reload({ waitUntil: "domcontentloaded" });
  const code = page.getByLabel("Six-digit code");
  await code.fill("012345");
  await expect(code).toHaveValue("012345");
  await expect(code).toHaveAttribute("autocomplete", "one-time-code");
  await page.getByRole("button", { name: "Verify email" }).click();
  await expect(page).toHaveURL(/sign-in$/);
  await expect(page.getByRole("status")).toContainText("Email verified");
});

test("the shared form guides an existing account to recovery and validates signup passwords only", async ({
  page,
}) => {
  let attempts = 0;
  await page.route("**/api/auth/sign-in/email", (route) => {
    attempts++;
    return route.fulfill({
      status: 401,
      json: {
        error: {
          code: "INCORRECT_PASSWORD",
          message:
            "That password doesn’t match. Try again or use Forgot password to reset it.",
        },
      },
    });
  });
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill("owner@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("at least 8 characters");
  expect(attempts).toBe(0);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Forgot password");
  expect(attempts).toBe(1);
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page.getByLabel("Email address")).toHaveValue(
    "owner@example.invalid",
  );
});

test("password recovery is consistent and displays validation errors without losing the email flow", async ({
  page,
}) => {
  await page.route("**/api/auth/email-otp/request-password-reset", (route) =>
    route.fulfill({ json: { success: true } }),
  );
  await page.route("**/api/auth/email-otp/reset-password", (route) =>
    route.fulfill({
      status: 400,
      json: { message: "This code has expired. Request a fresh code." },
    }),
  );
  await page.goto("/sign-in");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await page.getByLabel("Email address").fill("owner@example.invalid");
  await page.getByRole("button", { name: "Send reset code" }).click();
  await expect(page).toHaveURL(/reset-password$/);
  await expect(
    page.getByText(
      "If an account uses this email, a recovery code is on its way.",
    ),
  ).toBeVisible();
  await page.getByLabel("Six-digit code").fill("123456");
  await page
    .getByLabel("New password", { exact: true })
    .fill("new-synthetic-password-123");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByRole("alert")).toContainText("expired");
  await expect(page).toHaveURL(/reset-password$/);
  await expect(page.getByLabel("Six-digit code")).toHaveValue("123456");
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...sessionStorage, ...localStorage }),
    ),
  ).not.toContain("new-synthetic-password-123");
  await page.unroute("**/api/auth/email-otp/reset-password");
  await page.route("**/api/auth/email-otp/reset-password", (route) =>
    route.fulfill({ json: { success: true } }),
  );
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page).toHaveURL(/sign-in$/);
  await expect(page.getByRole("status")).toContainText("Password updated");
});

test("auth layouts fit a small mobile viewport and recover when a code flow is missing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const path of [
    "/sign-in",
    "/sign-up",
    "/forgot-password",
    "/verify-email",
    "/reset-password",
  ]) {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await expect(page.getByRole("link", { name: /Start again/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Demo", exact: true }),
  ).toBeVisible();
});
