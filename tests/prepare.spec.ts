import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("work-demo-active", "true");
  });
});

test("notes save, recover a device draft, restore history and preview an attachment", async ({
  page,
}) => {
  await page.goto("/notes");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page
    .getByLabel("Note title", { exact: true })
    .fill("A synthetic engineering note");
  await page
    .getByLabel("Note content", { exact: true })
    .fill("## Original explanation\n\nA useful invariant.");
  await page.getByRole("button", { name: "Save now", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  const recordId = new URL(page.url()).searchParams.get("record")!;
  await page
    .getByLabel("Note content", { exact: true })
    .fill("## Revised explanation\n\nA clearer invariant.");
  await page.getByRole("button", { name: "Save now", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.getByRole("button", { name: /Version 2 ·/ }).click();
  await page.getByRole("button", { name: "Restore this version" }).click();
  await expect(page.getByLabel("Note content", { exact: true })).toHaveValue(
    "## Original explanation\n\nA useful invariant.",
  );
  await page.evaluate((id) => {
    const store = JSON.parse(sessionStorage.getItem("work-demo-v1")!);
    const record = store.records.find((item: { id: string }) => item.id === id);
    localStorage.setItem(
      `work:note-draft:demo:demo:${id}`,
      JSON.stringify({
        title: record.title,
        body: "A recovered draft that never synced.",
        collection: record.data.collection,
        tags: record.tags.join(", "),
        links: record.links,
        version: record.version,
        savedAt: "2026-10-02T10:00:00Z",
      }),
    );
  }, recordId);
  await page.reload();
  await page
    .getByRole("button", { name: "Recover draft", exact: true })
    .click();
  await expect(page.getByLabel("Note content", { exact: true })).toHaveValue(
    "A recovered draft that never synced.",
  );
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.locator(".attachment-upload input").setInputFiles({
    name: "synthetic-pixel.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(
    page.getByRole("link", { name: "synthetic-pixel.png", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Preview synthetic-pixel.png", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "synthetic-pixel.png" }).getByRole("img"),
  ).toBeVisible();
});

test("a recovered draft conflicts safely with a newer saved version", async ({
  page,
}) => {
  await page.goto("/notes");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.getByLabel("Note title", { exact: true }).fill("Conflict test");
  await page
    .getByLabel("Note content", { exact: true })
    .fill("Newest saved content.");
  await page.getByRole("button", { name: "Save now", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  const recordId = new URL(page.url()).searchParams.get("record")!;
  await page.evaluate((id) => {
    const store = JSON.parse(sessionStorage.getItem("work-demo-v1")!);
    const record = store.records.find((item: { id: string }) => item.id === id);
    localStorage.setItem(
      `work:note-draft:demo:demo:${id}`,
      JSON.stringify({
        title: record.title,
        body: "Older device draft.",
        collection: "Inbox",
        tags: "",
        links: [],
        version: record.version - 1,
        savedAt: "2026-10-01T10:00:00Z",
      }),
    );
  }, recordId);
  await page.reload();
  await page.getByRole("button", { name: "Recover draft" }).click();
  await expect(
    page.getByText("This note changed elsewhere.", { exact: true }),
  ).toBeVisible();
  await page.getByText("View the latest saved note", { exact: true }).click();
  await expect(
    page
      .locator(".notice-warning")
      .getByText("Newest saved content.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Save my draft as a new revision",
      exact: true,
    })
    .click();
  await expect(page.getByRole("status")).toContainText("Saved");
  const content = await page.evaluate(
    (id) =>
      JSON.parse(sessionStorage.getItem("work-demo-v1")!).records.find(
        (item: { id: string }) => item.id === id,
      ).body,
    recordId,
  );
  expect(content).toBe("Older device draft.");
});

test("learning records evidence and creates a linked action", async ({
  page,
}) => {
  await page.goto("/learn?record=dsa-week-1");
  await page.getByLabel("I completed the exercise").check();
  await page.getByLabel("I can explain the idea without reading").check();
  await page
    .getByLabel("Explain it in your own words", { exact: true })
    .fill("Maintain a sorted search interval and shrink it each step.");
  await page
    .getByLabel("Exercise result and reflection", { exact: true })
    .fill(
      "Implemented lower_bound with tests for duplicates and empty inputs.",
    );
  await page.getByLabel("Next review", { exact: true }).fill("2030-10-09");
  await page
    .getByRole("button", { name: "Save + add a practice action", exact: true })
    .click();
  await expect(
    page.getByText("Evidence saved and a practice action added to Today.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.goto("/today");
  await expect(
    page
      .getByText("Practise: Python for DSA & Binary Search", { exact: true })
      .first(),
  ).toBeVisible();
  const state = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("work-demo-v1")!),
  );
  const evidence = state.records.find(
    (record: { kind: string; data: { topicId?: string } }) =>
      record.kind === "progress" && record.data.topicId === "dsa-week-1",
  );
  expect(evidence.data.exerciseCompleted).toBe(true);
  expect(evidence.data.nextReview).toBe("2030-10-09");
});

test("practice preserves multiple attempts and an editable review schedule", async ({
  page,
}) => {
  await page.goto("/practice");
  await page
    .getByRole("button", { name: "Custom problem", exact: true })
    .click();
  await page
    .getByLabel("Problem title", { exact: true })
    .fill("Synthetic prefix sum exercise");
  await page
    .getByLabel("External URL (optional)", { exact: true })
    .fill("https://example.com/problem");
  await page.getByLabel("Pattern", { exact: true }).fill("prefix-sums");
  await page.getByRole("button", { name: "Save problem", exact: true }).click();
  await page.getByRole("button", { name: "Log attempt", exact: true }).click();
  await page.getByLabel("Minutes spent", { exact: true }).fill("18");
  await page
    .getByLabel("Approach and invariant", { exact: true })
    .fill("Use cumulative totals to answer range queries.");
  await page
    .getByLabel("Time and space complexity", { exact: true })
    .fill("O(n) build, O(1) per query, O(n) space.");
  await page
    .getByLabel("Confidence at explaining", { exact: true })
    .selectOption("4");
  await page.getByLabel("Next review", { exact: true }).fill("2030-10-09");
  await page
    .getByRole("button", { name: "Save attempt + review", exact: true })
    .click();
  await expect(
    page.getByText("Independent · 18 min", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Log attempt", exact: true }).click();
  await page.getByLabel("Outcome", { exact: true }).selectOption("Hinted");
  await page
    .getByLabel("Hints / help used", { exact: true })
    .fill("Needed a reminder about the base prefix.");
  await page
    .getByRole("button", { name: "Save attempt + review", exact: true })
    .click();
  await expect(page.locator(".attempt-card")).toHaveCount(2);
  await page
    .getByLabel("Next problem review", { exact: true })
    .fill("2030-11-01");
  await page
    .getByRole("button", { name: "Update schedule", exact: true })
    .click();
  await page.reload();
  await expect(page.locator(".attempt-card")).toHaveCount(2);
  await expect(
    page.getByLabel("Next problem review", { exact: true }),
  ).toHaveValue("2030-11-01");
});

test("an application schedules a timezone-aware interview with preparation and calendar export", async ({
  page,
}) => {
  await page.goto("/today");
  await expect(page.locator(".demo-banner")).toBeVisible();
  const applicationId = await page.evaluate(
    () =>
      JSON.parse(sessionStorage.getItem("work-demo-v1")!).records.find(
        (item: { kind: string }) => item.kind === "application",
      ).id as string,
  );
  await page.goto(`/interviews?application=${applicationId}`);
  await expect(
    page.getByRole("dialog", { name: "Schedule interview", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Interview title", { exact: true })
    .fill("Synthetic Pacific interview");
  await page
    .getByLabel("Date and local time", { exact: true })
    .fill("2030-05-11T09:30");
  await page
    .getByLabel("Timezone", { exact: true })
    .fill("America/Los_Angeles");
  await page
    .getByRole("button", { name: "Save interview", exact: true })
    .click();
  await expect(
    page
      .getByRole("heading", {
        name: "Synthetic Pacific interview",
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await page
    .getByLabel("Questions to ask", { exact: true })
    .fill("What does production ownership look like for this team?");
  await page.getByLabel("Read the role description", { exact: true }).check();
  await page
    .getByRole("button", { name: "Save preparation / reflection", exact: true })
    .click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Add to calendar", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("interview.ics");
  const interview = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("work-demo-v1")!).records.find(
      (item: { title: string }) => item.title === "Synthetic Pacific interview",
    ),
  );
  expect(interview.data.startsAt).toBe("2030-05-11T16:30:00.000Z");
  expect(interview.links).toContain(applicationId);
  expect(interview.data.checklist).toContain("Read the role description");
});

test("STAR stories and mock feedback turn experience into a specific next action", async ({
  page,
}) => {
  await page.goto("/interviews");
  await page.getByRole("tab", { name: /Story bank/ }).click();
  await page.getByRole("button", { name: "Add a story", exact: true }).click();
  await page
    .getByLabel("Story title", { exact: true })
    .fill("Synthetic incident ownership story");
  await page
    .getByLabel("Situation — concise context", { exact: true })
    .fill("A toy service became unreliable.");
  await page
    .getByLabel("Action — what you personally did and why", { exact: true })
    .fill("I reproduced the failure and proposed a small, verified fix.");
  await page
    .getByLabel("Result — outcome and supporting evidence", { exact: true })
    .fill("The regression scenario passed.");
  await page.getByRole("button", { name: "Save story", exact: true }).click();
  await expect(
    page
      .locator(".story-detail")
      .getByText("The regression scenario passed.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /Mocks & feedback/ }).click();
  await page.getByRole("button", { name: "Log a mock", exact: true }).click();
  await page
    .getByLabel("Session title", { exact: true })
    .fill("Synthetic coding mock");
  await page
    .getByLabel("Clarifies requirements and examples", { exact: true })
    .selectOption("4");
  await page
    .getByLabel("Concrete observations / feedback", { exact: true })
    .fill("The invariant was unclear despite a correct solution.");
  await page
    .getByRole("button", { name: "Save mock feedback", exact: true })
    .click();
  await page
    .getByLabel("Action from feedback", { exact: true })
    .fill("Explain one invariant aloud");
  await page.getByRole("button", { name: "Add to Today", exact: true }).click();
  await page.goto("/today");
  await expect(
    page.getByText("Explain one invariant aloud", { exact: true }).first(),
  ).toBeVisible();
});
