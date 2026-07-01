/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  Braces,
  File,
  FileJson,
  Settings,
  Terminal,
  Image,
  Lock,
  GitBranch,
} from "lucide-react";

// Map file extensions to icons and colors
const FILE_ICON_MAP: Record<string, { icon: React.ComponentType<any>; color: string }> = {
  ".js":   { icon: FileCode, color: "text-yellow-400" },
  ".jsx":  { icon: FileCode, color: "text-blue-400" },
  ".ts":   { icon: FileCode, color: "text-blue-400" },
  ".tsx":  { icon: FileCode, color: "text-blue-400" },
  ".mjs":  { icon: FileCode, color: "text-yellow-400" },
  ".cjs":  { icon: FileCode, color: "text-yellow-400" },
  ".html": { icon: FileCode, color: "text-orange-400" },
  ".css":  { icon: FileCode, color: "text-purple-400" },
  ".scss": { icon: FileCode, color: "text-pink-400" },
  ".json": { icon: Braces, color: "text-emerald-400" },
  ".yaml": { icon: Settings, color: "text-amber-400" },
  ".yml":  { icon: Settings, color: "text-amber-400" },
  ".md":   { icon: FileText, color: "text-blue-300" },
  ".mdx":  { icon: FileText, color: "text-blue-300" },
  ".py":   { icon: FileCode, color: "text-green-400" },
  ".go":   { icon: FileCode, color: "text-cyan-400" },
  ".rs":   { icon: FileCode, color: "text-orange-300" },
  ".java": { icon: FileCode, color: "text-red-400" },
  ".rb":   { icon: FileCode, color: "text-red-400" },
  ".sh":   { icon: Terminal, color: "text-green-300" },
  ".sql":  { icon: FileCode, color: "text-blue-400" },
  ".env":  { icon: Lock, color: "text-yellow-300" },
  ".gitignore": { icon: GitBranch, color: "text-slate-400" },
  ".png":  { icon: Image, color: "text-pink-400" },
  ".jpg":  { icon: Image, color: "text-pink-400" },
  ".svg":  { icon: Image, color: "text-purple-300" },
};

// Specific filename overrides
const FILENAME_MAP: Record<string, { icon: React.ComponentType<any>; color: string }> = {
  "package.json":  { icon: Braces, color: "text-emerald-400" },
  "tsconfig.json": { icon: Settings, color: "text-blue-400" },
  "vite.config.ts": { icon: Settings, color: "text-emerald-400" },
  "README.md":     { icon: FileText, color: "text-blue-300" },
  "Dockerfile":    { icon: Settings, color: "text-blue-400" },
};

function getFileIcon(name: string): { icon: React.ComponentType<any>; color: string } {
  // Check exact filename first
  if (FILENAME_MAP[name]) return FILENAME_MAP[name];

  // Check extension
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  if (FILE_ICON_MAP[ext]) return FILE_ICON_MAP[ext];

  return { icon: File, color: "text-slate-400" };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  modified?: string;
}

interface FileExplorerProps {
  workspaceId: string;
  entries: FileEntry[];
  activeFilePath?: string;
  onFileSelect: (entry: FileEntry) => void;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  childEntries: Record<string, FileEntry[]>;
  isLoading: boolean;
  depth?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FileExplorer({
  workspaceId,
  entries,
  activeFilePath,
  onFileSelect,
  expandedFolders,
  onToggleFolder,
  childEntries,
  isLoading,
  depth = 0,
}: FileExplorerProps) {
  return (
    <div className={`${depth > 0 ? "pl-4" : ""}`}>
      {entries.map((entry) => (
        <FileTreeItem
          key={entry.path}
          entry={entry}
          workspaceId={workspaceId}
          activeFilePath={activeFilePath}
          onFileSelect={onFileSelect}
          expandedFolders={expandedFolders}
          onToggleFolder={onToggleFolder}
          childEntries={childEntries}
          isLoading={isLoading}
          depth={depth}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual tree item
// ---------------------------------------------------------------------------

interface FileTreeItemProps {
  entry: FileEntry;
  workspaceId: string;
  activeFilePath?: string;
  onFileSelect: (entry: FileEntry) => void;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  childEntries: Record<string, FileEntry[]>;
  isLoading: boolean;
  depth: number;
}

function FileTreeItem({
  entry,
  workspaceId,
  activeFilePath,
  onFileSelect,
  expandedFolders,
  onToggleFolder,
  childEntries,
  isLoading,
  depth,
}: FileTreeItemProps) {
  const isDirectory = entry.type === "directory";
  const isExpanded = expandedFolders.has(entry.path);
  const isActive = activeFilePath === entry.path;

  const handleClick = () => {
    if (isDirectory) {
      onToggleFolder(entry.path);
    } else {
      onFileSelect(entry);
    }
  };

  const iconSize = 16;
  const paddingLeft = 12;

  return (
    <div>
      <div
        className={`flex items-center gap-1.5 py-1 pr-2 cursor-pointer transition-colors ${
          isActive
            ? "bg-emerald-500/10 border-l-2 border-emerald-500 text-emerald-400"
            : "text-slate-300 hover:bg-white/5"
        }`}
        style={{ paddingLeft: `${paddingLeft + depth * 16}px` }}
        onClick={handleClick}
        title={entry.path}
      >
        {/* Chevron for directories */}
        {isDirectory ? (
          <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
            {isExpanded ? (
              <ChevronDown size={14} className="text-slate-500" />
            ) : (
              <ChevronRight size={14} className="text-slate-500" />
            )}
          </span>
        ) : (
          <span className="flex-shrink-0 w-4 h-4" />
        )}

        {/* Icon */}
        {isDirectory ? (
          isExpanded ? (
            <FolderOpen size={iconSize} className="text-yellow-400 flex-shrink-0" />
          ) : (
            <Folder size={iconSize} className="text-yellow-400 flex-shrink-0" />
          )
        ) : (
          (() => {
            const { icon: Icon, color } = getFileIcon(entry.name);
            return <Icon size={iconSize} className={`${color} flex-shrink-0`} />;
          })()
        )}

        {/* Name */}
        <span className="truncate text-sm font-mono">
          {entry.name}
        </span>
      </div>

      {/* Children */}
      {isDirectory && isExpanded && (
        <div>
          {isLoading && !childEntries[entry.path] ? (
            <div
              className="flex items-center gap-2 py-1 text-xs text-slate-500"
              style={{ paddingLeft: `${paddingLeft + (depth + 1) * 16 + 20}px` }}
            >
              <div className="w-3 h-3 border border-slate-600 border-t-emerald-400 rounded-full animate-spin" />
              Loading...
            </div>
          ) : (
            childEntries[entry.path] && (
              <FileExplorer
                workspaceId={workspaceId}
                entries={childEntries[entry.path]}
                activeFilePath={activeFilePath}
                onFileSelect={onFileSelect}
                expandedFolders={expandedFolders}
                onToggleFolder={onToggleFolder}
                childEntries={childEntries}
                isLoading={isLoading}
                depth={depth + 1}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}
