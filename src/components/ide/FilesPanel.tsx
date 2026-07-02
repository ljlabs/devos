/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FilesPanel — file explorer with folder navigation
 * Shared between mobile and desktop IDE views.
 */

import React, { useState } from "react";
import { RefreshCw, FilePlus, FolderPlus } from "lucide-react";
import { FileEntry } from "../../types";
import FileExplorer from "../FileExplorer";

interface FilesPanelProps {
  workspaceId: string;
  workspacePath?: string;
  rootEntries: FileEntry[];
  expandedFolders: Set<string>;
  childEntries: Record<string, FileEntry[]>;
  activeFilePath: string | undefined;
  isLoading: boolean;
  onFileSelect: (entry: FileEntry) => void;
  onToggleFolder: (folderPath: string) => void;
  onRefresh: () => void;
  onCreateEntry?: (parentPath: string, name: string, type: "file" | "directory") => Promise<void>;
  onRenameEntry?: (oldPath: string, newName: string) => Promise<void>;
  onDeleteEntry?: (path: string) => Promise<void>;
}

export default function FilesPanel({
  workspaceId,
  workspacePath,
  rootEntries,
  expandedFolders,
  childEntries,
  activeFilePath,
  isLoading,
  onFileSelect,
  onToggleFolder,
  onRefresh,
  onCreateEntry,
  onRenameEntry,
  onDeleteEntry,
}: FilesPanelProps) {
  const [createMode, setCreateMode] = useState<"file" | "folder" | null>(null);

  const handleCreateSubmit = async (name: string) => {
    if (onCreateEntry && name.trim()) {
      await onCreateEntry("", name.trim(), createMode === "folder" ? "directory" : "file");
    }
    setCreateMode(null);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 bg-[#0E0E11]">
        <span className="text-[10px] font-mono font-bold tracking-widest text-slate-500 uppercase">
          Files
        </span>
        <div className="flex items-center gap-1">
          <button
            className="p-1 text-slate-500 hover:text-emerald-400 transition-colors"
            onClick={() => setCreateMode(createMode === "file" ? null : "file")}
            title="New File"
          >
            <FilePlus size={14} />
          </button>
          <button
            className="p-1 text-slate-500 hover:text-emerald-400 transition-colors"
            onClick={() => setCreateMode(createMode === "folder" ? null : "folder")}
            title="New Folder"
          >
            <FolderPlus size={14} />
          </button>
          <button
            className="p-1 text-slate-500 hover:text-emerald-400 transition-colors"
            onClick={onRefresh}
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Inline create input */}
      {createMode && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-white/5 bg-[#0E0E11]">
          {createMode === "file" ? (
            <FilePlus size={13} className="text-emerald-400 flex-shrink-0" />
          ) : (
            <FolderPlus size={13} className="text-yellow-400 flex-shrink-0" />
          )}
          <input
            autoFocus
            placeholder={createMode === "file" ? "filename.ext" : "folder-name"}
            className="flex-1 bg-transparent border-b border-emerald-500/50 text-xs font-mono text-white outline-none py-0.5 placeholder:text-slate-600"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCreateSubmit((e.target as HTMLInputElement).value);
              } else if (e.key === "Escape") {
                setCreateMode(null);
              }
            }}
            onBlur={() => setCreateMode(null)}
          />
        </div>
      )}

      {/* File tree - with horizontal scroll */}
      <div className="flex-1 overflow-y-auto overflow-x-auto scrollbar-subtle">
        {isLoading && rootEntries.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-slate-600">
            <div className="w-4 h-4 border-2 border-slate-600 border-t-emerald-400 rounded-full animate-spin mr-2" />
            Loading...
          </div>
        ) : (
          <div className="min-w-min">
            <FileExplorer
              workspaceId={workspaceId}
              workspacePath={workspacePath}
              entries={rootEntries}
              activeFilePath={activeFilePath}
              onFileSelect={onFileSelect}
              expandedFolders={expandedFolders}
              onToggleFolder={onToggleFolder}
              childEntries={childEntries}
              isLoading={isLoading}
              onCreateEntry={onCreateEntry}
              onRenameEntry={onRenameEntry}
              onDeleteEntry={onDeleteEntry}
            />
          </div>
        )}
      </div>
    </div>
  );
}
