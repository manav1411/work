import { describe, expect, it } from "vitest";
import { companyMark, COMPANY_MARKS } from "../src/components/CompanyGlyph";
import { access } from "node:fs/promises";

describe("company glyph recognition", () => {
  it("matches names, aliases, domains and genuine subdomains", () => {
    expect(companyMark("GOOGLE Inc.")).toMatchObject({ slug: "google" });
    expect(companyMark("Amazon Web Services")).toMatchObject({
      slug: "amazon",
    });
    expect(companyMark("", "https://careers.atlassian.com/jobs")).toMatchObject(
      { slug: "atlassian" },
    );
    expect(companyMark("Profile", "linkedin.com/in/engineer")).toMatchObject({
      slug: "linkedin",
    });
    expect(
      companyMark("Microsoft", "https://linkedin.com/jobs/123"),
    ).toMatchObject({ slug: "microsoft" });
    expect(companyMark("", "https://manavdodia.com")).toBe("profile");
  });

  it("leaves unknown companies and lookalike domains blank", () => {
    expect(companyMark("Unknown Company")).toBeUndefined();
    expect(companyMark("", "https://notgoogle.com")).toBeUndefined();
    expect(companyMark("", "https://google.com.evil.example")).toBeUndefined();
    expect(
      companyMark("", "https://manavdodia.com.evil.example"),
    ).toBeUndefined();
    expect(
      companyMark("", "https://linkedin.com@evil.example"),
    ).toBeUndefined();
  });

  it("has a bundled asset for every supported brand", async () => {
    await Promise.all(
      COMPANY_MARKS.map((mark) =>
        access(`public/company-glyphs/${mark.slug}.svg`),
      ),
    );
  });
});
