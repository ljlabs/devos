/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { MessageSquare, FolderOpen, Code, Terminal } from "lucide-react";
import { IdePanel } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MobileBottomNavProps {
  active: IdePanel;
  onChange: (panel: IdePanel) => void;
  hasActiveThread: boolean;
}

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

interface NavTab {
  id: IdePanel;
  label: string;
  icon: React.ComponentType<any>;
  requiresThread: boolean;
}

const TABS: NavTab[] = [
  { id: "chat",     label: "CHAT",     icon: MessageSquare, requiresThread: true },
  { id: "files",    label: "FILES",    icon: FolderOpen,    requiresThread: false },
  { id: "editor",   label: "EDITOR",   icon: Code,          requiresThread: false },
  { id: "terminal", label: "TERMINAL", icon: Terminal,      requiresThread: true },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Fixed bottom navigation bar for mobile IDE panels.
 * Four tabs: CHAT, FILES, EDITOR, TERMINAL.
 * Active tab is highlighted with emerald accent color.
 */
export default function MobileBottomNav({
  active,
  onChange,
  hasActiveThread,
}: MobileBottomNavProps) {
  return (
    <nav className="fixed bottom-0 w-full z-50 bg-[#0E0E11] border-t border-white/5 flex justify-around items-center h-14 md:hidden">
      {TABS.map((tab) => {
        const isActive = tab.id === active;
        const Icon = tab.icon;
        const disabled = tab.requiresThread && !hasActiveThread;

        return (
          <button
            key={tab.id}
            onClick={() => {
              if (!disabled) {
                onChange(tab.id);
              }
            }}
            disabled={disabled}
            className={`flex flex-col items-center justify-center h-full w-1/4 transition-all duration-100 ${
              isActive
                ? "text-emerald-400 font-bold scale-95"
                : disabled
                  ? "text-slate-700"
                  : "text-slate-500 active:text-slate-300"
            }`}
            title={disabled ? `${tab.label} requires an active thread` : tab.label}
          >
            {/* Active indicator bar */}
            {isActive && (
              <div className="absolute top-0 w-full h-0.5 bg-emerald-400" />
            )}

            <Icon size={20} className="mb-0.5" />
            <span className="text-[10px] font-mono font-medium tracking-wide">
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
