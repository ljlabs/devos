import React, { useState } from "react";
import { Copy, Check } from "lucide-react";

interface CopyButtonProps {
  content: string;
}

export default function CopyButton({ content }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono text-slate-500 hover:text-emerald-400 transition-colors cursor-pointer select-none group/copy"
    >
      {copied ? (
        <Check size={12} className="text-emerald-400" />
      ) : (
        <Copy size={12} />
      )}
      <span>{copied ? "Copied!" : "Copy"}</span>
    </button>
  );
}
