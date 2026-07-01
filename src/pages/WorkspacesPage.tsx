/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WorkspacesPage — mobile route: /
 * Lists all workspaces. Selecting one navigates to /messages/:workspaceId.
 */

import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import MobileWorkspaceSidebar from "../components/MobileWorkspaceSidebar";
import { WorkspaceModal, SettingsModal } from "../components/Dialogs";
import { Workspace } from "../types";

export default function WorkspacesPage() {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);

  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  useEffect(() => {
    fetch("/api/workspaces")
      .then(r => r.ok ? r.json() : [])
      .then(setWorkspaces)
      .catch(console.error);
  }, []);

  const handleWorkspaceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceName.trim()) return;
    try {
      if (editingWorkspace) {
        const res = await fetch(`/api/workspaces/${editingWorkspace.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: workspaceName }),
        });
        if (res.ok) {
          const data = await res.json();
          setWorkspaces(prev => prev.map(w => w.id === data.id ? data : w));
        } else {
          setWorkspaceError((await res.json()).error || "Failed to update workspace");
          return;
        }
      } else {
        const res = await fetch("/api/workspaces", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: workspaceName, path: workspacePath }),
        });
        if (res.ok) {
          const data = await res.json();
          setWorkspaces(prev => [...prev, data]);
          navigate(`/messages/${data.id}`);
        } else {
          setWorkspaceError((await res.json()).error || "Failed to create workspace");
          return;
        }
      }
      setWorkspaceName(""); setWorkspacePath(""); setWorkspaceError("");
      setEditingWorkspace(null); setShowWorkspaceModal(false);
    } catch (e) {
      setWorkspaceError(e instanceof Error ? e.message : "Unexpected error");
    }
  };

  const handleDeleteWorkspace = async (id: string) => {
    const res = await fetch(`/api/workspaces/${id}`, { method: "DELETE" });
    if (res.ok) setWorkspaces(prev => prev.filter(w => w.id !== id));
  };

  return (
    <div className="w-screen bg-[#0B0B0C] text-[#e4e2e4] font-sans antialiased" style={{ height: '100dvh', position: 'fixed', inset: 0 }}>
      <MobileWorkspaceSidebar
        workspaces={workspaces}
        activeWorkspaceId=""
        onSelectWorkspace={(id) => navigate(`/messages/${id}`)}
        onOpenNewWorkspace={() => {
          setEditingWorkspace(null); setWorkspaceName(""); setWorkspacePath("");
          setShowWorkspaceModal(true);
        }}
        onEditWorkspace={(id) => {
          const ws = workspaces.find(w => w.id === id);
          if (!ws) return;
          setEditingWorkspace(ws); setWorkspaceName(ws.name); setWorkspacePath(ws.path);
          setShowWorkspaceModal(true);
        }}
        onDeleteWorkspace={handleDeleteWorkspace}
        onOpenSettings={() => setShowSettingsModal(true)}
      />

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
      <SettingsModal isOpen={showSettingsModal} onClose={() => setShowSettingsModal(false)} />
    </div>
  );
}
