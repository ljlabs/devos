/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WorkspaceIdeView — desktop IDE layout
 * Uses shared FileEditorPanel, FilesPanel
 */

import React, { useState, useEffect, useCallback } from "react";
import { X } from "lucide-react";
import { FileEntry, FileContent } from "../types";
import FileEditorPanel from "./ide/FileEditorPanel";
import FilesPanel from "./ide/FilesPanel";

interface EditorTab {
  path: string;
  file: FileContent | null;
  content: string;
  isDirty: boolean;
}

interface WorkspaceIdeViewProps {
  workspaceId: string;
  workspacePath?: string;
  onClose: () => void;
}

export default function WorkspaceIdeView({
  workspaceId,
  workspacePath,
  onClose,
}: WorkspaceIdeViewProps) {
  const [activeTab, setActiveTab] = useState<"files" | "editor">("files");
  const [rootEntries, setRootEntries] = useState<FileEntry[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [childEntries, setChildEntries] = useState<Record<string, FileEntry[]>>({});
  const [isLoadingTree, setIsLoadingTree] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Multi-tab editor state
  const [editorTabs, setEditorTabs] = useState<EditorTab[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState<number>(0);

  const fetchDirectory = useCallback(
    async (relativePath?: string) => {
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
    },
    [workspaceId]
  );

  const fetchFileContent = useCallback(
    async (relativePath: string) => {
      if (!workspaceId) return;

      // Check if file is already open in a tab
      const existingIndex = editorTabs.findIndex(t => t.path === relativePath);
      if (existingIndex >= 0) {
        setActiveTabIndex(existingIndex);
        setActiveTab("editor");
        return;
      }

      setIsLoadingFile(true);
      try {
        const res = await fetch(
          `/api/workspaces/${workspaceId}/files/read?path=${encodeURIComponent(relativePath)}`
        );
        if (res.ok) {
          const data: FileContent = await res.json();
          const newTab: EditorTab = {
            path: relativePath,
            file: data,
            content: data.content,
            isDirty: false,
          };
          setEditorTabs(prev => [...prev, newTab]);
          setActiveTabIndex(editorTabs.length); // index of new tab
          setActiveTab("editor");
        }
      } catch (e) {
        console.error("Error fetching file", e);
      } finally {
        setIsLoadingFile(false);
      }
    },
    [workspaceId, editorTabs]
  );

  const handleSave = useCallback(async () => {
    const tab = editorTabs[activeTabIndex];
    if (!workspaceId || !tab || !tab.path) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/files/write`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: tab.path, content: tab.content }),
      });
      if (res.ok) {
        const data: FileContent = await res.json();
        setEditorTabs(prev => prev.map((t, i) =>
          i === activeTabIndex ? { ...t, file: data, isDirty: false } : t
        ));
      }
    } catch (e) {
      console.error("Error saving file", e);
    } finally {
      setIsSaving(false);
    }
  }, [workspaceId, editorTabs, activeTabIndex]);

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
          // Refresh the parent directory
          if (parentPath) {
            await fetchDirectory(parentPath);
          } else {
            await fetchDirectory();
          }
          // If it's a file, open it
          if (type === "file") {
            await fetchFileContent(fullPath);
          }
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
          // Refresh the parent directory
          const parentPath = oldPath.substring(0, oldPath.lastIndexOf("/"));
          if (parentPath) {
            await fetchDirectory(parentPath);
          } else {
            await fetchDirectory();
          }
          // Update the open tab if the renamed file was open
          const newPath = parentPath ? `${parentPath}/${newName}` : newName;
          setEditorTabs((prev) =>
            prev.map((t) =>
              t.path === oldPath ? { ...t, path: newPath } : t
            )
          );
        }
      } catch (e) {
        console.error("Error renaming entry", e);
      }
    },
    [workspaceId, fetchDirectory]
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
          // Refresh the parent directory
          const parentPath = entryPath.substring(0, entryPath.lastIndexOf("/"));
          if (parentPath) {
            await fetchDirectory(parentPath);
          } else {
            await fetchDirectory();
          }
          // Close the tab if the deleted file was open
          setEditorTabs((prev) => {
            const index = prev.findIndex((t) => t.path === entryPath);
            if (index >= 0) {
              return prev.filter((_, i) => i !== index);
            }
            return prev;
          });
        }
      } catch (e) {
        console.error("Error deleting entry", e);
      }
    },
    [workspaceId, fetchDirectory]
  );

  const handleMoveEntry = useCallback(
    async (sourcePath: string, destParentPath: string) => {
      console.log(`[WorkspaceIdeView] handleMoveEntry called: ${sourcePath} → ${destParentPath}`);
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/files/move`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourcePath, destParentPath }),
        });
        console.log(`[WorkspaceIdeView] move API response status: ${res.status}`);
        if (res.ok) {
          console.log(`[WorkspaceIdeView] move successful, refreshing directories`);
          // Refresh source parent directory
          const srcParentPath = sourcePath.substring(0, sourcePath.lastIndexOf("/"));
          if (srcParentPath) {
            console.log(`[WorkspaceIdeView] refreshing source parent: ${srcParentPath}`);
            await fetchDirectory(srcParentPath);
          } else {
            console.log(`[WorkspaceIdeView] refreshing source root`);
            await fetchDirectory();
          }
          // Refresh destination directory
          console.log(`[WorkspaceIdeView] refreshing destination: ${destParentPath}`);
          await fetchDirectory(destParentPath);
          // Update open tab if the moved file was open
          const fileName = sourcePath.substring(sourcePath.lastIndexOf("/") + 1);
          const newPath = destParentPath ? `${destParentPath}/${fileName}` : fileName;
          console.log(`[WorkspaceIdeView] updating tabs: ${sourcePath} → ${newPath}`);
          setEditorTabs((prev) =>
            prev.map((t) =>
              t.path === sourcePath ? { ...t, path: newPath } : t
            )
          );
        } else {
          const error = await res.json();
          console.error(`[WorkspaceIdeView] move failed: ${error.error}`);
        }
      } catch (e) {
        console.error("Error moving entry:", e);
      }
    },
    [workspaceId, fetchDirectory]
  );

  const handleFileSelect = useCallback(
    (entry: FileEntry) => {
      if (entry.type === "file") {
        fetchFileContent(entry.path);
      }
    },
    [fetchFileContent]
  );

  const handleCloseTab = useCallback((indexToClose: number) => {
    setEditorTabs(prev => {
      const next = prev.filter((_, i) => i !== indexToClose);
      setActiveTabIndex(prevIdx => {
        if (indexToClose < prevIdx) return prevIdx - 1;
        if (indexToClose === prevIdx) return Math.min(prevIdx, next.length - 1);
        return prevIdx;
      });
      return next;
    });
  }, []);

  const handleTabChange = useCallback((index: number) => {
    setActiveTabIndex(index);
  }, []);

  useEffect(() => {
    if (workspaceId) {
      setRootEntries([]);
      setExpandedFolders(new Set());
      setChildEntries({});
      setEditorTabs([]);
      setActiveTabIndex(0);
      fetchDirectory();
    }
  }, [workspaceId, fetchDirectory]);

  return (
    <div className="flex flex-col w-full h-full bg-[#0B0B0C] border-l border-white/5">
      {/* Header */}
      <div className="flex items-center justify-between h-12 px-4 border-b border-white/5 bg-[#0E0E11]">
        <h2 className="text-sm font-bold text-white">IDE</h2>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-white/5 text-slate-400 hover:text-white transition-colors"
          title="Close IDE"
        >
          <X size={18} />
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-2 px-4 h-10 border-b border-white/5 bg-[#0B0B0C]">
        {["files", "editor"].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as "files" | "editor")}
            className={`px-3 py-2 text-xs font-medium rounded-md transition-colors ${
              activeTab === tab
                ? "bg-emerald-400/10 text-emerald-400"
                : "text-slate-400 hover:text-white hover:bg-white/5"
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            {tab === "editor" && editorTabs.some(t => t.isDirty) && (
              <span className="w-1 h-1 bg-amber-400 rounded-full ml-1 inline-block" />
            )}
          </button>
        ))}
      </div>

      {/* Content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeTab === "files" && (
          <FilesPanel
            workspaceId={workspaceId}
            workspacePath={workspacePath}
            rootEntries={rootEntries}
            expandedFolders={expandedFolders}
            childEntries={childEntries}
            activeFilePath={editorTabs[activeTabIndex]?.path || ""}
            isLoading={isLoadingTree}
            onFileSelect={handleFileSelect}
            onToggleFolder={handleToggleFolder}
            onRefresh={() => fetchDirectory()}
            onCreateEntry={handleCreateEntry}
            onRenameEntry={handleRenameEntry}
            onDeleteEntry={handleDeleteEntry}
            onMoveEntry={handleMoveEntry}
          />
        )}

        {activeTab === "editor" && (
          <FileEditorPanel
            tabs={editorTabs}
            activeTabIndex={activeTabIndex}
            workspacePath={workspacePath}
            isSaving={isSaving}
            isLoading={isLoadingFile}
            onContentChange={(content) => {
              setEditorTabs(prev => prev.map((t, i) =>
                i === activeTabIndex ? { ...t, content, isDirty: true } : t
              ));
            }}
            onSave={handleSave}
            onCloseTab={handleCloseTab}
            onTabChange={handleTabChange}
          />
        )}
      </div>
    </div>
  );
}
