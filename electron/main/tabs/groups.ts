export interface GroupedItem {
  state: { id: string; groupId: string | null; pinned: boolean };
}

/** Index of the last item that belongs to the group, or -1. */
function lastIndexOfGroup<T extends GroupedItem>(items: T[], groupId: string): number {
  let last = -1;
  items.forEach((t, i) => {
    if (t.state.groupId === groupId) last = i;
  });
  return last;
}

/** Returns a new order with the tab placed right after the group's last tab (or at the end for an empty group). Pinned tabs can't join. */
export function placeInGroup<T extends GroupedItem>(items: T[], tabId: string, groupId: string): T[] {
  const tab = items.find((t) => t.state.id === tabId);
  if (!tab || tab.state.pinned) return items;
  const rest = items.filter((t) => t !== tab);
  tab.state.groupId = groupId;
  const last = lastIndexOfGroup(rest, groupId);
  rest.splice(last === -1 ? rest.length : last + 1, 0, tab);
  return rest;
}

/** Takes the tab out of its group and leaves it directly after the remaining group tabs. */
export function placeOutOfGroup<T extends GroupedItem>(items: T[], tabId: string): T[] {
  const tab = items.find((t) => t.state.id === tabId);
  if (!tab?.state.groupId) return items;
  const groupId = tab.state.groupId;
  tab.state.groupId = null;
  const rest = items.filter((t) => t !== tab);
  const last = lastIndexOfGroup(rest, groupId);
  rest.splice(last === -1 ? rest.length : last + 1, 0, tab);
  return rest;
}

/** True when every group is one unbroken block and pinned tabs come first and are ungrouped. */
export function isWellOrdered(items: GroupedItem[]): boolean {
  const seen = new Set<string>();
  let current: string | null = null;
  let sawUnpinned = false;
  for (const { state } of items) {
    if (state.pinned && (sawUnpinned || state.groupId)) return false;
    if (!state.pinned) sawUnpinned = true;
    if (state.groupId !== current) {
      if (state.groupId && seen.has(state.groupId)) return false;
      if (state.groupId) seen.add(state.groupId);
      current = state.groupId;
    }
  }
  return true;
}
