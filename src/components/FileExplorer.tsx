/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
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
  MoreVertical,
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
  Copy,
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
  workspacePath?: string;
  entries: FileEntry[];
  activeFilePath?: string;
  onFileSelect: (entry: FileEntry) => void;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  childEntries: Record<string, FileEntry[]>;
  isLoading: boolean;
  depth?: number;
  onCreateEntry?: (parentPath: string, name: string, type: "file" | "directory") => Promise<void>;
  onRenameEntry?: (oldPath: string, newName: string) => Promise<void>;
  onDeleteEntry?: (path: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context Menu
// ---------------------------------------------------------------------------

interface ContextMenuState {
  x: number;
  y: number;
  entry: FileEntry;
}

interface InlineEditState {
  mode: "rename" | "create_file" | "create_folder";
  parentPath: string;
  entryPath?: string;
  initialValue: string;
}

function FileContextMenu({
  state,
  onClose,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  onCopyPath,
}: {
  state: ContextMenuState;
  onClose: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCopyPath: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const isDirectory = state.entry.type === "directory";

  const items = [
    ...(isDirectory ? [
      { icon: FilePlus, label: "New File", onClick: onNewFile },
      { icon: FolderPlus, label: "New Folder", onClick: onNewFolder },
      { divider: true },
    ] : []),
    { icon: Pencil, label: "Rename", onClick: onRename },
    { icon: Trash2, label: "Delete", onClick: onDelete, danger: true },
    { divider: true },
    { icon: Copy, label: "Copy Path", onClick: onCopyPath },
  ];

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[160px] bg-[#1A1A1E] border border-white/10 rounded-md shadow-xl py-1"
      style={{ left: state.x, top: state.y }}
    >
      {items.map((item, i) =>
        "divider" in item ? (
          <div key={i} className="my-1 border-t border-white/5" />
        ) : (
          <button
            key={i}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              item.onClick();
              onClose();
            }}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs font-mono transition-colors ${
              (item as any).danger
                ? "text-red-400 hover:bg-red-400/10"
                : "text-slate-300 hover:bg-white/5 hover:text-white"
            }`}
          >
            <item.icon size={13} />
            {item.label}
          </button>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline Edit Input
// ---------------------------------------------------------------------------

function InlineEditInput({
  initialValue,
  onSubmit,
  onCancel,
}: {
  initialValue: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const trimmed = value.trim();
      if (trimmed) onSubmit(trimmed);
      else onCancel();
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => onCancel()}
      className="w-full bg-[#1A1A1E] border border-emerald-500/50 rounded px-1.5 py-0.5 text-xs font-mono text-white outline-none"
    />
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FileExplorer({
  workspaceId,
  workspacePath,
  entries,
  activeFilePath,
  onFileSelect,
  expandedFolders,
  onToggleFolder,
  childEntries,
  isLoading,
  depth = 0,
  onCreateEntry,
  onRenameEntry,
  onDeleteEntry,
}: FileExplorerProps) {
  return (
    <div className={`${depth > 0 ? "pl-4" : ""}`}>
      {entries.map((entry) => (
        <FileTreeItem
          key={entry.path}
          entry={entry}
          workspaceId={workspaceId}
          workspacePath={workspacePath}
          activeFilePath={activeFilePath}
          onFileSelect={onFileSelect}
          expandedFolders={expandedFolders}
          onToggleFolder={onToggleFolder}
          childEntries={childEntries}
          isLoading={isLoading}
          depth={depth}
          onCreateEntry={onCreateEntry}
          onRenameEntry={onRenameEntry}
          onDeleteEntry={onDeleteEntry}
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
  workspacePath?: string;
  activeFilePath?: string;
  onFileSelect: (entry: FileEntry) => void;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  childEntries: Record<string, FileEntry[]>;
  isLoading: boolean;
  depth: number;
  onCreateEntry?: (parentPath: string, name: string, type: "file" | "directory") => Promise<void>;
  onRenameEntry?: (oldPath: string, newName: string) => Promise<void>;
  onDeleteEntry?: (path: string) => Promise<void>;
}

function FileTreeItem({
  entry,
  workspaceId,
  workspacePath,
  activeFilePath,
  onFileSelect,
  expandedFolders,
  onToggleFolder,
  childEntries,
  isLoading,
  depth,
  onCreateEntry,
  onRenameEntry,
  onDeleteEntry,
}: FileTreeItemProps) {
  const isDirectory = entry.type === "directory";
  const isExpanded = expandedFolders.has(entry.path);
  const isActive = activeFilePath === entry.path;

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [inlineEdit, setInlineEdit] = useState<InlineEditState | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);

  const handleClick = () => {
    if (isDirectory) {
      onToggleFolder(entry.path);
    } else {
      onFileSelect(entry);
    }
  };

  const handleMoreClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = moreButtonRef.current?.getBoundingClientRect();
    if (rect) {
      const menuWidth = 160;
      const menuHeight = 220;
      
      // Use container bounds if available (for desktop IDE), otherwise use viewport
      const container = moreButtonRef.current?.closest('[class*="flex"]') || window;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      // Position left if menu would overflow right
      let x = rect.right + menuWidth + 8 > viewportWidth
        ? rect.left - menuWidth - 4
        : rect.right + 4;
      x = Math.max(4, x);
      
      // Position above if menu would overflow bottom
      let y = rect.top;
      if (rect.top + menuHeight > viewportHeight) {
        y = Math.max(4, rect.bottom - menuHeight);
      }
      
      console.log(`[FileExplorer] Context menu positioned at: x=${x}, y=${y}`);
      setContextMenu({ x, y, entry });
    }
  };

  const handleCopyPath = () => {
    const fullPath = workspacePath
      ? `${workspacePath}/${entry.path}`
      : entry.path;
    navigator.clipboard.writeText(fullPath);
  };

  const handleDelete = async () => {
    if (onDeleteEntry) {
      await onDeleteEntry(entry.path);
    }
  };

  const iconSize = 16;
  const paddingLeft = 12;

  return (
    <div>
      {/* Debug: {console.log(`[FileTreeItem] Rendering: ${entry.path}, hasInlineEdit: ${!!inlineEdit}`)} */}
      <div
        className={`flex items-center gap-1.5 py-1 pr-2 cursor-pointer transition-colors group ${
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

        {/* Name or inline edit */}
        {inlineEdit ? (
          <div className="flex-1 min-w-0">
            {/* Debug: {console.log(`[FileExplorer] Rendering inline edit on entry: ${entry.path}, mode: ${inlineEdit.mode}`)} */}
            <InlineEditInput
              initialValue={inlineEdit.initialValue}
              onSubmit={async (newValue) => {
                if (inlineEdit.mode === "rename" && onRenameEntry && inlineEdit.entryPath) {
                  await onRenameEntry(inlineEdit.entryPath, newValue);
                } else if ((inlineEdit.mode === "create_file" || inlineEdit.mode === "create_folder") && onCreateEntry) {
                  const type = inlineEdit.mode === "create_file" ? "file" : "directory";
                  console.log(`[FileExplorer] Creating ${type}: ${entry.path}/${newValue}`);
                  await onCreateEntry(entry.path, newValue, type);
                }
                setInlineEdit(null);
              }}
              onCancel={() => setInlineEdit(null)}
            />
          </div>
        ) : (
          <span className="truncate text-sm font-mono flex-1 min-w-0">
            {entry.name}
          </span>
        )}

        {/* More button — visible on hover */}
        {!inlineEdit && (
          <button
            ref={moreButtonRef}
            onClick={handleMoreClick}
            className="flex-shrink-0 p-2 rounded hover:bg-white/10 text-slate-600 hover:text-slate-300 transition-colors md:p-0.5 md:opacity-0 md:group-hover:opacity-100"
            title="Actions"
          >
            <MoreVertical size={16} />
          </button>
        )}
      </div>

      {/* Inline create input — always visible when active, even if folder is collapsed */}
      {inlineEdit && inlineEdit.parentPath === entry.path && (
        <div
          className="flex items-center gap-1.5 py-1"
          style={{ paddingLeft: `${paddingLeft + (depth + 1) * 16}px` }}
        >
          <span className="flex-shrink-0 w-4 h-4" />
          {inlineEdit.mode === "create_file" ? (
            <FilePlus size={iconSize} className="text-emerald-400 flex-shrink-0" />
          ) : (
            <FolderPlus size={iconSize} className="text-yellow-400 flex-shrink-0" />
          )}
          <InlineEditInput
            initialValue={inlineEdit.initialValue}
            onSubmit={async (newValue) => {
              if (onCreateEntry) {
                const type = inlineEdit.mode === "create_file" ? "file" : "directory";
                console.log(`[FileExplorer] Creating ${type}: ${entry.path}/${newValue}`);
                await onCreateEntry(entry.path, newValue, type);
              }
              setInlineEdit(null);
            }}
            onCancel={() => setInlineEdit(null)}
          />
        </div>
      )}

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
                workspacePath={workspacePath}
                entries={childEntries[entry.path]}
                activeFilePath={activeFilePath}
                onFileSelect={onFileSelect}
                expandedFolders={expandedFolders}
                onToggleFolder={onToggleFolder}
                childEntries={childEntries}
                isLoading={isLoading}
                depth={depth + 1}
                onCreateEntry={onCreateEntry}
                onRenameEntry={onRenameEntry}
                onDeleteEntry={onDeleteEntry}
              />
            )
          )}
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <FileContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          onNewFile={() => {
            console.log(`[FileExplorer] New File clicked in folder: ${entry.path}`);
            if (isDirectory && !expandedFolders.has(entry.path)) {
              onToggleFolder(entry.path);
            }
            // Create file immediately with default name
            if (onCreateEntry) {
              const fileName = "new-file";
              console.log(`[FileExplorer] Creating file: ${entry.path}/${fileName}`);
              onCreateEntry(entry.path, fileName, "file");
            }
          }}
          onNewFolder={() => {
            console.log(`[FileExplorer] New Folder clicked in folder: ${entry.path}`);
            if (isDirectory && !expandedFolders.has(entry.path)) {
              onToggleFolder(entry.path);
            }
            // Create folder immediately with default name
            if (onCreateEntry) {
              const folderName = "new-folder";
              console.log(`[FileExplorer] Creating folder: ${entry.path}/${folderName}`);
              onCreateEntry(entry.path, folderName, "directory");
            }
          }}
          onRename={() => {
            setInlineEdit({
              mode: "rename",
              parentPath: "",
              entryPath: entry.path,
              initialValue: entry.name,
            });
          }}
          onDelete={handleDelete}
          onCopyPath={handleCopyPath}
        />
      )}
    </div>
  );
}
