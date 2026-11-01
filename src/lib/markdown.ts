export type Block =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: number; text: string }
  | { type: "code"; lang: string; text: string }
  | { type: "list"; ordered: boolean; items: string[] };

/**
 * Small, safe Markdown subset for AI answers: paragraphs, headings, bullet and numbered lists, code fences.
 * Nothing here produces HTML; the renderer turns blocks into React elements, so model output can't inject markup.
 */
export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) blocks.push({ type: "paragraph", text: para.join("\n") });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: "list", ordered: list.ordered, items: list.items });
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*```\s*([\w+#.-]*)\s*$/.exec(line);
    if (fence) {
      flushPara();
      flushList();
      const body: string[] = [];
      for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i++) body.push(lines[i]);
      blocks.push({ type: "code", lang: fence[1], text: body.join("\n") }); // an unclosed fence (still streaming) runs to the end
      continue;
    }
    const heading = /^(#{1,4})\s+(.+?)\s*#*$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d{1,3}[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushPara();
      const ordered = !!numbered;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`; // wrapped list item
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return blocks;
}

export type Inline = { type: "text" | "bold" | "code"; text: string };

/** **bold** and `code` only. Everything else stays plain text. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index) });
    const tok = m[0];
    out.push(tok.startsWith("`") ? { type: "code", text: tok.slice(1, -1) } : { type: "bold", text: tok.slice(2, -2) });
    last = m.index + tok.length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}