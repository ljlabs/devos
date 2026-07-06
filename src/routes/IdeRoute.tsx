import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { FileEntry, FileContent, Workspace } from "../types";
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

  const [workspacePath, setWorkspacePath] = useState<string>("");
  const [rootEntries, setRootEntries] = useState<FileEntry[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [childEntries, setChildEntries] = useState<Record<string, FileEntry[]>>({});
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState<number>(0);

  // Fetch workspace path
  useEffect(() => {
    if (!activeWorkspaceId) return;
    fetch("/api/workspaces")
      .then((res) => res.json())
      .then((workspaces: Workspace[]) => {
        const ws = workspaces.find((w) => w.id === activeWorkspaceId);
        if (ws) setWorkspacePath(ws.path);
      })
      .catch(() => {});
  }, [activeWorkspaceId]);

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

  const handleCreateEntry = useCallback(async (parentPath: string, name: string, type: "file" | "directory") => {
    const fullPath = parentPath ? `${parentPath}/${name}` : name;
    try {
      const res = await fetch(`/api/workspaces/${activeWorkspaceId}/files/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: fullPath, type }),
      });
      if (res.ok) {
        if (parentPath) await fetchDirectory(parentPath);
        else await fetchDirectory();
        if (type === "file") await fetchFileContent(fullPath);
      }
    } catch (e) { console.error("Error creating entry", e); }
  }, [activeWorkspaceId, fetchDirectory, fetchFileContent]);

  const handleRenameEntry = useCallback(async (oldPath: string, newName: string) => {
    try {
      const res = await fetch(`/api/workspaces/${activeWorkspaceId}/files/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPath, newName }),
      });
      if (res.ok) {
        const parentPath = oldPath.substring(0, oldPath.lastIndexOf("/"));
        if (parentPath) await fetchDirectory(parentPath);
        else await fetchDirectory();
        const newPath = parentPath ? `${parentPath}/${newName}` : newName;
        setTabs((prev) => prev.map((t) => t.path === oldPath ? { ...t, path: newPath } : t));
      }
    } catch (e) { console.error("Error renaming entry", e); }
  }, [activeWorkspaceId, fetchDirectory]);

  const handleDeleteEntry = useCallback(async (entryPath: string) => {
    try {
      const res = await fetch(`/api/workspaces/${activeWorkspaceId}/files/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: entryPath }),
      });
      if (res.ok) {
        const parentPath = entryPath.substring(0, entryPath.lastIndexOf("/"));
        if (parentPath) await fetchDirectory(parentPath);
        else await fetchDirectory();
        setTabs((prev) => {
          const index = prev.findIndex((t) => t.path === entryPath);
          if (index >= 0) return prev.filter((_, i) => i !== index);
          return prev;
        });
      }
    } catch (e) { console.error("Error deleting entry", e); }
  }, [activeWorkspaceId, fetchDirectory]);

  const handleMoveEntry = useCallback(async (sourcePath: string, destParentPath: string) => {
    console.log(`[IdeRoute] handleMoveEntry called: ${sourcePath} → ${destParentPath}`);
    try {
      const res = await fetch(`/api/workspaces/${activeWorkspaceId}/files/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePath, destParentPath }),
      });
      console.log(`[IdeRoute] move API response status: ${res.status}`);
      if (res.ok) {
        console.log(`[IdeRoute] move successful, refreshing directories`);
        // Refresh source parent directory
        const srcParentPath = sourcePath.substring(0, sourcePath.lastIndexOf("/"));
        if (srcParentPath) {
          console.log(`[IdeRoute] refreshing source parent: ${srcParentPath}`);
          await fetchDirectory(srcParentPath);
        } else {
          console.log(`[IdeRoute] refreshing source root`);
          await fetchDirectory();
        }
        // Refresh destination directory
        console.log(`[IdeRoute] refreshing destination: ${destParentPath}`);
        await fetchDirectory(destParentPath);
        // Update open tab if the moved file was open
        const fileName = sourcePath.substring(sourcePath.lastIndexOf("/") + 1);
        const newPath = destParentPath ? `${destParentPath}/${fileName}` : fileName;
        console.log(`[IdeRoute] updating tabs: ${sourcePath} → ${newPath}`);
        setTabs((prev) =>
          prev.map((t) =>
            t.path === sourcePath ? { ...t, path: newPath } : t
          )
        );
      } else {
        const error = await res.json();
        console.error(`[IdeRoute] move failed: ${error.error}`);
      }
    } catch (e) {
      console.error("Error moving entry:", e);
    }
  }, [activeWorkspaceId, fetchDirectory]);

  useEffect(() => {
    if (activeWorkspaceId) {
      setRootEntries([]); setExpandedFolders(new Set()); setChildEntries({}); setTabs([]); setActiveTabIndex(0);
      fetchDirectory();
    }
  }, [activeWorkspaceId, fetchDirectory]);

  return (
    <>
      {/* File Browser - 25% of IDE width */}
      <div className="hidden md:flex md:w-1/4 md:min-w-[300px]">
        <div className="flex-1 flex flex-col bg-[#0E0E11] border-r border-white/5 h-screen overflow-hidden">
          <FilesPanel
            workspaceId={activeWorkspaceId}
            workspacePath={workspacePath}
            rootEntries={rootEntries}
            expandedFolders={expandedFolders}
            childEntries={childEntries}
            activeFilePath={tabs[activeTabIndex]?.path || ""}
            isLoading={false}
            onFileSelect={(entry) => { if (entry.type === "file") fetchFileContent(entry.path); }}
            onToggleFolder={handleToggleFolder}
            onRefresh={() => fetchDirectory()}
            onCreateEntry={handleCreateEntry}
            onRenameEntry={handleRenameEntry}
            onDeleteEntry={handleDeleteEntry}
            onMoveEntry={handleMoveEntry}
          />
        </div>
      </div>
      {/* Editor - remaining width */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <FileEditorPanel
          tabs={tabs}
          activeTabIndex={activeTabIndex}
          workspacePath={workspacePath}
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
