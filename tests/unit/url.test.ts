import { describe, expect, it } from "vitest";
import { internalPageOf, isSafeWebUrl, normalizeInput } from "../../shared/url";

describe("normalizeInput", () => {
  it("opens new tab for empty input", () => expect(normalizeInput("  ")).toBe("sidb://newtab"));
  it("adds https to bare hostnames", () => expect(normalizeInput("example.com")).toBe("https://example.com/"));
  it("uses http for localhost", () => expect(normalizeInput("localhost:3000")).toBe("http://localhost:3000/"));
  it("keeps full http(s) URLs", () => expect(normalizeInput("https://a.dev/x?y=1")).toBe("https://a.dev/x?y=1"));
  it("searches for plain text", () => expect(normalizeInput("hello world")).toBe("https://www.google.com/search?q=hello%20world"));
  it("uses the selected engine", () => expect(normalizeInput("cats", "duckduckgo")).toBe("https://duckduckgo.com/?q=cats"));
  it("never loads dangerous schemes", () => {
    for (const bad of ["javascript:alert(1)", "file:///C:/x", "data:text/html,hi", "chrome://gpu"]) {
      expect(isSafeWebUrl(normalizeInput(bad))).toBe(true);
      expect(normalizeInput(bad).startsWith("https://www.google.com/search")).toBe(true);
    }
  });
  it("accepts known internal pages only", () => {
    expect(normalizeInput("sidb://history")).toBe("sidb://history");
    expect(normalizeInput("sidb://evil")).toBe("sidb://newtab");
  });
});

describe("internalPageOf", () => {
  it("parses internal pages", () => expect(internalPageOf("sidb://ai")).toBe("ai"));
  it("rejects web URLs", () => expect(internalPageOf("https://x.com")).toBeNull());
});
