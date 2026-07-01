/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WorkspaceIdeView — desktop IDE layout
 * Uses shared FileEditorPanel, FilesPanel, TerminalPanel
 */

import React, { useState, useEffect, useCallback } from "react";
import { X } from "lucide-react";
import { FileEntry, FileContent } from "../types";
import FileEditorPanel from "./ide/FileEditorPanel";
import FilesPanel from "./ide/FilesPanel";
import TerminalPanel from "./ide/TerminalPanel";

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
  const [activeTab, setActiveTab] = useState<"files" | "editor" | "terminal">("files");
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
          setActiveTab("editor");
        }
      } catch (e) {
        console.error("Error fetching file", e);
      } finally {
        setIsLoadingFile(false);
      }
    },
    [workspaceId]
  );

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
    if (workspaceId) {
      setRootEntries([]);
      setExpandedFolders(new Set());
      setChildEntries({});
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
        {["files", "editor", "terminal"].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as "files" | "editor" | "terminal")}
            className={`px-3 py-2 text-xs font-medium rounded-md transition-colors ${
              activeTab === tab
                ? "bg-emerald-400/10 text-emerald-400"
                : "text-slate-400 hover:text-white hover:bg-white/5"
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            {tab === "editor" && isDirty && <span className="w-1 h-1 bg-amber-400 rounded-full ml-1 inline-block" />}
          </button>
        ))}
      </div>

      {/* Content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeTab === "files" && (
          <FilesPanel
            workspaceId={workspaceId}
            rootEntries={rootEntries}
            expandedFolders={expandedFolders}
            childEntries={childEntries}
            activeFilePath={activeFilePath}
            isLoading={isLoadingTree}
            onFileSelect={handleFileSelect}
            onToggleFolder={handleToggleFolder}
            onRefresh={() => fetchDirectory()}
          />
        )}

        {activeTab === "editor" && (
          <FileEditorPanel
            activeFile={activeFile}
            activeFilePath={activeFilePath}
            editorContent={editorContent}
            isDirty={isDirty}
            isSaving={isSaving}
            isLoading={isLoadingFile}
            onContentChange={(content) => {
              setEditorContent(content);
              setIsDirty(true);
            }}
            onSave={handleSave}
            onCloseTab={handleCloseTab}
          />
        )}

        {activeTab === "terminal" && (
          <TerminalPanel workspaceId={workspaceId} />
        )}
      </div>
    </div>
  );
}
