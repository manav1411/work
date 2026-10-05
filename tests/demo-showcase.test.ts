import { afterEach, describe, expect, it, vi } from "vitest";
import { createDemoStore } from "../src/lib/demo";
import { applicationStatus, currentRecruitmentStep } from "../shared/applications";
import { type WorkRecord } from "../shared/model";

function demoStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("isolated demo showcase seed", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows a rich linked sample workspace and upgrades without replacing edits", async () => {
    vi.stubGlobal("sessionStorage", demoStorage());
    const demo = createDemoStore();
    const records = demo.getRecords();
    const applications = records.filter((item) => item.kind === "application");
    expect(new Set(applications.map(applicationStatus))).toEqual(
      new Set(["Saved", "Applied", "In progress", "Offer", "Rejected"]),
    );

    const upcoming = records.find(
      (item) => item.data.demoSeedKey === "appointment-atlassian-technical",
    );
    const atlassian = applications.find(
      (item) => item.data.demoSeedKey === "app-atlassian-platform",
    )!;
    expect(upcoming?.data.applicationId).toBe(atlassian.id);
    expect(upcoming?.data.stepId).toBe(currentRecruitmentStep(atlassian)?.id);
    expect(
      records.filter((item) => item.kind === "story"),
    ).toHaveLength(3);
    expect(
      records.filter(
        (item) => item.kind === "path" && item.data.category === "direction",
      ),
    ).toHaveLength(2);
    expect(records.filter((item) => item.kind === "company" && item.data.radar))
      .toHaveLength(2);

    const document = records.find(
      (item) => item.data.demoSeedKey === "document-resume-outline",
    )!;
    const files = (await demo.adapter(
      `/api/records/${document.id}/attachments`,
    )) as { attachments: { id: string; contentType: string }[] };
    expect(files.attachments).toHaveLength(1);
    expect(files.attachments[0].contentType).toBe("text/markdown");
    await expect(demo.fileUrl(files.attachments[0].id)).resolves.toMatch(/^blob:/);

    const authored = (await demo.adapter("/api/records", {
      method: "POST",
      body: JSON.stringify({ kind: "story", title: "My demo edit", tags: [], data: {} }),
    })) as { record: WorkRecord };
    const story = records.find(
      (item) => item.data.demoSeedKey === "story-security-change",
    )!;
    await demo.adapter(`/api/records/${story.id}`, { method: "DELETE" });

    const reopened = createDemoStore();
    expect(reopened.getRecords().some((item) => item.id === authored.record.id)).toBe(true);
    expect(reopened.getRecords().some((item) => item.id === story.id)).toBe(false);
    expect(
      reopened.getRecords().filter((item) => item.data.demoSeedKey === "story-security-change"),
    ).toHaveLength(0);
  });
});
