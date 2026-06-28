/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import {
  History
} from "lucide-react";
import WorkspaceSidebar from "./components/WorkspaceSidebar";
import ThreadList from "./components/ThreadList";
import ChatCanvas from "./components/ChatCanvas";
import { WorkspaceModal, SettingsModal } from "./components/Dialogs";
import { Workspace, Thread, Message } from "./types";

export default function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>("");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState<string>("");

  // Navigation / views
  const [activeView, setActiveView] = useState<'threads' | 'activity'>('threads');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [globalLogs, setGlobalLogs] = useState<string[]>([]);
  const [threadLogs, setThreadLogs] = useState<Record<string, any[]>>({});
  const threadSseRef = useRef<EventSource | null>(null);
  const globalSseRef = useRef<EventSource | null>(null);

  // Dialog states (workspace modal)
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");

  const [showSettingsModal, setShowSettingsModal] = useState(false);

  const [isLoading, setIsLoading] = useState(true);

  // Helper: Load initial database values from Express API
  const fetchWorkspaces = async () => {
    try {
      const res = await fetch("/api/workspaces");
      if (res.ok) {
        const data = await res.json();
        setWorkspaces(data);
        if (data.length > 0 && !activeWorkspaceId) {
          setActiveWorkspaceId(data[0].id);
        }
      }
    } catch (e) {
      console.error("API error fetching workspaces, using local simulation fallback", e);
    }
  };

  const fetchThreads = async (workspaceId: string) => {
    if (!workspaceId) return;
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/threads`);
      if (res.ok) {
        const data = await res.json();
        setThreads(data);
        if (data.length > 0) {
          const currentExists = data.some((t: Thread) => t.id === activeThreadId);
          if (!currentExists) {
            setActiveThreadId(data[0].id);
          }
        } else {
          setActiveThreadId("");
          setMessages([]);
        }
      }
    } catch (e) {
      console.error("API error fetching threads", e);
    }
  };

  const fetchMessages = async (threadId: string) => {
    if (!threadId) return;
    try {
      const res = await fetch(`/api/threads/${threadId}/messages`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data);
      }
    } catch (e) {
      console.error("API error fetching messages", e);
    }
  };

  // Run on mount
  useEffect(() => {
    const initialize = async () => {
      setIsLoading(true);
      await fetchWorkspaces();
      setIsLoading(false);
    };
    initialize();
  }, []);

  // SSE: Thread log streaming for active thread
  useEffect(() => {
    if (threadSseRef.current) {
      threadSseRef.current.close();
      threadSseRef.current = null;
    }
    if (!activeThreadId) return;

    const es = new EventSource(`/api/threads/${activeThreadId}/logs`);
    threadSseRef.current = es;

    es.onmessage = (event) => {
      try {
        const log = JSON.parse(event.data);
        setThreadLogs(prev => ({
          ...prev,
          [activeThreadId]: [log, ...(prev[activeThreadId] || [])],
        }));
      } catch {}
    };

    return () => {
      es.close();
      threadSseRef.current = null;
    };
  }, [activeThreadId]);

  // SSE: Global activity log streaming
  useEffect(() => {
    const es = new EventSource("/api/logs");
    globalSseRef.current = es;

    es.onmessage = (event) => {
      try {
        const log = JSON.parse(event.data);
        if (log.thread_id) {
          setGlobalLogs(prev => [
            `[${new Date(log.timestamp).toLocaleTimeString()}] [${log.component}:${log.thread_id.slice(0, 12)}] ${log.message}`,
            ...prev
          ]);
        }
      } catch {}
    };

    return () => {
      es.close();
      globalSseRef.current = null;
    };
  }, []);

  // Update threads when active workspace changes
  useEffect(() => {
    if (activeWorkspaceId) {
      fetchThreads(activeWorkspaceId);
    }
  }, [activeWorkspaceId]);

  // Update messages when active thread changes
  useEffect(() => {
    if (activeThreadId) {
      fetchMessages(activeThreadId);
    } else {
      setMessages([]);
    }
  }, [activeThreadId]);

  const activeThread = threads.find(t => t.id === activeThreadId) || null;
  const activeThreadStatus = activeThread?.status;
  const activeThreadLogs = activeThreadId ? (threadLogs[activeThreadId] || []) : [];

  const handleClearThreadLogs = () => {
    if (activeThreadId) {
      setThreadLogs(prev => ({ ...prev, [activeThreadId]: [] }));
    }
  };

  // Polling
  useEffect(() => {
    const interval = setInterval(() => {
      if (activeThreadId) {
        fetchMessages(activeThreadId);
      }
      if (activeWorkspaceId) {
        fetchThreads(activeWorkspaceId);
      }
    }, activeThreadStatus === 'awaiting_permission' || activeThreadStatus === 'thinking' ? 1000 : 4000);
    return () => clearInterval(interval);
  }, [activeThreadId, activeWorkspaceId, activeThreadStatus]);

  // Handle Workspace creation/edit
  const handleWorkspaceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceName.trim()) return;

    try {
      if (editingWorkspace) {
        const res = await fetch(`/api/workspaces/${editingWorkspace.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: workspaceName })
        });
        if (res.ok) {
          const data = await res.json();
          setWorkspaces(prev => prev.map(w => w.id === data.id ? data : w));
          setGlobalLogs(prev => [
            `[${new Date().toLocaleTimeString()}] Updated workspace: ${workspaceName}`,
            ...prev
          ]);
        }
      } else {
        const res = await fetch("/api/workspaces", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: workspaceName, path: workspacePath })
        });
        if (res.ok) {
          const data = await res.json();
          setWorkspaces(prev => [...prev, data]);
          setActiveWorkspaceId(data.id);
          setGlobalLogs(prev => [
            `[${new Date().toLocaleTimeString()}] Registered new local workspace project: ${workspaceName}`,
            ...prev
          ]);
        }
      }
      setWorkspaceName("");
      setWorkspacePath("");
      setEditingWorkspace(null);
      setShowWorkspaceModal(false);
    } catch (e) {
      console.error(e);
    }
  };

  // Open edit modal for a workspace
  const handleOpenEditWorkspace = (workspaceId: string) => {
    const ws = workspaces.find(w => w.id === workspaceId);
    if (!ws) return;
    setEditingWorkspace(ws);
    setWorkspaceName(ws.name);
    setWorkspacePath(ws.path);
    setShowWorkspaceModal(true);
  };

  // Open new workspace modal
  const handleOpenNewWorkspace = () => {
    setEditingWorkspace(null);
    setWorkspaceName("");
    setWorkspacePath("");
    setShowWorkspaceModal(true);
  };

  // Handle Thread creation (no modal — direct creation)
  const handleCreateThreadQuick = async () => {
    if (!activeWorkspaceId) return;

    try {
      const res = await fetch(`/api/workspaces/${activeWorkspaceId}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled" })
      });
      if (res.ok) {
        const data = await res.json();
        setThreads(prev => [...prev, data]);
        setActiveThreadId(data.id);

        setGlobalLogs(prev => [
          `[${new Date().toLocaleTimeString()}] Initialized Claude ACP process thread`,
          ...prev
        ]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Handle Thread rename
  const handleRenameThread = async (threadId: string, newTitle: string) => {
    try {
      const res = await fetch(`/api/threads/${threadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle })
      });
      if (res.ok) {
        setThreads(prev => prev.map(t => t.id === threadId ? { ...t, title: newTitle } : t));
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Handle Thread deletion
  const handleDeleteThread = async (threadId: string) => {
    try {
      const res = await fetch(`/api/threads/${threadId}`, { method: "DELETE" });
      if (res.ok) {
        setThreads(prev => prev.filter(t => t.id !== threadId));
        if (activeThreadId === threadId) {
          setActiveThreadId("");
          setMessages([]);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Handle Workspace deletion
  const handleDeleteWorkspace = async (workspaceId: string) => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}`, { method: "DELETE" });
      if (res.ok) {
        setWorkspaces(prev => prev.filter(w => w.id !== workspaceId));
        if (activeWorkspaceId === workspaceId) {
          const remaining = workspaces.filter(w => w.id !== workspaceId);
          setActiveWorkspaceId(remaining.length > 0 ? remaining[0].id : "");
          setThreads([]);
          setMessages([]);
          setActiveThreadId("");
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Send message
  const handleSendMessage = async () => {
    if (!inputText.trim() || !activeThreadId) return;

    const messageText = inputText;
    setInputText("");

    try {
      const res = await fetch(`/api/threads/${activeThreadId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: messageText })
      });
      if (res.ok) {
        await fetchMessages(activeThreadId);
        await fetchThreads(activeWorkspaceId);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Handle permission response from ACP permission request
  const handlePermissionResponse = async (optionId: string, toolCommand?: string) => {
    if (!activeThreadId) return;
    try {
      const res = await fetch(`/api/threads/${activeThreadId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionId, toolCommand })
      });
      if (res.ok) {
        setGlobalLogs(prev => [
          `[${new Date().toLocaleTimeString()}] Permission response sent: ${optionId}`,
          ...prev
        ]);
        await fetchMessages(activeThreadId);
        await fetchThreads(activeWorkspaceId);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Cancel agent turn
  const handleCancelAgent = async () => {
    if (!activeThreadId) return;
    try {
      const res = await fetch(`/api/threads/${activeThreadId}/cancel`, {
        method: "POST",
      });
      if (res.ok) {
        setGlobalLogs(prev => [
          `[${new Date().toLocaleTimeString()}] Agent turn cancelled`,
          ...prev
        ]);
        await fetchMessages(activeThreadId);
        await fetchThreads(activeWorkspaceId);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Deploy Cloud Run action simulation
  const handleDeploy = () => {
    setIsDeploying(true);
    setGlobalLogs(prev => [
      `[${new Date().toLocaleTimeString()}] Initiating GCP Cloud Run service deployment...`,
      ...prev
    ]);

    setTimeout(() => {
      setIsDeploying(false);
      setGlobalLogs(prev => [
        `[${new Date().toLocaleTimeString()}] GCP Cloud Run deployment successful! Service URL: https://devos-runner-4876.run.app`,
        ...prev
      ]);
      alert("Deployment Successful! Service initialized on Cloud Run: https://devos-runner-4876.run.app");
    }, 2500);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0B0B0C] text-[#e4e2e4] font-sans antialiased">
      {/* COLUMN 1: WORKSPACE SIDEBAR */}
      <WorkspaceSidebar
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        onSelectWorkspace={(id) => {
          setActiveWorkspaceId(id);
          setActiveView('threads');
        }}
        onOpenNewWorkspace={handleOpenNewWorkspace}
        onEditWorkspace={handleOpenEditWorkspace}
        onDeleteWorkspace={handleDeleteWorkspace}
        activeView={activeView}
        onSelectView={setActiveView}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        onOpenSettings={() => setShowSettingsModal(true)}
      />

      {/* RENDER CONTENT PANELS ACCORDING TO NAVIGATION STATE */}
      {activeView === 'threads' && (
        <>
          {/* COLUMN 2: THREADS SELECTOR */}
          <ThreadList
            threads={threads}
            activeThreadId={activeThreadId}
            onSelectThread={setActiveThreadId}
            onOpenNewThread={handleCreateThreadQuick}
            onRenameThread={handleRenameThread}
            onDeleteThread={handleDeleteThread}
          />

          {/* COLUMN 3: MAIN CHAT CANVAS */}
          <ChatCanvas
            activeThread={activeThread}
            messages={messages}
            inputText={inputText}
            onChangeInput={setInputText}
            onSendMessage={handleSendMessage}
            onCancelAgent={handleCancelAgent}
            onPermissionResponse={handlePermissionResponse}
            onDeploy={handleDeploy}
            isDeploying={isDeploying}
            threadLogs={activeThreadLogs}
            onClearThreadLogs={handleClearThreadLogs}
          />
        </>
      )}

      {/* GLOBAL LOGS VIEW PANEL */}
      {activeView === 'activity' && (
        <main className="flex-1 flex flex-col bg-[#0B0B0C] overflow-hidden p-8 animate-fadeIn">
          <div className="max-w-4xl w-full mx-auto space-y-6 flex flex-col h-full">
            <div className="flex items-center gap-2 select-none pb-4 border-b border-white/5 justify-between shrink-0">
              <div className="flex items-center gap-2">
                <History className="text-emerald-400" size={24} />
                <h2 className="font-sans font-bold text-xl text-white">Global DevOS Activity Audit Trail</h2>
              </div>
              <button
                onClick={() => setGlobalLogs([])}
                className="text-xs text-rose-400 hover:text-rose-300 hover:underline cursor-pointer"
              >
                Clear Log History
              </button>
            </div>

            <div className="flex-1 bg-black/40 rounded-xl border border-white/5 p-6 font-mono text-xs text-slate-400 space-y-2 overflow-y-auto custom-scrollbar shadow-2xl">
              {globalLogs.length === 0 ? (
                <p className="text-slate-600 italic text-center py-12 font-sans">No diagnostic activities logged in current session.</p>
              ) : (
                globalLogs.map((log, i) => (
                  <p key={i} className="leading-relaxed border-b border-white/5 pb-1.5 last:border-none">
                    <span className="text-emerald-500 font-bold mr-2">&gt;&gt;</span>
                    {log}
                  </p>
                ))
              )}
            </div>
          </div>
        </main>
      )}

      {/* --- MODAL DIALOGS --- */}
      <WorkspaceModal
        isOpen={showWorkspaceModal}
        onClose={() => setShowWorkspaceModal(false)}
        editingWorkspace={editingWorkspace}
        name={workspaceName}
        setName={setWorkspaceName}
        path={workspacePath}
        setPath={setWorkspacePath}
        onSubmit={handleWorkspaceSubmit}
      />

      <SettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
      />
    </div>
  );
}
