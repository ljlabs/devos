/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MarkdownPreview — Full-featured markdown renderer with VSCode-like support
 * Tables, task lists, mermaid diagrams, code blocks, blockquotes, images, etc.
 */

import React, { useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import mermaid from "mermaid";

mermaid.initialize({
  startOnLoad: false,
  theme: "dark",
  securityLevel: "loose",
  fontFamily: "'JetBrains Mono', monospace",
  themeVariables: {
    primaryColor: "#10b981",
    primaryTextColor: "#e2e8f0",
    primaryBorderColor: "#334155",
    lineColor: "#64748b",
    secondaryColor: "#1e293b",
    tertiaryColor: "#0f172a",
    fontFamily: "'JetBrains Mono', monospace",
  },
});

let mermaidCounter = 0;

const MermaidDiagram: React.FC<{ code: string }> = ({ code }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(`mermaid-${++mermaidCounter}`);

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      if (!containerRef.current) return;
      try {
        const { svg } = await mermaid.render(idRef.current, code);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch {
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = `<pre class="text-red-400 text-sm p-2 bg-red-500/10 rounded border border-red-500/20">Mermaid syntax error</pre>`;
        }
      }
    };
    render();
    return () => { cancelled = true; };
  }, [code]);

  return (
    <div className="my-4 flex justify-center overflow-x-auto">
      <div ref={containerRef} className="[&_svg]:max-w-full [&_svg]:h-auto" />
    </div>
  );
};

const ScrollableTable: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="overflow-x-auto rounded-lg border border-white/5 scrollbar-subtle my-4">
    <table className="min-w-full">{children}</table>
  </div>
);

const CodeBlock: React.FC<{ language?: string; children: string }> = ({ language, children }) => {
  if (language === "mermaid") {
    return <MermaidDiagram code={children.trim()} />;
  }
  return (
    <pre className="bg-black/60 border border-white/5 rounded-lg overflow-x-auto p-4 my-4 text-sm font-mono leading-relaxed">
      <code className={`language-${language || "text"}`}>{children}</code>
    </pre>
  );
};

const components: Components = {
  table: ({ children }) => <ScrollableTable>{children}</ScrollableTable>,
  thead: ({ children }) => <thead className="border-b border-white/10">{children}</thead>,
  th: ({ children }) => (
    <th className="px-3 py-2 text-left text-sm font-semibold text-slate-200 border border-white/5 bg-white/5">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 text-sm text-slate-300 border border-white/5">{children}</td>
  ),
  input: ({ checked, ...props }) => (
    <input
      type="checkbox"
      checked={checked}
      readOnly
      className="mr-2 rounded border-slate-600 bg-slate-800 text-emerald-400 focus:ring-emerald-400/30"
      {...props}
    />
  ),
  pre: ({ children }) => {
    const codeChild = React.Children.toArray(children).find(
      (child) => React.isValidElement(child) && child.type === "code"
    ) as React.ReactElement<{ className?: string; children?: React.ReactNode }> | undefined;

    if (codeChild) {
      const className = codeChild.props.className || "";
      const languageMatch = className.match(/language-(\w+)/);
      const language = languageMatch?.[1];
      const code = String(codeChild.props.children).replace(/\n$/, "");
      return <CodeBlock language={language}>{code}</CodeBlock>;
    }
    return <pre className="bg-black/60 border border-white/5 rounded-lg overflow-x-auto p-4 my-4">{children}</pre>;
  },
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-emerald-400 hover:underline"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-emerald-500/30 pl-4 my-4 text-slate-400 italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-white/10 my-8" />,
  img: ({ src, alt }) => (
    <img src={src} alt={alt} className="rounded-lg max-w-full my-4" loading="lazy" />
  ),
};

export default function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="flex-1 overflow-auto bg-[#0B0B0C] p-6"
      style={{ WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}
    >
      <div className="prose prose-invert prose-sm max-w-none break-words
        prose-headings:text-slate-200 prose-headings:font-semibold
        prose-p:text-slate-300 prose-p:leading-relaxed
        prose-a:text-emerald-400 prose-a:no-underline hover:prose-a:underline
        prose-strong:text-slate-200 prose-strong:font-semibold
        prose-code:text-emerald-400 prose-code:bg-white/5 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
        prose-pre:bg-transparent prose-pre:border-0 prose-pre:p-0 prose-pre:my-0
        prose-lead:text-slate-300
        prose-li:text-slate-300
        prose-li:marker:text-emerald-400/60
        prose-blockquote:border-emerald-500/30 prose-blockquote:text-slate-400 prose-blockquote:italic
        prose-hr:border-white/10
        prose-img:rounded-lg
      ">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
