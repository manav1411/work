import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    let seed = 197713;
    Math.random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  });
  await page.route("**/api/session", (route) =>
    route.fulfill({ json: { user: null, local: false, configured: true } }),
  );
});

async function scene(page: Page) {
  return page.locator(".auth-logo-playground").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const card = document
      .querySelector(".email-auth-card")!
      .getBoundingClientRect();
    const ratio = canvas.width / canvas.clientWidth;
    const pixels = canvas
      .getContext("2d")!
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let inside = 0;
    let floor = 0;
    let top = 0;
    let left = 0;
    let right = 0;
    let point: { x: number; y: number } | null = null;
    const colour = [0, 0, 0];
    let coloured = 0;
    for (let y = 0; y < canvas.height; y += 2)
      for (let x = 0; x < canvas.width; x += 2) {
        const offset = (y * canvas.width + x) * 4;
        if (pixels[offset + 3] < 230) continue;
        const px = x / ratio;
        const py = y / ratio;
        if (
          px > card.left + 10 &&
          px < card.right - 10 &&
          py > card.top + 10 &&
          py < card.bottom - 10
        )
          inside++;
        if (py > innerHeight - 100) floor++;
        if (px < card.left) left++;
        if (px > card.right) right++;
        if (
          px > card.left &&
          px < card.right &&
          py < card.top &&
          py > card.top - 80
        )
          top++;
        if (!point && px < card.left - 10 && py > innerHeight - 100)
          point = { x: px, y: py };
        const rgb = [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
        if (Math.max(...rgb) - Math.min(...rgb) > 50) {
          rgb.forEach((value, channel) => {
            colour[channel] += value;
          });
          coloured++;
        }
      }
    return {
      inside,
      floor,
      top,
      left,
      right,
      point,
      colour: colour.map((value) => Math.round(value / (coloured || 1))),
    };
  });
}

test("all ten logos fall together, clear the form, change arrow colours, and can be dragged against the card", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/sign-in");
  const canvas = page.locator(".auth-logo-playground");
  await expect(canvas).toHaveAttribute("data-logo-count", "10");
  await expect
    .poll(async () => (await scene(page)).floor, { timeout: 15000 })
    .toBeGreaterThan(500);
  await expect(canvas).toHaveAttribute("data-active-logos", "0", {
    timeout: 15000,
  });
  const initial = await scene(page);
  expect(initial.inside).toBe(0);
  expect(initial.top).toBeGreaterThan(50);
  expect(initial.left).toBeGreaterThan(500);
  expect(initial.right).toBeGreaterThan(500);
  await expect
    .poll(async () => (await scene(page)).colour, { timeout: 6000 })
    .not.toEqual(initial.colour);
  // Grab an actual ink pixel, rather than a rectangular box around the word.
  let grabbed = false;
  for (let attempt = 0; attempt < 8; attempt++) {
    const point = (await scene(page)).point;
    expect(point).not.toBeNull();
    await page.mouse.move(point!.x, point!.y);
    await page.mouse.down();
    if (
      await canvas.evaluate(
        (el) => (el as HTMLElement).style.cursor === "grabbing",
      )
    ) {
      grabbed = true;
      break;
    }
    await page.mouse.up();
  }
  expect(grabbed).toBe(true);
  await page.mouse.move(720, 470, { steps: 30 });
  await page.mouse.move(1435, 950, { steps: 30 });
  await page.mouse.up();
  await expect.poll(async () => (await scene(page)).inside).toBe(0);
  await expect(canvas).toHaveAttribute("data-logo-count", "10");
  await page.getByLabel("Email address").fill("owner@example.invalid");
  await expect(page.getByLabel("Email address")).toHaveValue(
    "owner@example.invalid",
  );
});

test("the shared auth form fits small windows while retaining ten logos", async ({
  page,
}) => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 360, height: 640 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/sign-in");
    await expect(page.locator(".auth-logo-playground")).toHaveAttribute(
      "data-logo-count",
      "10",
    );
    expect(
      await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      })),
    ).toEqual(viewport);
    const signIn = await page
      .getByRole("button", { name: "Sign in", exact: true })
      .boundingBox();
    const signUp = await page
      .getByRole("button", { name: "Sign up", exact: true })
      .boundingBox();
    expect(signIn!.y).toBe(signUp!.y);
    expect(signIn!.width).toBe(signUp!.width);
    expect((await scene(page)).inside).toBe(0);
  }
});
