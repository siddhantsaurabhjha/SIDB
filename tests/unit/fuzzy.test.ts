import { describe, expect, it } from "vitest";
import { fuzzyScore, rank } from "../../src/lib/fuzzy";

describe("fuzzy search", () => {
  it("needs every word to match and prefers early, word-start matches", () => {
    expect(fuzzyScore("new tab", "Open a new tab")).not.toBeNull();
    expect(fuzzyScore("new zebra", "Open a new tab")).toBeNull();
    expect(fuzzyScore("tab", "Tab search")!).toBeGreaterThan(fuzzyScore("tab", "Reopen closed tab")!);
    expect(fuzzyScore("", "anything")).toBe(0);
  });

  it("matches letters in order only for longer words", () => {
    expect(fuzzyScore("shdb", "Shield")).toBeNull(); // too short for subsequence matching (needs 3+), and no "d" before "b"
    expect(fuzzyScore("shld", "Shield")).not.toBeNull();
    expect(fuzzyScore("xyz", "Shield")).toBeNull();
  });

  it("ranks and keeps original order for equal scores", () => {
    const items = ["Bookmarks", "Open bookmarks bar", "History", "Zoom in"];
    expect(rank(items, "bookmarks", (s) => s)).toEqual(["Bookmarks", "Open bookmarks bar"]);
    expect(rank(items, "", (s) => s)).toEqual(items);
  });
});
