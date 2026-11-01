import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TabGroup, TabState } from "../../shared/types/browser";
import { useTabs } from "../store/tabs";
import { TabItem } from "./TabItem";

function GroupChip({ group, count, editing, onEdited }: { group: TabGroup; count: number; editing: boolean; onEdited: () => void }) {
  const api = window.sidb.tabs;
  const [name, setName] = useState(group.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setName(group.name);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing, group.name]);

  const finish = () => {
    onEdited();
    if (name.trim() && name.trim() !== group.name) void api.updateGroup(group.id, { name });
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={name}
        maxLength={30}
        aria-label="Group name"
        onChange={(e) => setName(e.target.value)}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish();
          if (e.key === "Escape") onEdited();
        }}
        className="no-drag h-6 w-28 rounded-md border border-line bg-black/30 px-2 text-[11px] outline-none"
      />
    );
  }
  return (
    <button
      className="no-drag flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-semibold text-[#ffffff]"
      style={{ background: group.color }}
      aria-expanded={!group.collapsed}
      title={`${group.name}: click to ${group.collapsed ? "expand" : "collapse"}, right-click for options`}
      onClick={() => void api.updateGroup(group.id, { collapsed: !group.collapsed })}
      onDoubleClick={(e) => {
        e.stopPropagation();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        api.showGroupMenu(group.id);
      }}
    >
      {group.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
      <span className="max-w-24 truncate">{group.name}</span>
      {group.collapsed && <span className="opacity-80">{count}</span>}
    </button>
  );
}

/** Tabs with group headers. Used by both the horizontal strip and the vertical rail. */
export function TabStrip({ vertical }: { vertical?: boolean }) {
  const tabs = useTabs((s) => s.tabs);
  const groups = useTabs((s) => s.groups);
  const activeTabId = useTabs((s) => s.activeTabId);
  const [editingGroup, setEditingGroup] = useState<string | null>(null);

  useEffect(() => window.sidb.tabs.onRenameGroup(setEditingGroup), []);

  const rows: Array<{ kind: "group"; group: TabGroup; count: number } | { kind: "tab"; tab: TabState; color: string | null }> = [];
  const seen = new Set<string>();
  for (const tab of tabs) {
    const group = tab.groupId ? groups.find((g) => g.id === tab.groupId) : undefined;
    if (group && !seen.has(group.id)) {
      seen.add(group.id);
      rows.push({ kind: "group", group, count: tabs.filter((t) => t.groupId === group.id).length });
    }
    // A collapsed group still shows the tab you are on, so the strip never hides the page you are looking at.
    if (group?.collapsed && tab.id !== activeTabId) continue;
    rows.push({ kind: "tab", tab, color: group?.color ?? null });
  }

  return (
    <>
      {rows.map((row) =>
        row.kind === "group" ? (
          <div key={`g:${row.group.id}`} className={vertical ? "flex pt-1" : "flex shrink-0 items-center"}>
            <GroupChip group={row.group} count={row.count} editing={editingGroup === row.group.id} onEdited={() => setEditingGroup(null)} />
          </div>
        ) : (
          <div key={row.tab.id} className={vertical ? "flex" : "flex min-w-0 flex-1 basis-0"} style={vertical ? undefined : { maxWidth: row.tab.pinned ? 32 : 220 }}>
            <TabItem tab={row.tab} active={row.tab.id === activeTabId} compact={row.tab.pinned && !vertical} groupColor={row.color} />
          </div>
        ),
      )}
    </>
  );
}
