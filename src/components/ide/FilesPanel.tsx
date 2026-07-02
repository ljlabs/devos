/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FilesPanel — file explorer with folder navigation
 * Shared between mobile and desktop IDE views.
 */

import React from "react";
import { RefreshCw } from "lucide-react";
import { FileEntry } from "../../types";
import FileExplorer from "../FileExplorer";

interface FilesPanelProps {
  workspaceId: string;
  rootEntries: FileEntry[];
  expandedFolders: Set<string>;
  childEntries: Record<string, FileEntry[]>;
  activeFilePath: string | undefined;
  isLoading: boolean;
  onFileSelect: (entry: FileEntry) => void;
  onToggleFolder: (folderPath: string) => void;
  onRefresh: () => void;
}

export default function FilesPanel({
  workspaceId,
  rootEntries,
  expandedFolders,
  childEntries,
  activeFilePath,
  isLoading,
  onFileSelect,
  onToggleFolder,
  onRefresh,
}: FilesPanelProps) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 bg-[#0E0E11]">
        <span className="text-[10px] font-mono font-bold tracking-widest text-slate-500 uppercase">
          Files
        </span>
        <button
          className="p-1 text-slate-500 hover:text-emerald-400 transition-colors"
          onClick={onRefresh}
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && rootEntries.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-slate-600">
            <div className="w-4 h-4 border-2 border-slate-600 border-t-emerald-400 rounded-full animate-spin mr-2" />
            Loading...
          </div>
        ) : (
          <FileExplorer
            workspaceId={workspaceId}
            entries={rootEntries}
            activeFilePath={activeFilePath}
            onFileSelect={onFileSelect}
            expandedFolders={expandedFolders}
            onToggleFolder={onToggleFolder}
            childEntries={childEntries}
            isLoading={isLoading}
          />
        )}
      </div>
    </div>
  );
}
