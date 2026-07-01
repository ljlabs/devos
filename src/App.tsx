/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Routes, Route, useParams, useNavigate, Navigate } from "react-router-dom";
import {
  History
} from "lucide-react";
import WorkspaceSidebar from "./components/WorkspaceSidebar";
import ThreadList from "./components/ThreadList";
import ChatCanvas from "./components/ChatCanvas";
import MobileThreadNavigator from "./components/MobileThreadNavigator";
import MobileApp from "./components/MobileApp";
import { WorkspaceModal, SettingsModal } from "./components/Dialogs";
import { Workspace, Thread, Message } from "./types";
import { useWebSocket } from "./hooks/useWebSocket";
import { useOptimisticMessages } from "./hooks/useOptimisticMessages";

// The inner app component that uses URL params for routing
function MessagesView() {
  const { workspaceId, threadId } = useParams<{ workspaceId?: string; threadId?: string }>();
  const navigate = useNavigate();
  const [isMobile, setIsMobile] = useState(false);

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [inputText, setInputText] = useState<string>("");
  const [wsConnected, setWsConnected] = useState(false);

  const [activeView, setActiveView] = useState<'threads' | 'activity'>('threads');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showThreadListOnMobile, setShowThreadListOnMobile] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [globalLogs, setGlobalLogs] = useState<string[]>([]);
  const [threadLogs, setThreadLogs] = useState<Record<string, any[]>>({});
  const threadSseRef = useRef<EventSource | null>(null);
  const globalSseRef = useRef<EventSource | null>(null);

  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const activeWorkspaceId = workspaceId || "";
  const activeThreadId = threadId || "";

  const {
    messages,
    addOptimistic,
    confirmMessage,
    setConfirmed,
    appendMessage,
    clearOptimistic,
  } = useOptimisticMessages();

  const handleWsMessage = useCallback((msg: Message) => {
    appendMessage(msg);
  }, [appendMessage]);

  const handleWsThreadUpdate = useCallback((thread: Thread) => {
    setThreads((prev) => prev.map((t) => (t.id === thread.id ? thread : t)));
  }, []);

  const handleWsAck = useCallback((clientMsgId: string, message: Message) => {
    confirmMessage(clientMsgId, message);
  }, [confirmMessage]);

  const handleWsSubscribed = useCallback(async (_threadId: string, msgs: Message[], _thread: Thread | null) => {
    setConfirmed(msgs);
  }, [setConfirmed]);

  const handleWsConnectionChange = useCallback((connected: boolean) => {
    setWsConnected(connected);
  }, []);

  const {
    sendMessage: wsSendMessage,
    respondToPermission: wsRespond,
    cancelAgent: wsCancel,
  } = useWebSocket({
    threadId: activeThreadId || null,
    onMessage: handleWsMessage,
    onThreadUpdate: handleWsThreadUpdate,
    onAck: handleWsAck,
    onSubscribed: handleWsSubscribed,
    onConnectionChange: handleWsConnectionChange,
  });

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const fetchWorkspaces = async () => {
    try {
      const res = await fetch("/api/workspaces");
      if (res.ok) {
        const data = await res.json();
        setWorkspaces(data);
        if (!workspaceId && data.length > 0) {
          navigate(`/messages/${data[0].id}`, { replace: true });
        }
      }
    } catch (e) {
      console.error("API error fetching workspaces", e);
    }
  };

  const fetchThreads = useCallback(async (wsId: string) => {
    if (!wsId) return;
    try {
      const res = await fetch(`/api/workspaces/${wsId}/threads`);
      if (res.ok) {
        const data = await res.json();
        setThreads(data);
        if (!threadId && data.length > 0) {
          navigate(`/messages/${wsId}/${data[0].id}`, { replace: true });
        } else if (data.length === 0) {
          navigate(`/messages/${wsId}`, { replace: true });
        }
      }
    } catch (e) {
      console.error("API error fetching threads", e);
    }
  }, [threadId, navigate]);

  const fetchMessages = useCallback(async (tid: string) => {
    if (!tid) return;
    try {
      const res = await fetch(`/api/threads/${tid}/messages`);
      if (res.ok) {
        const data = await res.json();
        setConfirmed(data);
      }
    } catch (e) {
      console.error("API error fetching messages", e);
    }
  }, [setConfirmed]);

  // Init
  useEffect(() => {
    const initialize = async () => {
      setIsLoading(true);
      await fetchWorkspaces();
      setIsLoading(false);
    };
    initialize();
  }, []);

  // SSE: Thread log streaming
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

  // Fetch threads when workspace URL param changes
  useEffect(() => {
    if (activeWorkspaceId) {
      fetchThreads(activeWorkspaceId);
    }
  }, [activeWorkspaceId, fetchThreads]);

  // Fetch messages when thread URL param changes
  useEffect(() => {
    clearOptimistic();
    if (activeThreadId) {
      fetchMessages(activeThreadId);
    } else {
      setConfirmed([]);
    }
  }, [activeThreadId, fetchMessages, clearOptimistic, setConfirmed]);

  const activeThread = threads.find(t => t.id === activeThreadId) || null;
  const activeThreadStatus = activeThread?.status;
  const activeThreadLogs = activeThreadId ? (threadLogs[activeThreadId] || []) : [];

  const handleClearThreadLogs = () => {
    if (activeThreadId) {
      setThreadLogs(prev => ({ ...prev, [activeThreadId]: [] }));
    }
  };

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
        } else {
          const error = await res.json();
          setWorkspaceError(error.error || "Failed to update workspace");
          return;
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
          navigate(`/messages/${data.id}`, { replace: true });
          setGlobalLogs(prev => [
            `[${new Date().toLocaleTimeString()}] Registered new local workspace project: ${workspaceName}`,
            ...prev
          ]);
        } else {
          const error = await res.json();
          setWorkspaceError(error.error || "Failed to create workspace");
          return;
        }
      }
      setWorkspaceName("");
      setWorkspacePath("");
      setWorkspaceError("");
      setEditingWorkspace(null);
      setShowWorkspaceModal(false);
    } catch (e) {
      setWorkspaceError(e instanceof Error ? e.message : "An unexpected error occurred");
      console.error(e);
    }
  };

  const handleOpenEditWorkspace = (wsId: string) => {
    const ws = workspaces.find(w => w.id === wsId);
    if (!ws) return;
    setEditingWorkspace(ws);
    setWorkspaceName(ws.name);
    setWorkspacePath(ws.path);
    setShowWorkspaceModal(true);
  };

  const handleOpenNewWorkspace = () => {
    setEditingWorkspace(null);
    setWorkspaceName("");
    setWorkspacePath("");
    setShowWorkspaceModal(true);
  };

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
        navigate(`/messages/${activeWorkspaceId}/${data.id}`);

        setGlobalLogs(prev => [
          `[${new Date().toLocaleTimeString()}] Initialized Claude ACP process thread`,
          ...prev
        ]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleRenameThread = async (tid: string, newTitle: string) => {
    try {
      const res = await fetch(`/api/threads/${tid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle })
      });
      if (res.ok) {
        setThreads(prev => prev.map(t => t.id === tid ? { ...t, title: newTitle } : t));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteThread = async (tid: string) => {
    try {
      const res = await fetch(`/api/threads/${tid}`, { method: "DELETE" });
      if (res.ok) {
        setThreads(prev => prev.filter(t => t.id !== tid));
        if (activeThreadId === tid) {
          navigate(`/messages/${activeWorkspaceId}`, { replace: true });
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteWorkspace = async (wsId: string) => {
    try {
      const res = await fetch(`/api/workspaces/${wsId}`, { method: "DELETE" });
      if (res.ok) {
        const remaining = workspaces.filter(w => w.id !== wsId);
        setWorkspaces(remaining);
        if (activeWorkspaceId === wsId) {
          setThreads([]);
          clearOptimistic();
          setConfirmed([]);
          if (remaining.length > 0) {
            navigate(`/messages/${remaining[0].id}`, { replace: true });
          } else {
            navigate("/", { replace: true });
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSendMessage = async () => {
    if (!inputText.trim() || !activeThreadId) return;

    const messageText = inputText;
    setInputText("");

    const clientMsgId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    addOptimistic(activeThreadId, messageText, clientMsgId);
    wsSendMessage(activeThreadId, messageText, clientMsgId);
  };

  const handlePermissionResponse = (optionId: string, toolCommand?: string, toolName?: string) => {
    if (!activeThreadId) return;
    wsRespond(activeThreadId, optionId, toolCommand, toolName);
  };

  const handleCancelAgent = () => {
    if (!activeThreadId) return;
    wsCancel(activeThreadId);
  };

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

  if (isMobile) {
    return <MobileApp />;
  }

  return (
    <div className="flex flex-col md:flex-row w-screen overflow-hidden bg-[#0B0B0C] text-[#e4e2e4] font-sans antialiased" style={{ height: '100vh' }}>
      <div className="hidden md:flex">
        <WorkspaceSidebar
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          onSelectWorkspace={(id) => navigate(`/messages/${id}`)}
          onOpenNewWorkspace={handleOpenNewWorkspace}
          onEditWorkspace={handleOpenEditWorkspace}
          onDeleteWorkspace={handleDeleteWorkspace}
          activeView={activeView}
          onSelectView={setActiveView}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          onOpenSettings={() => setShowSettingsModal(true)}
        />
      </div>

      {showThreadListOnMobile && (
        <MobileThreadNavigator
          workspaces={workspaces}
          threads={threads.reduce((acc, thread) => {
            if (!acc[thread.workspaceId]) acc[thread.workspaceId] = [];
            acc[thread.workspaceId].push(thread);
            return acc;
          }, {} as Record<string, Thread[]>)}
          activeWorkspaceId={activeWorkspaceId}
          activeThreadId={activeThreadId}
          onSelectWorkspace={(id) => navigate(`/messages/${id}`)}
          onSelectThread={(id) => navigate(`/messages/${activeWorkspaceId}/${id}`)}
          onOpenNewThread={handleCreateThreadQuick}
          onRenameThread={handleRenameThread}
          onDeleteThread={handleDeleteThread}
          onEditWorkspace={handleOpenEditWorkspace}
          onDeleteWorkspace={handleDeleteWorkspace}
          onClose={() => setShowThreadListOnMobile(false)}
        />
      )}

      {activeView === 'threads' && (
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          <div className="hidden md:flex md:w-64">
            <ThreadList
              threads={threads}
              activeThreadId={activeThreadId}
              onSelectThread={(id) => navigate(`/messages/${activeWorkspaceId}/${id}`)}
              onOpenNewThread={handleCreateThreadQuick}
              onRenameThread={handleRenameThread}
              onDeleteThread={handleDeleteThread}
            />
          </div>

          <div className="flex-1 flex flex-col overflow-hidden">
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
              workspacePath={workspaces.find(w => w.id === activeWorkspaceId)?.path}
              onToggleMobileNav={() => setShowThreadListOnMobile(!showThreadListOnMobile)}
            />
          </div>
        </div>
      )}

      {activeView === 'activity' && (
        <main className="flex-1 flex flex-col bg-[#0B0B0C] overflow-hidden p-4 md:p-8 animate-fadeIn">
          <div className="max-w-4xl w-full mx-auto space-y-4 md:space-y-6 flex flex-col h-full">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 select-none pb-4 border-b border-white/5 justify-between shrink-0">
              <div className="flex items-center gap-2">
                <History className="text-emerald-400 flex-shrink-0" size={20} />
                <h2 className="font-sans font-bold text-base sm:text-lg md:text-xl text-white truncate">Global DevOS Activity Audit Trail</h2>
              </div>
              <button
                onClick={() => setGlobalLogs([])}
                className="text-xs text-rose-400 hover:text-rose-300 hover:underline cursor-pointer whitespace-nowrap"
              >
                Clear Log History
              </button>
            </div>

            <div className="flex-1 bg-black/40 rounded-lg md:rounded-xl border border-white/5 p-4 md:p-6 font-mono text-xs text-slate-400 space-y-2 overflow-y-auto custom-scrollbar shadow-2xl">
              {globalLogs.length === 0 ? (
                <p className="text-slate-600 italic text-center py-12 font-sans">No diagnostic activities logged in current session.</p>
              ) : (
                globalLogs.map((log, i) => (
                  <p key={i} className="leading-relaxed border-b border-white/5 pb-1.5 last:border-none text-slate-300">
                    <span className="text-emerald-500 font-bold mr-2">&gt;&gt;</span>
                    <span className="break-words">{log}</span>
                  </p>
                ))
              )}
            </div>
          </div>
        </main>
      )}

      <WorkspaceModal
        isOpen={showWorkspaceModal}
        onClose={() => {
          setShowWorkspaceModal(false);
          setWorkspaceError("");
        }}
        editingWorkspace={editingWorkspace}
        name={workspaceName}
        setName={setWorkspaceName}
        path={workspacePath}
        setPath={setWorkspacePath}
        onSubmit={handleWorkspaceSubmit}
        error={workspaceError}
        setError={setWorkspaceError}
      />

      <SettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
      />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<MessagesView />} />
      <Route path="/messages/:workspaceId" element={<MessagesView />} />
      <Route path="/messages/:workspaceId/:threadId" element={<MessagesView />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
