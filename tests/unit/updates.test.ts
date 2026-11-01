import { describe, expect, it } from "vitest";
import { checkDue, compareVersions, isNewer, parseLatestRelease, parseVersion, UPDATE_CHECK_INTERVAL_MS } from "../../shared/updates";

const v = (s: string) => {
  const p = parseVersion(s);
  if (!p) throw new Error(`bad version ${s}`);
  return p;
};

describe("versions", () => {
  it("parses tags with or without v", () => {
    expect(parseVersion("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, pre: [] });
    expect(parseVersion("0.1.0-beta.2+build.5")).toEqual({ major: 0, minor: 1, patch: 0, pre: ["beta", "2"] });
    for (const bad of ["1.2", "01.2.3", "1.2.3.4", "latest", "", "v1.2.x"]) expect(parseVersion(bad), bad).toBeNull();
  });

  it("orders by Semantic Versioning precedence", () => {
    const order = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0", "1.0.1", "1.2.0", "2.0.0"];
    for (let i = 0; i < order.length - 1; i++) expect(compareVersions(v(order[i]), v(order[i + 1])), `${order[i]} < ${order[i + 1]}`).toBeLessThan(0);
    expect(compareVersions(v("1.10.0"), v("1.9.0"))).toBeGreaterThan(0);
  });

  it("isNewer", () => {
    expect(isNewer("0.2.0", "0.1.0")).toBe(true);
    expect(isNewer("0.1.0", "0.1.0")).toBe(false);
    expect(isNewer("0.0.9", "0.1.0")).toBe(false);
    expect(isNewer("nonsense", "0.1.0")).toBe(false);
  });
});

const release = (over: Record<string, unknown> = {}) => ({
  tag_name: "v0.2.0",
  name: "SIDB 0.2.0",
  html_url: "https://github.com/owner/sidb/releases/tag/v0.2.0",
  body: "Fixes.\r\nMore fixes.",
  draft: false,
  prerelease: false,
  published_at: "2026-11-01T10:00:00Z",
  ...over,
});

describe("GitHub latest release", () => {
  it("accepts a normal release of the configured repository", () => {
    expect(parseLatestRelease(release(), "owner/sidb")).toEqual({
      version: "0.2.0",
      url: "https://github.com/owner/sidb/releases/tag/v0.2.0",
      name: "SIDB 0.2.0",
      notes: "Fixes.\nMore fixes.",
      publishedAt: Date.parse("2026-11-01T10:00:00Z"),
    });
  });

  it("ignores drafts, pre-releases and tags that are not versions", () => {
    expect(parseLatestRelease(release({ draft: true }), "owner/sidb")).toBeNull();
    expect(parseLatestRelease(release({ prerelease: true }), "owner/sidb")).toBeNull();
    expect(parseLatestRelease(release({ tag_name: "v0.2.0-beta.1" }), "owner/sidb")).toBeNull();
    expect(parseLatestRelease(release({ tag_name: "nightly" }), "owner/sidb")).toBeNull();
  });

  it("never points anywhere but the repository's release pages on github.com", () => {
    for (const url of [
      "https://evil.example/owner/sidb/releases/tag/v0.2.0",
      "http://github.com/owner/sidb/releases/tag/v0.2.0",
      "https://github.com/someone-else/sidb/releases/tag/v0.2.0",
      "https://github.com/owner/sidb/archive/v0.2.0.zip",
      "https://user:pw@github.com/owner/sidb/releases/tag/v0.2.0",
      "https://github.com.evil.example/owner/sidb/releases/",
      "javascript:alert(1)",
    ]) {
      expect(parseLatestRelease(release({ html_url: url }), "owner/sidb"), url).toBeNull();
    }
  });

  it("rejects odd input and repository names", () => {
    expect(parseLatestRelease(null, "owner/sidb")).toBeNull();
    expect(parseLatestRelease("x", "owner/sidb")).toBeNull();
    expect(parseLatestRelease(release(), "owner/sidb/../x")).toBeNull();
    expect(parseLatestRelease(release(), "")).toBeNull();
  });

  it("caps long notes", () => {
    expect(parseLatestRelease(release({ body: "x".repeat(10_000) }), "owner/sidb")?.notes.length).toBe(4000);
  });
});

describe("check schedule", () => {
  it("checks at most once a day, and again if the clock went backwards", () => {
    expect(checkDue(null, 1000)).toBe(true);
    expect(checkDue(1000, 1000 + UPDATE_CHECK_INTERVAL_MS - 1)).toBe(false);
    expect(checkDue(1000, 1000 + UPDATE_CHECK_INTERVAL_MS)).toBe(true);
    expect(checkDue(5000, 1000)).toBe(true);
  });
});
