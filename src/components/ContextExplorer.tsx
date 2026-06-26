/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { 
  Compass, 
  ExternalLink, 
  Layers, 
  Cpu, 
  ShieldCheck, 
  Trash2,
  RefreshCw
} from "lucide-react";
import { Thread, SecurityRule } from "../types";

interface ContextExplorerProps {
  activeThread: Thread | null;
  rules: SecurityRule[];
  onRemoveRule: (id: string) => void;
  onClearRules: () => void;
}

export default function ContextExplorer({
  activeThread,
  rules,
  onRemoveRule,
  onClearRules
}: ContextExplorerProps) {
  if (!activeThread) {
    return (
      <aside className="w-64 bg-[#111114] border-l border-white/5 hidden xl:flex flex-col h-screen select-none p-4 text-center justify-center text-slate-600">
        <p className="text-xs font-sans">No workspace context selected.</p>
      </aside>
    );
  }

  return (
    <aside className="w-64 bg-[#111114] border-l border-white/5 hidden xl:flex flex-col h-screen select-none">
      {/* Header bar */}
      <div className="p-4 h-14 border-b border-white/5 flex items-center bg-[#111114]">
        <span className="text-[10px] font-mono font-bold tracking-widest text-[#c6c6cd]/50 uppercase flex items-center gap-1.5">
          <Compass size={14} className="text-emerald-400" />
          <span>Context Explorer</span>
        </span>
      </div>

      <div className="flex-1 p-4 space-y-6 overflow-y-auto custom-scrollbar">
        
        {/* Active symbols list */}
        <div>
          <h5 className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest mb-3 flex items-center justify-between">
            <span>Active Symbols</span>
            <span className="text-[9px] lowercase font-normal bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/20">
              {activeThread.activeSymbols.length} indexed
            </span>
          </h5>
          
          {activeThread.activeSymbols.length === 0 ? (
            <p className="text-xs font-sans text-slate-600 italic px-1 py-2">
              No code structures or routing controllers indexed in active target file.
            </p>
          ) : (
            <div className="space-y-1">
              {activeThread.activeSymbols.map((sym, index) => {
                // Style based on symbol type: Class, function, method
                let badgeBg = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
                let typeChar = "C";
                if (sym.type === "f") {
                  badgeBg = "bg-blue-500/10 text-blue-400 border-blue-500/20";
                  typeChar = "f";
                } else if (sym.type === "M") {
                  badgeBg = "bg-amber-500/10 text-amber-400 border-amber-500/20";
                  typeChar = "M";
                }

                return (
                  <div 
                    key={index} 
                    className="flex items-center gap-2.5 p-1.5 rounded hover:bg-white/5 text-xs text-slate-300 group cursor-pointer transition-colors border border-transparent hover:border-white/5"
                  >
                    <span className={`text-[10px] font-mono font-bold w-4 h-4 flex items-center justify-center rounded border ${badgeBg}`}>
                      {typeChar}
                    </span>
                    <span className="font-mono text-slate-400 group-hover:text-white truncate">
                      {sym.name}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Workspace monitor preview card */}
        <div>
          <h5 className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest mb-3">
            Workspace Preview
          </h5>
          <div className="rounded-lg border border-white/5 overflow-hidden aspect-video relative group bg-[#0E0E11]">
            {/* Visual preview simulating active metric graph dashboard */}
            <div className="w-full h-full p-3 flex flex-col justify-between">
              <div className="flex justify-between items-center text-[10px] font-mono text-slate-500">
                <span>latency: 42ms</span>
                <span className="flex items-center gap-1 text-emerald-400 animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                  live
                </span>
              </div>
              
              {/* Glowing vector line representing active server metrics */}
              <div className="flex-1 flex items-end justify-between gap-1 pt-2 pb-1 relative">
                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 40" preserveAspectRatio="none">
                  {/* Glowing core neon lines */}
                  <path 
                    d="M0,35 Q15,10 30,25 T60,5 T90,30 L100,20" 
                    fill="none" 
                    stroke="#10b981" 
                    strokeWidth="1.5" 
                    className="animate-pulse"
                  />
                  <path 
                    d="M0,38 Q20,20 40,30 T80,10 L100,28" 
                    fill="none" 
                    stroke="#4ade80" 
                    strokeWidth="1" 
                    strokeOpacity="0.4"
                  />
                </svg>
                {/* Visual grid overlay */}
                <div className="absolute inset-0 border-b border-white/5 grid grid-cols-4 grid-rows-3 opacity-30 pointer-events-none">
                  <div className="border-r border-t border-white/5" />
                  <div className="border-r border-t border-white/5" />
                  <div className="border-r border-t border-white/5" />
                  <div className="border-t border-white/5" />
                </div>
              </div>

              <div className="flex justify-between items-center text-[9px] font-mono text-slate-500 border-t border-white/5 pt-1.5">
                <span>req: 1.4k/s</span>
                <span>CPU: 4.8%</span>
              </div>
            </div>
            
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
              <ExternalLink size={18} className="text-white" />
            </div>
          </div>
        </div>

        {/* Project dependencies block */}
        <div>
          <h5 className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest mb-3">
            Active Dependencies
          </h5>
          {activeThread.dependencies.length === 0 ? (
            <p className="text-xs font-sans text-slate-600 italic px-1 py-1">
              No specific packages or third-party drivers linked to conversation.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {activeThread.dependencies.map((dep, index) => (
                <span 
                  key={index} 
                  className="bg-white/5 border border-white/10 px-2.5 py-1 rounded text-[10px] text-slate-400 font-mono tracking-wide"
                >
                  {dep}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Active automation rules block */}
        <div className="pt-2 border-t border-white/5">
          <h5 className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest mb-3 flex items-center justify-between">
            <span>ACP Clearance Policies</span>
            {rules.length > 0 && (
              <button 
                onClick={onClearRules}
                className="text-[9px] text-rose-400 hover:text-rose-300 hover:underline flex items-center gap-1 cursor-pointer"
                title="Flush rules"
              >
                <Trash2 size={10} />
                <span>Flush</span>
              </button>
            )}
          </h5>

          {rules.length === 0 ? (
            <div className="bg-[#0E0E11]/40 border border-white/5 rounded-lg p-3 text-center text-slate-600">
              <ShieldCheck size={20} className="mx-auto mb-1.5 text-slate-700" />
              <p className="text-[10px] font-sans">
                No automatic authorization rules configured. Security prompt checks will trigger manually.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {rules.map((rule) => (
                <div 
                  key={rule.id}
                  className="flex items-center justify-between p-2 rounded bg-emerald-500/5 border border-emerald-500/10 text-xs font-mono"
                >
                  <div className="flex items-center gap-1.5 overflow-hidden pr-2">
                    <ShieldCheck size={12} className="text-emerald-400 shrink-0" />
                    <span className="text-slate-300 truncate" title={rule.commandPattern}>
                      {rule.commandPattern}
                    </span>
                  </div>
                  <button 
                    onClick={() => onRemoveRule(rule.id)}
                    className="text-slate-500 hover:text-rose-400 p-0.5 rounded hover:bg-rose-950/20 cursor-pointer"
                    title="Remove security rule"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </aside>
  );
}
