import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProviderFailure,
  discoverGitHub,
  fetchGitHubRepository,
  fetchLeetCode,
  fetchNotionPage,
  normalizeLeetCodeUsername,
  normalizeNotionPageId,
} from "../worker/connectors/providers";

const NOTION_ID = "12345678-1234-4abc-9def-1234567890ab";

function response(value: unknown, init?: ResponseInit): Response {
  return new Response(
    typeof value === "string" ? value : JSON.stringify(value),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
      ...init,
    },
  );
}

function stubFetch(...responses: Response[]) {
  const mock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error("Unexpected provider request");
    return next;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider normalization and bounded failures", () => {
  it("normalizes valid LeetCode usernames and Notion page URLs", () => {
    expect(normalizeLeetCodeUsername("  user_name-7 ")).toBe("user_name-7");
    expect(
      normalizeLeetCodeUsername("https://leetcode.com/u/user_name-7/"),
    ).toBe("user_name-7");
    expect(() =>
      normalizeLeetCodeUsername("https://example.com/u/user_name-7"),
    ).toThrow(ProviderFailure);
    expect(
      normalizeNotionPageId(
        `https://www.notion.so/workspace/Research-${NOTION_ID.replaceAll("-", "")}`,
      ),
    ).toBe(NOTION_ID);
    expect(() => normalizeLeetCodeUsername("../private")).toThrow(
      ProviderFailure,
    );
    expect(() =>
      normalizeNotionPageId("https://example.com/not-a-page"),
    ).toThrow(ProviderFailure);
  });

  it("maps malformed provider profile data to a generic failure without leaking upstream text", async () => {
    stubFetch(response({ data: "upstream-secret" }));

    const error = await fetchLeetCode("valid-user").catch(
      (value: unknown) => value,
    );
    expect(error).toMatchObject({ name: "ProviderFailure", status: 502 });
    expect((error as Error).message).not.toContain("upstream-secret");
  });

  it("preserves retry guidance for provider rate limits", async () => {
    stubFetch(
      response("private upstream detail", {
        status: 429,
        headers: { "Retry-After": "47" },
      }),
    );

    const error = await discoverGitHub("octocat").catch(
      (value: unknown) => value,
    );
    expect(error).toBeInstanceOf(ProviderFailure);
    expect(error).toMatchObject({ status: 429, retryAfterSeconds: 47 });
    expect((error as Error).message).not.toContain("private upstream detail");
  });

  it("distinguishes GitHub's 403 rate limit from revoked permissions", async () => {
    stubFetch(
      response("private rate-limit detail", {
        status: 403,
        headers: { "X-RateLimit-Remaining": "0", "Retry-After": "42" },
      }),
    );
    const error = await discoverGitHub("octocat").catch(
      (value: unknown) => value,
    );
    expect(error).toMatchObject({ status: 429, retryAfterSeconds: 42 });
  });

  it("rejects an oversized provider response before parsing it", async () => {
    stubFetch(new Response("x".repeat(2_000_001)));

    await expect(fetchLeetCode("valid-user")).rejects.toMatchObject({
      name: "ProviderFailure",
      status: 502,
    });
  });
});

