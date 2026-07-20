/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Routes, Route, useParams, useNavigate, Navigate, useLocation, Outlet } from "react-router-dom";
import WorkspaceSidebar from "./components/WorkspaceSidebar";
import ThreadList from "./components/ThreadList";
import ChatCanvas from "./components/ChatCanvas";
import { WorkspaceModal, SettingsModal } from "./components/Dialogs";
import { Workspace, Thread, Message } from "./types";
import { useWebSocket } from "./hooks/useWebSocket";
import { useOptimisticMessages } from "./hooks/useOptimisticMessages";
import { usePaginatedMessages } from "./hooks/usePaginatedMessages";
import IdeRoute from "./routes/IdeRoute";
import LogsRoute from "./routes/LogsRoute";
import TerminalRoute from "./routes/TerminalRoute";

let _lastWorkspaceId = "";
let _lastThreadId = "";

function DesktopShell({ activeView }: { activeView: "threads" | "activity" | "ide" | "terminal" }) {
  const { workspaceId, threadId } = useParams<{ workspaceId?: string; threadId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const activeWorkspaceId = workspaceId || "";

  if (workspaceId) _lastWorkspaceId = workspaceId;
  if (threadId) _lastThreadId = threadId;
  const rememberedWorkspaceId = _lastWorkspaceId;
  const rememberedThreadId = _lastThreadId;

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/workspaces");
        if (res.ok) {
          const data = await res.json();
          setWorkspaces(data);
          if (!workspaceId && data.length > 0 && location.pathname === "/") {
            navigate(`/messages/${data[0].id}`, { replace: true });
          }
        }
      } catch (e) {
        console.error("API error fetching workspaces", e);
      }
    })();
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
          setWorkspaces((prev) => prev.map((w) => (w.id === data.id ? data : w)));
        } else {
          const error = await res.json();
          setWorkspaceError(error.error || "Failed to update workspace");
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
          setWorkspaces((prev) => [...prev, data]);
          navigate(`/messages/${data.id}`, { replace: true });
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
    const ws = workspaces.find((w) => w.id === wsId);
    if (!ws) return;
    setEditingWorkspace(ws);
    setWorkspaceName(ws.name);
    setWorkspacePath(ws.path);
    setShowWorkspaceModal(true);
  };

  const handleDeleteWorkspace = async (wsId: string) => {
    try {
      const res = await fetch(`/api/workspaces/${wsId}`, { method: "DELETE" });
      if (res.ok) {
        setWorkspaces((prev) => prev.filter((w) => w.id !== wsId));
        if (activeWorkspaceId === wsId) {
          const remaining = workspaces.filter((w) => w.id !== wsId);
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

  const buildViewNav = (view: "threads" | "activity" | "ide" | "terminal") => {
    if (view === "ide") {
      navigate(`/ide/${rememberedWorkspaceId}${rememberedThreadId ? `/${rememberedThreadId}` : ""}`);
    } else if (view === "activity") {
      navigate("/logs");
    } else if (view === "terminal") {
      navigate("/terminal");
    } else {
      navigate(`/messages/${rememberedWorkspaceId}${rememberedThreadId ? `/${rememberedThreadId}` : ""}`);
    }
  };

  return (
    <div className="flex flex-col md:flex-row w-screen overflow-hidden bg-[#0B0B0C] text-[#e4e2e4] font-sans antialiased" style={{ height: "100vh" }}>
      <div className="hidden md:flex">
        <WorkspaceSidebar
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          onSelectWorkspace={(id) => navigate(`/messages/${id}`)}
          onOpenNewWorkspace={() => {
            setEditingWorkspace(null);
            setWorkspaceName("");
            setWorkspacePath("");
            setShowWorkspaceModal(true);
          }}
          onEditWorkspace={handleOpenEditWorkspace}
          onDeleteWorkspace={handleDeleteWorkspace}
          activeView={activeView}
          onSelectView={buildViewNav}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          onOpenSettings={() => setShowSettingsModal(true)}
        />
      </div>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        <Outlet />
      </div>

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

/* ──────────────────────────── Messages route ──────────────────────────── */

function MessagesRoute() {
  const { workspaceId, threadId } = useParams<{ workspaceId?: string; threadId?: string }>();
  const navigate = useNavigate();
  const activeWorkspaceId = workspaceId || "";
  const activeThreadId = threadId || "";

  const [threads, setThreads] = useState<Thread[]>([]);
  const [inputText, setInputText] = useState<string>("");
  const [showThreadListOnMobile, setShowThreadListOnMobile] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);

  const {
    messages, addOptimistic, confirmMessage, setConfirmed, appendMessage, clearOptimistic,
  } = useOptimisticMessages();

  // Paginated message loading
  const {
    messages: paginatedMessages,
    loadMore,
    hasMore,
    isLoadingMore,
    totalCount,
    isLoading: isLoadingMessages,
  } = usePaginatedMessages(activeThreadId);

  // Merge paginated messages with optimistic messages (optimistic ones take precedence)
  const optimisticIds = new Set(messages.map(m => m.id));
  const mergedMessages = useMemo(() => {
    const paginated = paginatedMessages.filter(m => !optimisticIds.has(m.id));
    return [...messages, ...paginated].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }, [messages, paginatedMessages]);

  const handleWsMessage = useCallback((msg: Message) => { appendMessage(msg); }, [appendMessage]);
  const handleWsThreadUpdate = useCallback((thread: Thread) => { setThreads((prev) => prev.map((t) => (t.id === thread.id ? thread : t))); }, []);
  const handleWsAck = useCallback((clientMsgId: string, message: Message) => { confirmMessage(clientMsgId, message); }, [confirmMessage]);
  const handleWsSubscribed = useCallback(async (_threadId: string, msgs: Message[]) => { setConfirmed(msgs); }, [setConfirmed]);
  const handleWsConnectionChange = useCallback(() => {}, []);

  const { sendMessage: wsSendMessage, respondToPermission: wsRespond, cancelAgent: wsCancel } = useWebSocket({
    threadId: activeThreadId || null,
    onMessage: handleWsMessage,
    onThreadUpdate: handleWsThreadUpdate,
    onAck: handleWsAck,
    onSubscribed: handleWsSubscribed,
    onConnectionChange: handleWsConnectionChange,
  });

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
    } catch (e) { console.error("API error fetching threads", e); }
  }, [threadId, navigate]);

  useEffect(() => { if (activeWorkspaceId) fetchThreads(activeWorkspaceId); }, [activeWorkspaceId, fetchThreads]);

  const activeThread = threads.find((t) => t.id === activeThreadId) || null;

  const handleCreateThreadQuick = async () => {
    if (!activeWorkspaceId) return;
    // Optimistic: add a temp thread to the sidebar so the user sees it appear instantly.
    // We do NOT navigate yet — that avoids a 404 window where the server doesn't know
    // about the temp thread id, which would cause WS subscribe + fetch failures.
    const tempId = `thread-optimistic-${Date.now()}`;
    const optimisticThread: Thread = { id: tempId, workspaceId: activeWorkspaceId, title: "Untitled", status: "idle" };
    setThreads((prev) => [...prev, optimisticThread]);

    try {
      const res = await fetch(`/api/workspaces/${activeWorkspaceId}/threads`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Untitled" }),
      });
      if (res.ok) {
        const data = await res.json();
        // Replace the optimistic thread with the real one and navigate
        setThreads((prev) => prev.map((t) => t.id === tempId ? data : t));
        navigate(`/messages/${activeWorkspaceId}/${data.id}`);
      } else {
        // Server failed — remove optimistic thread
        setThreads((prev) => prev.filter((t) => t.id !== tempId));
      }
    } catch (e) {
      setThreads((prev) => prev.filter((t) => t.id !== tempId));
      console.error(e);
    }
  };

  const handleRenameThread = async (tid: string, newTitle: string) => {
    try {
      const res = await fetch(`/api/threads/${tid}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: newTitle }) });
      if (res.ok) setThreads((prev) => prev.map((t) => (t.id === tid ? { ...t, title: newTitle } : t)));
    } catch (e) { console.error(e); }
  };

  const handleDeleteThread = async (tid: string) => {
    try {
      const res = await fetch(`/api/threads/${tid}`, { method: "DELETE" });
      if (res.ok) { setThreads((prev) => prev.filter((t) => t.id !== tid)); if (activeThreadId === tid) navigate(`/messages/${activeWorkspaceId}`, { replace: true }); }
    } catch (e) { console.error(e); }
  };

  const handleSendMessage = async () => {
    if (!inputText.trim() || !activeThreadId) return;
    const text = inputText; setInputText("");
    const clientMsgId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    addOptimistic(activeThreadId, text, clientMsgId);
    wsSendMessage(activeThreadId, text, clientMsgId);
  };

  return (
    <>
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
          messages={mergedMessages}
          inputText={inputText}
          onChangeInput={setInputText}
          onSendMessage={handleSendMessage}
          onCancelAgent={() => { if (activeThreadId) wsCancel(activeThreadId); }}
          onPermissionResponse={(optionId, selectedPattern) => { if (activeThreadId) wsRespond(activeThreadId, optionId, selectedPattern); }}
          onDeploy={() => { setIsDeploying(true); setTimeout(() => setIsDeploying(false), 2500); }}
          isDeploying={isDeploying}
          threadLogs={[]}
          onClearThreadLogs={() => {}}
          workspacePath={undefined}
          onToggleMobileNav={() => setShowThreadListOnMobile(!showThreadListOnMobile)}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          onLoadMore={loadMore}
          totalCount={totalCount}
        />
      </div>
    </>
  );
}

/* ──────────────────────────── Mobile fallback ──────────────────────────── */

import WorkspacesPage from "./pages/WorkspacesPage";
import ThreadsPage from "./pages/ThreadsPage";
import ChatPage from "./pages/ChatPage";

/* ──────────────────────────── Router ──────────────────────────── */

function MobileRoutes() {
  return (
    <Routes>
      <Route path="/" element={<WorkspacesPage />} />
      <Route path="/messages/:workspaceId" element={<ThreadsPage />} />
      <Route path="/messages/:workspaceId/:threadId" element={<ChatPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function DesktopRoutes() {
  return (
    <Routes>
      <Route element={<DesktopShell activeView="threads" />}>
        <Route path="/" element={<Navigate to="/messages" replace />} />
        <Route path="/messages" element={<MessagesRoute />} />
        <Route path="/messages/:workspaceId" element={<MessagesRoute />} />
        <Route path="/messages/:workspaceId/:threadId" element={<MessagesRoute />} />
      </Route>
      <Route element={<DesktopShell activeView="ide" />}>
        <Route path="/ide/:workspaceId" element={<IdeRoute />} />
        <Route path="/ide/:workspaceId/:threadId" element={<IdeRoute />} />
      </Route>
      <Route element={<DesktopShell activeView="activity" />}>
        <Route path="/logs" element={<LogsRoute />} />
      </Route>
      <Route element={<DesktopShell activeView="terminal" />}>
        <Route path="/terminal" element={<TerminalRoute />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  const isMobile = window.innerWidth < 768;
  return isMobile ? <MobileRoutes /> : <DesktopRoutes />;
}
