import { describe, expect, it } from "vitest";
import {
  companyInitials,
  logoDevPublishableKey,
  logoDevUrl,
} from "../shared/company-logos";

describe("employer logo CDN lookups", () => {
  it("only accepts publishable keys", () => {
    expect(logoDevPublishableKey("  pk_test-key  ")).toBe("pk_test-key");
    for (const value of ["", "sk_private", "secret", "pk_invalid?query=1"])
      expect(logoDevPublishableKey(value)).toBe("");
    expect(logoDevUrl("Employer", "sk_private")).toBe("");
  });

  it("looks up encoded company names directly through the image CDN", () => {
    const logo = new URL(logoDevUrl("  Culture   & Amp  ", "pk_test"));
    expect(logo.origin).toBe("https://img.logo.dev");
    expect(logo.pathname).toBe("/name/Culture%20%26%20Amp");
    expect(logo.searchParams.get("format")).toBe("png");
    expect(logo.searchParams.has("greyscale")).toBe(false);
    expect(
      new URL(logoDevUrl("GitHub", "pk_test", "dark")).searchParams.get(
        "theme",
      ),
    ).toBe("dark");
    expect(logo.searchParams.get("fallback")).toBe("404");
    expect(logoDevUrl("Example/Employer?brand=1", "pk_test")).toContain(
      "/name/Example%2FEmployer%3Fbrand%3D1?",
    );
  });

  it("keeps unknown employers local and creates stable initials", () => {
    for (const name of [
      "",
      "Employer not listed",
      "Unknown company",
      "Untitled",
      "N/A",
    ])
      expect(logoDevUrl(name, "pk_test")).toBe("");
    expect(companyInitials("  Culture   Amp  ")).toBe("CA");
    expect(companyInitials("東京 株式会社")).toBe("東株");
    expect(companyInitials("")).toBe("?");
  });
});
