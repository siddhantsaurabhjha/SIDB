import { describe, expect, it } from "vitest";
import { parseBlocks, parseInline } from "../../src/lib/markdown";

describe("markdown subset", () => {
  it("parses paragraphs, headings, lists and code fences", () => {
    const blocks = parseBlocks("# Title\n\nSome text\nsecond line\n\n- one\n- two\n  wrapped\n\n1. first\n2) second\n\n```ts\nconst a = 1;\n\nlet b;\n```\nafter");
    expect(blocks).toEqual([
      { type: "heading", level: 1, text: "Title" },
      { type: "paragraph", text: "Some text\nsecond line" },
      { type: "list", ordered: false, items: ["one", "two wrapped"] },
      { type: "list", ordered: true, items: ["first", "second"] },
      { type: "code", lang: "ts", text: "const a = 1;\n\nlet b;" },
      { type: "paragraph", text: "after" },
    ]);
  });

  it("handles an unfinished code fence while streaming", () => {
    expect(parseBlocks("```py\nprint(1)")).toEqual([{ type: "code", lang: "py", text: "print(1)" }]);
    expect(parseBlocks("")).toEqual([]);
  });

  it("never turns HTML into markup: it stays plain text", () => {
    const blocks = parseBlocks('<img src=x onerror=alert(1)> and <script>alert(1)</script>');
    expect(blocks).toEqual([{ type: "paragraph", text: '<img src=x onerror=alert(1)> and <script>alert(1)</script>' }]);
    expect(parseInline("[click](javascript:alert(1))")).toEqual([{ type: "text", text: "[click](javascript:alert(1))" }]);
  });

  it("parses bold and inline code", () => {
    expect(parseInline("a **b** and `c` d")).toEqual([
      { type: "text", text: "a " },
      { type: "bold", text: "b" },
      { type: "text", text: " and " },
      { type: "code", text: "c" },
      { type: "text", text: " d" },
    ]);
  });
});
