/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import {
  FolderOpen,
  Plus,
  Trash2,
  Settings2,
  MessagesSquare,
  Search,
  History,
  Settings,
  FileText,
  HelpCircle,
  Menu,
  ShieldAlert
} from "lucide-react";
import { Workspace } from "../types";

interface WorkspaceSidebarProps {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  onSelectWorkspace: (id: string) => void;
  onOpenNewWorkspace: () => void;
  onEditWorkspace: (id: string) => void;
  onDeleteWorkspace: (id: string) => void;
  activeView: 'threads' | 'search' | 'activity' | 'security';
  onSelectView: (view: 'threads' | 'search' | 'activity' | 'security') => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export default function WorkspaceSidebar({
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  onOpenNewWorkspace,
  onEditWorkspace,
  onDeleteWorkspace,
  activeView,
  onSelectView,
  collapsed,
  onToggleCollapse
}: WorkspaceSidebarProps) {
  return (
    <aside 
      className={`bg-[#111114] border-r border-white/5 h-screen flex flex-col transition-all duration-300 select-none ${
        collapsed ? "w-16" : "w-64"
      }`}
    >
      {/* Brand Header */}
      <div className="p-4 flex items-center justify-between border-b border-white/5">
        {!collapsed && (
          <div>
            <h1 className="font-sans font-bold text-lg text-white tracking-tight flex items-center gap-2">
              <span className="text-emerald-500 font-black">Dev</span>OS
            </h1>
            <p className="text-[10px] text-slate-500 font-mono tracking-widest uppercase">v2.4.0-stable</p>
          </div>
        )}
        {collapsed && (
          <span className="text-emerald-500 font-black text-xl mx-auto">D</span>
        )}
        <button 
          onClick={onToggleCollapse}
          className="p-1.5 hover:bg-white/5 rounded-md text-slate-500 hover:text-white transition-colors cursor-pointer"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <Menu size={18} />
        </button>
      </div>

      {/* Workspaces List */}
      <div className="flex-1 overflow-y-auto p-2 custom-scrollbar space-y-4">
        <div>
          {!collapsed && (
            <span className="px-3 text-[10px] font-mono font-bold tracking-widest text-[#c6c6cd]/50 uppercase">
              Workspaces
            </span>
          )}
          <nav className="mt-2 space-y-1">
            {workspaces.map((ws) => {
              const isActive = ws.id === activeWorkspaceId;
              return (
                <div key={ws.id} className="group relative">
                  <button
                    onClick={() => onSelectWorkspace(ws.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all ${
                      isActive
                        ? "bg-emerald-500/10 border border-emerald-500/20 text-white shadow-[0_0_15px_rgba(16,185,129,0.05)]"
                        : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                    }`}
                    title={ws.name}
                  >
                    <FolderOpen size={16} className={isActive ? "text-emerald-400" : "text-slate-500"} />
                    {!collapsed && (
                      <span className="flex-1 text-sm font-sans truncate font-medium">
                        {ws.name}
                      </span>
                    )}
                  </button>
                  {!collapsed && (
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); onEditWorkspace(ws.id); }}
                        className="p-1 rounded hover:bg-white/10 text-slate-500 hover:text-slate-300 cursor-pointer"
                        title="Edit workspace"
                      >
                        <Settings2 size={12} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete workspace "${ws.name}" and all its threads?`)) onDeleteWorkspace(ws.id); }}
                        className="p-1 rounded hover:bg-white/10 text-slate-500 hover:text-red-400 cursor-pointer"
                        title="Delete workspace"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </div>

        <div>
          {!collapsed && (
            <span className="px-3 text-[10px] font-mono font-bold tracking-widest text-[#c6c6cd]/50 uppercase">
              Navigation
            </span>
          )}
          <nav className="mt-2 space-y-1">
            <button
              onClick={() => onSelectView('threads')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all ${
                activeView === 'threads' 
                  ? "bg-emerald-500/5 border border-emerald-500/20 text-white font-medium" 
                  : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
              }`}
            >
              <MessagesSquare size={16} className={activeView === 'threads' ? "text-emerald-400" : "text-slate-500"} />
              {!collapsed && <span className="text-sm font-sans">Threads</span>}
            </button>

            <button
              onClick={() => onSelectView('search')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all ${
                activeView === 'search' 
                  ? "bg-emerald-500/5 border border-emerald-500/20 text-white font-medium" 
                  : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
              }`}
            >
              <Search size={16} className={activeView === 'search' ? "text-emerald-400" : "text-slate-500"} />
              {!collapsed && <span className="text-sm font-sans">Search Code</span>}
            </button>

            <button
              onClick={() => onSelectView('activity')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all ${
                activeView === 'activity' 
                  ? "bg-emerald-500/5 border border-emerald-500/20 text-white font-medium" 
                  : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
              }`}
            >
              <History size={16} className={activeView === 'activity' ? "text-emerald-400" : "text-slate-500"} />
              {!collapsed && <span className="text-sm font-sans">Global Logs</span>}
            </button>

            <button
              onClick={() => onSelectView('security')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all ${
                activeView === 'security' 
                  ? "bg-amber-500/5 border border-amber-500/20 text-white font-medium" 
                  : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
              }`}
            >
              <ShieldAlert size={16} className={activeView === 'security' ? "text-amber-400" : "text-slate-500"} />
              {!collapsed && <span className="text-sm font-sans">Gatekeeping Rules</span>}
            </button>
          </nav>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="p-3 border-t border-white/5 space-y-3 bg-[#0E0E11]/80">
        <button 
          onClick={onOpenNewWorkspace}
          className={`w-full py-2 bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500 hover:text-black text-emerald-400 font-sans text-sm font-medium transition-all flex items-center justify-center gap-2 rounded-lg active:scale-95 cursor-pointer ${
            collapsed ? "px-1" : "px-3"
          }`}
          title="Register new local workspace"
        >
          <Plus size={16} />
          {!collapsed && <span>New Workspace</span>}
        </button>

        {!collapsed && (
          <div className="flex items-center justify-between text-slate-400 px-1 pt-1">
            <div className="flex gap-3">
              <a href="#" className="hover:text-white" title="Documentation">
                <FileText size={16} />
              </a>
              <a href="#" className="hover:text-white" title="Help Center">
                <HelpCircle size={16} />
              </a>
            </div>
            <button className="hover:text-white cursor-pointer" title="Settings">
              <Settings size={16} />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
