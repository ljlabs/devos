/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MobileIdeView — mobile IDE layout
 * Uses shared FileEditorPanel, FilesPanel
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import { IdePanel, FileEntry, FileContent, Workspace } from "../types";
import FileEditorPanel from "./ide/FileEditorPanel";
import FilesPanel from "./ide/FilesPanel";

interface MobileIdeViewProps {
  panel: IdePanel;
  workspaceId?: string;
  threadTitle?: string;
  threadLogs?: any[];
  onBack: () => void;
}

export default function MobileIdeView({
  panel,
  workspaceId,
  threadTitle,
  threadLogs = [],
  onBack,
}: MobileIdeViewProps) {
  const [rootEntries, setRootEntries] = useState<FileEntry[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [childEntries, setChildEntries] = useState<Record<string, FileEntry[]>>({});
  const [activeFile, setActiveFile] = useState<FileContent | null>(null);
  const [activeFilePath, setActiveFilePath] = useState<string>("");
  const [isLoadingTree, setIsLoadingTree] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [editorContent, setEditorContent] = useState<string>("");
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [workspacePath, setWorkspacePath] = useState<string>("");
  const [headerExpanded, setHeaderExpanded] = useState(false);

  // Fetch workspace path
  useEffect(() => {
    if (!workspaceId) return;
    fetch("/api/workspaces")
      .then((res) => res.json())
      .then((workspaces: Workspace[]) => {
        const ws = workspaces.find((w) => w.id === workspaceId);
        if (ws) setWorkspacePath(ws.path);
      })
      .catch(() => {});
  }, [workspaceId]);

  const fetchDirectory = useCallback(async (relativePath?: string) => {
    if (!workspaceId) return;
    try {
      const url = relativePath
        ? `/api/workspaces/${workspaceId}/files?path=${encodeURIComponent(relativePath)}`
        : `/api/workspaces/${workspaceId}/files`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (relativePath) {
          setChildEntries((prev) => ({ ...prev, [relativePath]: data.entries }));
        } else {
          setRootEntries(data.entries);
        }
      }
    } catch (e) {
      console.error("Error fetching directory", e);
    }
  }, [workspaceId]);

  const fetchFileContent = useCallback(async (relativePath: string) => {
    if (!workspaceId) return;
    setIsLoadingFile(true);
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/files/read?path=${encodeURIComponent(relativePath)}`
      );
      if (res.ok) {
        const data: FileContent = await res.json();
        setActiveFile(data);
        setActiveFilePath(relativePath);
        setEditorContent(data.content);
        setIsDirty(false);
      }
    } catch (e) {
      console.error("Error fetching file", e);
    } finally {
      setIsLoadingFile(false);
    }
  }, [workspaceId]);

  const handleSave = useCallback(async () => {
    if (!workspaceId || !activeFilePath) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/files/write`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: activeFilePath, content: editorContent }),
      });
      if (res.ok) {
        const data: FileContent = await res.json();
        setActiveFile(data);
        setIsDirty(false);
      }
    } catch (e) {
      console.error("Error saving file", e);
    } finally {
      setIsSaving(false);
    }
  }, [workspaceId, activeFilePath, editorContent]);

  const handleToggleFolder = useCallback(
    async (folderPath: string) => {
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        if (next.has(folderPath)) {
          next.delete(folderPath);
        } else {
          next.add(folderPath);
          if (!childEntries[folderPath]) {
            fetchDirectory(folderPath);
          }
        }
        return next;
      });
    },
    [childEntries, fetchDirectory]
  );

  const handleCreateEntry = useCallback(
    async (parentPath: string, name: string, type: "file" | "directory") => {
      const fullPath = parentPath ? `${parentPath}/${name}` : name;
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/files/create`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: fullPath, type }),
        });
        if (res.ok) {
          if (parentPath) await fetchDirectory(parentPath);
          else await fetchDirectory();
          if (type === "file") await fetchFileContent(fullPath);
        }
      } catch (e) {
        console.error("Error creating entry", e);
      }
    },
    [workspaceId, fetchDirectory, fetchFileContent]
  );

  const handleRenameEntry = useCallback(
    async (oldPath: string, newName: string) => {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/files/rename`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oldPath, newName }),
        });
        if (res.ok) {
          const parentPath = oldPath.substring(0, oldPath.lastIndexOf("/"));
          if (parentPath) await fetchDirectory(parentPath);
          else await fetchDirectory();
          const newPath = parentPath ? `${parentPath}/${newName}` : newName;
          if (activeFilePath === oldPath) {
            setActiveFilePath(newPath);
          }
        }
      } catch (e) {
        console.error("Error renaming entry", e);
      }
    },
    [workspaceId, fetchDirectory, activeFilePath]
  );

  const handleDeleteEntry = useCallback(
    async (entryPath: string) => {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/files/delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: entryPath }),
        });
        if (res.ok) {
          const parentPath = entryPath.substring(0, entryPath.lastIndexOf("/"));
          if (parentPath) await fetchDirectory(parentPath);
          else await fetchDirectory();
          if (activeFilePath === entryPath) {
            setActiveFile(null);
            setActiveFilePath("");
            setEditorContent("");
            setIsDirty(false);
          }
        }
      } catch (e) {
        console.error("Error deleting entry", e);
      }
    },
    [workspaceId, fetchDirectory, activeFilePath]
  );

  const handleFileSelect = useCallback(
    (entry: FileEntry) => {
      if (entry.type === "file") {
        fetchFileContent(entry.path);
      }
    },
    [fetchFileContent]
  );

  const handleCloseTab = useCallback(() => {
    setActiveFile(null);
    setActiveFilePath("");
    setEditorContent("");
    setIsDirty(false);
  }, []);

  useEffect(() => {
    if (workspaceId && panel === "files") {
      setRootEntries([]);
      setExpandedFolders(new Set());
      setChildEntries({});
      fetchDirectory();
    }
  }, [workspaceId, panel, fetchDirectory]);

  const getHeaderTitle = () => {
    switch (panel) {
      case "files": return "Explorer";
      case "editor": return activeFile ? activeFilePath || "Editor" : "Editor";
      default: return "";
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0B0B0C]">
      {/* Panel header */}
      <div className="flex items-center gap-3 px-3 h-12 border-b border-white/5 bg-[#0E0E11] flex-shrink-0">
        <button
          onClick={onBack}
          className="p-1.5 rounded-md hover:bg-white/5 text-slate-400 hover:text-white transition-colors flex-shrink-0"
        >
          <ArrowLeft size={18} />
        </button>
        {panel === "editor" && activeFile ? (
          <span
            className={`text-xs font-mono text-slate-500 cursor-pointer select-text break-all leading-relaxed ${headerExpanded ? "" : "line-clamp-1"}`}
            onClick={() => setHeaderExpanded(!headerExpanded)}
            title={workspacePath && activeFilePath ? `${workspacePath}/${activeFilePath}` : activeFilePath}
          >
            {workspacePath && activeFilePath ? `${workspacePath}/${activeFilePath}` : activeFilePath}
          </span>
        ) : (
          <span className="text-xs font-mono font-bold tracking-widest text-slate-500 uppercase">
            {getHeaderTitle()}
          </span>
        )}
      </div>

      {/* Panels */}
      {panel === "files" && (
        <FilesPanel
          workspaceId={workspaceId || ""}
          workspacePath={workspacePath}
          rootEntries={rootEntries}
          expandedFolders={expandedFolders}
          childEntries={childEntries}
          activeFilePath={activeFilePath}
          isLoading={isLoadingTree}
          onFileSelect={handleFileSelect}
          onToggleFolder={handleToggleFolder}
          onRefresh={() => fetchDirectory()}
          onCreateEntry={handleCreateEntry}
          onRenameEntry={handleRenameEntry}
          onDeleteEntry={handleDeleteEntry}
        />
      )}

      {panel === "editor" && (
        <FileEditorPanel
          activeFile={activeFile}
          activeFilePath={activeFilePath}
          editorContent={editorContent}
          isDirty={isDirty}
          workspacePath={workspacePath}
          isSaving={isSaving}
          isLoading={isLoadingFile}
          isMobile={true}
          onContentChange={(content) => {
            setEditorContent(content);
            setIsDirty(true);
          }}
          onSave={handleSave}
          onCloseTab={handleCloseTab}
        />
      )}

      {/* Bottom padding for nav bar */}
      <div className="h-14 flex-shrink-0" />
    </div>
  );
}
