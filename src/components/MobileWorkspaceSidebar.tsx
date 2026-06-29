/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { Plus, Settings, Edit2, Trash2 } from "lucide-react";
import { Workspace } from "../types";

interface MobileWorkspaceSidebarProps {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  onSelectWorkspace: (id: string) => void;
  onOpenNewWorkspace: () => void;
  onEditWorkspace: (id: string) => void;
  onDeleteWorkspace: (id: string) => void;
  onOpenSettings: () => void;
}

export default function MobileWorkspaceSidebar({
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  onOpenNewWorkspace,
  onEditWorkspace,
  onDeleteWorkspace,
  onOpenSettings,
}: MobileWorkspaceSidebarProps) {
  return (
    <main className="flex-1 flex flex-col bg-[#0B0B0C] overflow-y-auto">
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b border-white/5">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-bold text-white">Workspaces</h1>
          <button
            onClick={onOpenSettings}
            className="p-2 hover:bg-white/5 rounded-lg text-slate-400 hover:text-white transition-colors"
            title="Settings"
          >
            <Settings size={20} />
          </button>
        </div>
        <button
          onClick={onOpenNewWorkspace}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 rounded-lg text-emerald-400 font-medium text-sm transition-colors"
        >
          <Plus size={16} />
          New Workspace
        </button>
      </div>

      {/* Workspaces list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {workspaces.length === 0 ? (
          <p className="text-center text-slate-500 py-8 text-sm">No workspaces yet</p>
        ) : (
          workspaces.map((ws) => (
            <div
              key={ws.id}
              className={`p-3 rounded-lg border transition-colors cursor-pointer ${
                activeWorkspaceId === ws.id
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                  : "bg-white/5 border-white/10 hover:border-white/20 text-slate-300"
              }`}
              onClick={() => onSelectWorkspace(ws.id)}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold truncate text-sm">{ws.name}</h3>
                  <p className="text-[11px] text-slate-500 truncate">{ws.path}</p>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditWorkspace(ws.id);
                    }}
                    className="p-1.5 hover:bg-white/10 rounded text-slate-500 hover:text-white transition-colors"
                    title="Edit workspace"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete workspace "${ws.name}"?`)) {
                        onDeleteWorkspace(ws.id);
                      }
                    }}
                    className="p-1.5 hover:bg-red-500/10 rounded text-slate-500 hover:text-red-400 transition-colors"
                    title="Delete workspace"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
