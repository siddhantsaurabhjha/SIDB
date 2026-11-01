import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { parseBlocks, parseInline } from "../../lib/markdown";

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((p, i) =>
        p.type === "bold" ? (
          <strong key={i}>{p.text}</strong>
        ) : p.type === "code" ? (
          <code key={i} className="rounded bg-white/10 px-1 py-0.5 font-mono text-[0.92em]">
            {p.text}
          </code>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-line bg-black/40">
      <div className="flex items-center justify-between border-b border-line px-3 py-1 text-[10px] text-muted">
        <span>{lang || "code"}</span>
        <button
          className="flex items-center gap-1 hover:text-fg"
          aria-label="Copy code"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed select-text">{text}</pre>
    </div>
  );
}

/** Renders model output as React elements only (no HTML, no links), so answers can't inject markup. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="select-text space-y-2 text-[13px] leading-relaxed">
      {parseBlocks(text).map((b, i) => {
        if (b.type === "code") return <CodeBlock key={i} lang={b.lang} text={b.text} />;
        if (b.type === "heading") return <div key={i} className="pt-1 font-semibold">{<Inline text={b.text} />}</div>;
        if (b.type === "list") {
          const Tag = b.ordered ? "ol" : "ul";
          return (
            <Tag key={i} className={`${b.ordered ? "list-decimal" : "list-disc"} space-y-1 pl-5`}>
              {b.items.map((it, j) => (
                <li key={j}>
                  <Inline text={it} />
                </li>
              ))}
            </Tag>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            <Inline text={b.text} />
          </p>
        );
      })}
    </div>
  );
}
