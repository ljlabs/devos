/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ThinkingBlock } from "./ThinkingBlock";

export function MarkdownContent({ content }: { content: string }) {
  const segments = content.split(/(<thought>[\s\S]*?<\/thought>)/g);

  return (
    <div className="prose prose-invert prose-sm max-w-none break-words
      prose-headings:text-slate-200 prose-headings:font-semibold
      prose-p:text-slate-300 prose-p:leading-relaxed
      prose-a:text-emerald-400 prose-a:no-underline hover:prose-a:underline
      prose-strong:text-slate-200 prose-strong:font-semibold
      prose-code:text-emerald-400 prose-code:bg-white/5 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
      prose-pre:bg-black/60 prose-pre:border prose-pre:border-white/5 prose-pre:rounded-lg
      prose-lead:text-slate-300
      prose-li:text-slate-300
      prose-td:text-slate-300 prose-th:text-slate-200 prose-th:font-semibold
      prose-thead:border-b prose-thead:border-white/10
      prose-table:border-collapse prose-td:border prose-td:border-white/5 prose-th:border prose-th:border-white/5
      prose-blockquote:border-emerald-500/30 prose-blockquote:text-slate-400 prose-blockquote:italic
      prose-hr:border-white/10
      prose-img:rounded-lg
    ">
      {segments.map((segment, i) => {
        if (segment.startsWith('<thought>') && segment.endsWith('</thought>')) {
          const thoughtContent = segment.slice(9, -10);
          return <ThinkingBlock key={i} content={thoughtContent} />;
        }
        return <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>{segment}</ReactMarkdown>;
      })}
    </div>
  );
}
