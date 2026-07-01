/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import {
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  Braces,
  File,
  FileJson,
  Hash,
  Image,
  Settings,
  Type,
  GitBranch,
  Database,
  Lock,
  Package,
  Terminal,
} from "lucide-react";

// Map file extensions to Lucide icon components and color classes
const FILE_ICON_MAP: Record<string, { icon: React.ComponentType<any>; color: string }> = {
  // JavaScript / TypeScript
  ".js":   { icon: FileCode, color: "text-yellow-400" },
  ".jsx":  { icon: FileCode, color: "text-blue-400" },
  ".ts":   { icon: FileCode, color: "text-blue-400" },
  ".tsx":  { icon: FileCode, color: "text-blue-400" },
  ".mjs":  { icon: FileCode, color: "text-yellow-400" },
  ".cjs":  { icon: FileCode, color: "text-yellow-400" },

  // Web
  ".html": { icon: FileCode, color: "text-orange-400" },
  ".htm":  { icon: FileCode, color: "text-orange-400" },
  ".css":  { icon: FileCode, color: "text-purple-400" },
  ".scss": { icon: FileCode, color: "text-pink-400" },
  ".less": { icon: FileCode, color: "text-blue-300" },
  ".vue":  { icon: FileCode, color: "text-green-400" },
  ".svelte": { icon: FileCode, color: "text-orange-300" },

  // Config / Data
  ".json": { icon: Braces, color: "text-emerald-400" },
  ".yaml": { icon: Settings, color: "text-amber-400" },
  ".yml":  { icon: Settings, color: "text-amber-400" },
  ".toml": { icon: Settings, color: "text-blue-300" },
  ".xml":  { icon: Settings, color: "text-orange-300" },

  // Documentation
  ".md":   { icon: FileText, color: "text-blue-300" },
  ".mdx":  { icon: FileText, color: "text-blue-300" },
  ".txt":  { icon: FileText, color: "text-slate-400" },
  ".rst":  { icon: FileText, color: "text-slate-400" },

  // Python
  ".py":   { icon: FileCode, color: "text-green-400" },
  ".pyi":  { icon: FileCode, color: "text-green-400" },

  // Go
  ".go":   { icon: FileCode, color: "text-cyan-400" },

  // Rust
  ".rs":   { icon: FileCode, color: "text-orange-300" },

  // Java
  ".java": { icon: FileCode, color: "text-red-400" },

  // Ruby
  ".rb":   { icon: FileCode, color: "text-red-400" },

  // Shell
  ".sh":   { icon: Terminal, color: "text-green-300" },
  ".bash": { icon: Terminal, color: "text-green-300" },
  ".zsh":  { icon: Terminal, color: "text-green-300" },
  ".ps1":  { icon: Terminal, color: "text-blue-300" },

  // Images
  ".png":  { icon: Image, color: "text-pink-400" },
  ".jpg":  { icon: Image, color: "text-pink-400" },
  ".jpeg": { icon: Image, color: "text-pink-400" },
  ".gif":  { icon: Image, color: "text-pink-400" },
  ".svg":  { icon: Image, color: "text-purple-300" },
  ".webp": { icon: Image, color: "text-pink-400" },

  // Database
  ".sql":  { icon: Database, color: "text-blue-400" },
  ".db":   { icon: Database, color: "text-slate-400" },
  ".sqlite": { icon: Database, color: "text-slate-400" },

  // Lock files
  ".lock": { icon: Lock, color: "text-slate-500" },

  // Other
  ".env":  { icon: Lock, color: "text-yellow-300" },
  ".gitignore": { icon: GitBranch, color: "text-slate-400" },
  ".dockerignore": { icon: Package, color: "text-blue-300" },
  "Dockerfile": { icon: Package, color: "text-blue-400" },
};

// Specific filename overrides (checked before extension)
const FILENAME_MAP: Record<string, { icon: React.ComponentType<any>; color: string }> = {
  "package.json":  { icon: Braces, color: "text-emerald-400" },
  "package-lock.json": { icon: Lock, color: "text-slate-400" },
  "tsconfig.json": { icon: Settings, color: "text-blue-400" },
  "vite.config.ts": { icon: Settings, color: "text-emerald-400" },
  "tailwind.config.js": { icon: Settings, color: "text-cyan-400" },
  ".gitignore":    { icon: GitBranch, color: "text-slate-400" },
  "Dockerfile":    { icon: Package, color: "text-blue-400" },
  "README.md":     { icon: FileText, color: "text-blue-300" },
  "LICENSE":       { icon: FileText, color: "text-amber-400" },
};

interface FileIconProps {
  /** Filename or full relative path (e.g. "src/index.ts") */
  name: string;
  /** Whether the directory is currently expanded */
  isExpanded?: boolean;
  /** Icon size in pixels */
  size?: number;
}

/**
 * Maps a filename to a colored Lucide icon based on extension.
 * Handles directories, known filenames, and extension fallbacks.
 */
export default function FileIcon({ name, isExpanded, size = 16 }: FileIconProps) {
  // Directories
  if (name.endsWith("/") || (!name.includes(".") && !name.includes(" "))) {
    // Likely a directory if no extension — use Folder/FolderOpen
  }

  // Check exact filename match first
  const filename = name.split("/").pop() || name;
  if (FILENAME_MAP[filename]) {
    const { icon: Icon, color } = FILENAME_MAP[filename];
    return <Icon size={size} className={color} />;
  }

  // Check extension
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  if (FILE_ICON_MAP[ext]) {
    const { icon: Icon, color } = FILE_ICON_MAP[ext];
    return <Icon size={size} className={color} />;
  }

  // Default
  return <File size={size} className="text-slate-400" />;
}

/**
 * Renders a directory icon (filled when expanded, outline when collapsed).
 */
export function DirectoryIcon({ isExpanded, size = 16 }: { isExpanded?: boolean; size?: number }) {
  if (isExpanded) {
    return <FolderOpen size={size} className="text-yellow-400" />;
  }
  return <Folder size={size} className="text-yellow-400" />;
}
