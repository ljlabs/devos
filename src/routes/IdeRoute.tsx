import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { FileEntry, FileContent } from "../types";
import FilesPanel from "../components/ide/FilesPanel";
import FileEditorPanel from "../components/ide/FileEditorPanel";

interface EditorTab {
  path: string;
  file: FileContent | null;
  content: string;
  isDirty: boolean;
}

export default function IdeRoute() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const activeWorkspaceId = workspaceId || "";

  const [rootEntries, setRootEntries] = useState<FileEntry[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [childEntries, setChildEntries] = useState<Record<string, FileEntry[]>>({});
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState<number>(0);

  const fetchDirectory = useCallback(async (relativePath?: string) => {
    if (!activeWorkspaceId) return;
    try {
      const url = relativePath
        ? `/api/workspaces/${activeWorkspaceId}/files?path=${encodeURIComponent(relativePath)}`
        : `/api/workspaces/${activeWorkspaceId}/files`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (relativePath) setChildEntries((prev) => ({ ...prev, [relativePath]: data.entries }));
        else setRootEntries(data.entries);
      }
    } catch (e) { console.error("Error fetching directory", e); }
  }, [activeWorkspaceId]);

  const fetchFileContent = useCallback(async (relativePath: string) => {
    if (!activeWorkspaceId) return;
    const existingIndex = tabs.findIndex((t) => t.path === relativePath);
    if (existingIndex >= 0) { setActiveTabIndex(existingIndex); return; }
    setIsLoadingFile(true);
    try {
      const res = await fetch(`/api/workspaces/${activeWorkspaceId}/files/read?path=${encodeURIComponent(relativePath)}`);
      if (res.ok) {
        const data: FileContent = await res.json();
        setTabs((prev) => [...prev, { path: relativePath, file: data, content: data.content, isDirty: false }]);
        setActiveTabIndex(tabs.length);
      }
    } catch (e) { console.error("Error fetching file", e); }
    finally { setIsLoadingFile(false); }
  }, [activeWorkspaceId, tabs]);

  const handleSave = useCallback(async () => {
    const tab = tabs[activeTabIndex];
    if (!activeWorkspaceId || !tab?.path) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/workspaces/${activeWorkspaceId}/files/write`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: tab.path, content: tab.content }),
      });
      if (res.ok) { const data: FileContent = await res.json(); setTabs((prev) => prev.map((t, i) => (i === activeTabIndex ? { ...t, file: data, isDirty: false } : t))); }
    } catch (e) { console.error("Error saving file", e); }
    finally { setIsSaving(false); }
  }, [activeWorkspaceId, tabs, activeTabIndex]);

  const handleToggleFolder = useCallback(async (folderPath: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else { next.add(folderPath); if (!childEntries[folderPath]) fetchDirectory(folderPath); }
      return next;
    });
  }, [childEntries, fetchDirectory]);

  useEffect(() => {
    if (activeWorkspaceId) {
      setRootEntries([]); setExpandedFolders(new Set()); setChildEntries({}); setTabs([]); setActiveTabIndex(0);
      fetchDirectory();
    }
  }, [activeWorkspaceId, fetchDirectory]);

  return (
    <>
      <div className="hidden md:flex md:w-64">
        <div className="flex-1 flex flex-col bg-[#0E0E11] border-r border-white/5 h-screen">
          <FilesPanel
            workspaceId={activeWorkspaceId}
            rootEntries={rootEntries}
            expandedFolders={expandedFolders}
            childEntries={childEntries}
            activeFilePath={tabs[activeTabIndex]?.path || ""}
            isLoading={false}
            onFileSelect={(entry) => { if (entry.type === "file") fetchFileContent(entry.path); }}
            onToggleFolder={handleToggleFolder}
            onRefresh={() => fetchDirectory()}
          />
        </div>
      </div>
      <div className="flex-1 flex flex-col overflow-hidden">
        <FileEditorPanel
          tabs={tabs}
          activeTabIndex={activeTabIndex}
          isSaving={isSaving}
          isLoading={isLoadingFile}
          onContentChange={(content) => { setTabs((prev) => prev.map((t, i) => (i === activeTabIndex ? { ...t, content, isDirty: true } : t))); }}
          onSave={handleSave}
          onCloseTab={(idx) => {
            setTabs((prev) => {
              const next = prev.filter((_, i) => i !== idx);
              setActiveTabIndex((prevIdx) => { if (idx < prevIdx) return prevIdx - 1; if (idx === prevIdx) return Math.min(prevIdx, next.length - 1); return prevIdx; });
              return next;
            });
          }}
          onTabChange={setActiveTabIndex}
        />
      </div>
    </>
  );
}
