/**
 * Small search scorer for the command palette. Every word of the query must match.
 * Returns null for no match, otherwise a score where higher is better.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const hay = text.toLowerCase();
  let total = 0;
  for (const token of q.split(/\s+/)) {
    const at = hay.indexOf(token);
    if (at >= 0) {
      const wordStart = at === 0 || /[\s\-_/.:]/.test(hay[at - 1]);
      total += 100 - Math.min(at, 60) + (wordStart ? 40 : 0) + (at === 0 ? 30 : 0);
      continue;
    }
    // Letters in order ("shdb" finds "Shield"), with a lower score.
    let i = 0;
    for (const ch of hay) if (ch === token[i]) i++;
    if (i < token.length || token.length < 3) return null;
    total += 20;
  }
  return total - Math.min(hay.length, 80) / 10;
}

export function rank<T>(items: T[], query: string, text: (item: T) => string): T[] {
  if (!query.trim()) return items;
  return items
    .map((item, index) => ({ item, index, score: fuzzyScore(query, text(item)) }))
    .filter((r): r is { item: T; index: number; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((r) => r.item);
}
