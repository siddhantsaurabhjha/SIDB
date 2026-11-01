import { describe, expect, it } from "vitest";
import { isWellOrdered, placeInGroup, placeOutOfGroup } from "../../electron/main/tabs/groups";

const tab = (id: string, groupId: string | null = null, pinned = false) => ({ state: { id, groupId, pinned } });
const ids = (items: ReturnType<typeof tab>[]) => items.map((t) => t.state.id).join("");
const groupsOf = (items: ReturnType<typeof tab>[]) => items.map((t) => t.state.groupId ?? "-").join("");

describe("tab groups ordering", () => {
  it("moves a tab next to its group and keeps the group in one block", () => {
    const tabs = [tab("a", "g"), tab("b"), tab("c", "g"), tab("d")];
    const next = placeInGroup(tabs, "d", "g");
    expect(ids(next)).toBe("abcd"); // d joins the group right after c
    expect(groupsOf(next)).toBe("g-gg"); // b was never in the group; the input was already split
    expect(isWellOrdered(placeInGroup([tab("a", "g"), tab("b"), tab("c", "g")], "b", "g"))).toBe(true);
  });

  it("starts a group at the end when it has no tabs yet", () => {
    const next = placeInGroup([tab("a"), tab("b"), tab("c")], "a", "new");
    expect(ids(next)).toBe("bca");
    expect(groupsOf(next)).toBe("--new");
  });

  it("refuses pinned tabs", () => {
    const tabs = [tab("p", null, true), tab("a")];
    expect(placeInGroup(tabs, "p", "g")).toBe(tabs);
    expect(tabs[0].state.groupId).toBeNull();
  });

  it("removes a tab from its group and leaves it right after the group", () => {
    const tabs = [tab("a", "g"), tab("b", "g"), tab("c", "g"), tab("d")];
    const next = placeOutOfGroup(tabs, "a");
    expect(ids(next)).toBe("bcad");
    expect(groupsOf(next)).toBe("gg--");
    expect(isWellOrdered(next)).toBe(true);
    expect(placeOutOfGroup([tab("x")], "x").length).toBe(1);
  });

  it("detects broken layouts", () => {
    expect(isWellOrdered([tab("a", "g"), tab("b"), tab("c", "g")])).toBe(false);
    expect(isWellOrdered([tab("a"), tab("p", null, true)])).toBe(false);
    expect(isWellOrdered([tab("p", null, true), tab("a", "g"), tab("b", "g"), tab("c")])).toBe(true);
  });
});
