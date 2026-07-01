/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ThreadsPage — mobile route: /messages/:workspaceId
 * Lists threads for the workspace. Selecting one navigates to /messages/:workspaceId/:threadId.
 */

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import MobileThreadList from "../components/MobileThreadList";
import MobileBottomNav from "../components/MobileBottomNav";
import MobileIdeView from "../components/MobileIdeView";
import { WorkspaceModal } from "../components/Dialogs";
import { Workspace, Thread, IdePanel } from "../types";

export default function ThreadsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);

  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");

  const [idePanel, setIdePanel] = useState<IdePanel>("chat");

  // Fetch workspaces for the header/edit context
  useEffect(() => {
    fetch("/api/workspaces")
      .then(r => r.ok ? r.json() : [])
      .then(setWorkspaces)
      .catch(console.error);
  }, []);

  // Fetch threads for this workspace
  const fetchThreads = useCallback(() => {
    if (!workspaceId) return;
    fetch(`/api/workspaces/${workspaceId}/threads`)
      .then(r => r.ok ? r.json() : [])
      .then(setThreads)
      .catch(console.error);
  }, [workspaceId]);

  useEffect(() => { fetchThreads(); }, [fetchThreads]);

  const handleCreateThread = async () => {
    if (!workspaceId) return;
    const res = await fetch(`/api/workspaces/${workspaceId}/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Untitled" }),
    });
    if (res.ok) {
      const data: Thread = await res.json();
      navigate(`/messages/${workspaceId}/${data.id}`);
    }
  };

  const handleRenameThread = async (threadId: string, newTitle: string) => {
    const res = await fetch(`/api/threads/${threadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle }),
    });
    if (res.ok) setThreads(prev => prev.map(t => t.id === threadId ? { ...t, title: newTitle } : t));
  };

  const handleDeleteThread = async (threadId: string) => {
    const res = await fetch(`/api/threads/${threadId}`, { method: "DELETE" });
    if (res.ok) setThreads(prev => prev.filter(t => t.id !== threadId));
  };

  const handleWorkspaceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingWorkspace || !workspaceName.trim()) return;
    const res = await fetch(`/api/workspaces/${editingWorkspace.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: workspaceName }),
    });
    if (res.ok) {
      const data = await res.json();
      setWorkspaces(prev => prev.map(w => w.id === data.id ? data : w));
      setShowWorkspaceModal(false);
    } else {
      setWorkspaceError((await res.json()).error || "Failed to update");
    }
  };

  return (
    <div className="w-screen bg-[#0B0B0C] text-[#e4e2e4] font-sans antialiased" style={{ height: '100dvh', position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Main content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {idePanel === "chat" && (
          <MobileThreadList
            threads={threads}
            activeThreadId=""
            activeWorkspaceId={workspaceId || ""}
            workspaces={workspaces}
            onSelectThread={(id) => navigate(`/messages/${workspaceId}/${id}`)}
            onCreateThread={handleCreateThread}
            onRenameThread={handleRenameThread}
            onDeleteThread={handleDeleteThread}
            onBack={() => navigate("/")}
            onEditWorkspace={(id) => {
              const ws = workspaces.find(w => w.id === id);
              if (!ws) return;
              setEditingWorkspace(ws); setWorkspaceName(ws.name); setWorkspacePath(ws.path);
              setShowWorkspaceModal(true);
            }}
          />
        )}
        {(idePanel === "files" || idePanel === "editor" || idePanel === "terminal") && (
          <MobileIdeView
            panel={idePanel}
            workspaceId={workspaceId || ""}
            onBack={() => setIdePanel("chat")}
          />
        )}
      </div>

      {/* Bottom nav */}
      <MobileBottomNav
        active={idePanel}
        onChange={setIdePanel}
        hasActiveThread={false}
      />

      {/* Workspace modal */}
      <WorkspaceModal
        isOpen={showWorkspaceModal}
        onClose={() => { setShowWorkspaceModal(false); setWorkspaceError(""); }}
        editingWorkspace={editingWorkspace}
        name={workspaceName}
        setName={setWorkspaceName}
        path={workspacePath}
        setPath={setWorkspacePath}
        onSubmit={handleWorkspaceSubmit}
        error={workspaceError}
        setError={setWorkspaceError}
      />
    </div>
  );
}