describe("LeetCode adapter", () => {
  it("keeps repeated solves of the same problem as separate timestamped activities", async () => {
    const payload = {
      data: {
        matchedUser: {
          username: "coder",
          profile: { ranking: 27 },
          submitStats: { acSubmissionNum: [{ difficulty: "All", count: 4 }] },
          userCalendar: {
            submissionCalendar: JSON.stringify({ "1700000000": 2 }),
          },
        },
        allQuestionsCount: [{ difficulty: "All", count: 3_500 }],
        recentAcSubmissionList: [
          {
            id: "9001",
            title: "Same Problem",
            titleSlug: "same-problem",
            timestamp: "1700000000",
          },
          {
            title: "Same Problem",
            titleSlug: "same-problem",
            timestamp: "1700003600",
          },
        ],
      },
    };
    const reordered = structuredClone(payload);
    reordered.data.recentAcSubmissionList.reverse();
    stubFetch(response(payload), response(reordered));

    const result = await fetchLeetCode("coder");
    const reorderedResult = await fetchLeetCode("coder");
    expect(result.activities).toHaveLength(2);
    expect(new Set(result.activities.map((item) => item.sourceKey)).size).toBe(
      2,
    );
    expect(result.activities.map((item) => item.occurredAt)).toEqual([
      "2023-11-14T22:13:20.000Z",
      "2023-11-14T23:13:20.000Z",
    ]);
    expect(
      result.activities.every((item) => item.problemSlug === "same-problem"),
    ).toBe(true);
    expect(
      new Map(
        result.activities.map((item) => [item.occurredAt, item.sourceKey]),
      ),
    ).toEqual(
      new Map(
        reorderedResult.activities.map((item) => [
          item.occurredAt,
          item.sourceKey,
        ]),
      ),
    );
    expect(result.activities[0].sourceKey).toBe("coder:9001");
    expect(result.snapshot.recentIsPartial).toBe(true);
    expect(result.snapshot.solved).toEqual({
      All: 4,
      Easy: 0,
      Medium: 0,
      Hard: 0,
    });
  });

  it("omits a malformed submission calendar while retaining valid profile data", async () => {
    stubFetch(
      response({
        data: {
          matchedUser: {
            username: "coder",
            profile: { ranking: null },
            submitStats: { acSubmissionNum: [] },
            userCalendar: { submissionCalendar: "{not json" },
          },
          allQuestionsCount: [],
          recentAcSubmissionList: [],
        },
      }),
    );

    const result = await fetchLeetCode("coder");
    expect(result.snapshot.calendar).toEqual({});
    expect(result.snapshot.totalQuestions).toEqual({
      All: 0,
      Easy: 0,
      Medium: 0,
      Hard: 0,
    });
    expect(result.activities).toEqual([]);
  });
});

describe("GitHub adapter", () => {
  it("rejects a selected private repository when the connection has no installation token", async () => {
    stubFetch(
      response({
        id: 42,
        name: "private-project",
        full_name: "owner/private-project",
        html_url: "https://github.com/owner/private-project",
        private: true,
        updated_at: "2026-01-02T03:04:05Z",
      }),
    );

    await expect(fetchGitHubRepository("42")).rejects.toMatchObject({
      name: "ProviderFailure",
      status: 403,
    });
  });

  it("drops malformed repository entries rather than returning unsafe selections", async () => {
    stubFetch(
      response([
        {
          id: 9,
          name: "safe",
          full_name: "owner/safe",
          html_url: "https://github.com/owner/safe",
        },
        {
          id: 10,
          name: "spoof",
          full_name: "owner/spoof",
          html_url: "https://attacker.example/spoof",
        },
      ]),
    );

    const result = await discoverGitHub("octocat");
    expect(result.items).toEqual([
      { id: "9", title: "safe", url: "https://github.com/owner/safe" },
    ]);
  });
});

describe("Notion adapter", () => {
  it("sanitizes raw HTML, extracts provider media and child pages, and reports truncation/unknown blocks", async () => {
    stubFetch(
      response({
        id: NOTION_ID,
        object: "page",
        url: `https://www.notion.so/${NOTION_ID}`,
        last_edited_time: "2026-04-05T06:07:08Z",
        properties: {
          Name: { type: "title", title: [{ plain_text: "Research" }] },
        },
      }),
      response({
        markdown: [
          "<script>alert(1)</script>",
          '<file name="paper.pdf" url="https://files.example/paper.pdf"/>',
          "![architecture](https://files.example/diagram.png)",
          `<page id="${NOTION_ID}" url="https://www.notion.so/${NOTION_ID}">Child note</page>`,
          `<unknown id="${NOTION_ID}"/>`,
          "<callout>Read this safely</callout>",
        ].join("\n\n"),
        truncated: true,
        unknown_block_ids: [{ id: NOTION_ID }],
      }),
    );

    const page = await fetchNotionPage(NOTION_ID, "secret-token");
    expect(page.title).toBe("Research");
    expect(page.body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(page.body).not.toContain("<script>");
    expect(page.body).toContain("[paper.pdf](https://files.example/paper.pdf)");
    expect(page.body).toContain("> Read this safely");
    expect(page.media.map((media) => media.filename)).toEqual([
      "paper.pdf",
      "architecture",
    ]);
    expect(page.childPageIds).toContain(NOTION_ID);
    expect(page.data).toMatchObject({
      truncated: true,
      warnings: expect.arrayContaining(["truncated_content", "unknown_blocks"]),
      unknownBlockIds: [NOTION_ID],
    });
  });
});
