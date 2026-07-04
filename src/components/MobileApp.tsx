/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { History } from "lucide-react";
import MobileWorkspaceSidebar from "./MobileWorkspaceSidebar";
import MobileThreadList from "./MobileThreadList";
import MobileChatCanvas from "./MobileChatCanvas";
import MobileBottomNav from "./MobileBottomNav";
import MobileIdeView from "./MobileIdeView";
import { WorkspaceModal, SettingsModal } from "./Dialogs";
import { Workspace, Thread, Message, IdePanel } from "../types";
import { useWebSocket } from "../hooks/useWebSocket";
import { useOptimisticMessages } from "../hooks/useOptimisticMessages";
import { usePaginatedMessages } from "../hooks/usePaginatedMessages";

/**
 * Mobile-specific App layout
 * - Single column layout
 * - Stacked view for workspace → threads → chat
 * - Touch-optimized navigation
 * - Proper keyboard handling for mobile browsers
 */
export default function MobileApp({ initialWorkspaceId, initialThreadId }: { initialWorkspaceId?: string; initialThreadId?: string }) {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(initialWorkspaceId || "");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>(initialThreadId || "");
  const [inputText, setInputText] = useState<string>("");
  const [wsConnected, setWsConnected] = useState(false);

  // Mobile-specific navigation state — seed from URL if params provided
  const [currentView, setCurrentView] = useState<'workspaces' | 'threads' | 'chat'>(
    initialThreadId ? 'chat' : initialWorkspaceId ? 'threads' : 'workspaces'
  );

  // IDE panel state (active within the chat view)
  const [idePanel, setIdePanel] = useState<IdePanel>('chat');
  const [isDeploying, setIsDeploying] = useState(false);
  const [globalLogs, setGlobalLogs] = useState<string[]>([]);
  const [threadLogs, setThreadLogs] = useState<Record<string, any[]>>({});
  const threadSseRef = useRef<EventSource | null>(null);
  const globalSseRef = useRef<EventSource | null>(null);

  // Dialog states
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Optimistic messages hook
  const {
    messages: optimisticMessages,
    addOptimistic,
    confirmMessage,
    setConfirmed,
    appendMessage,
    clearOptimistic,
  } = useOptimisticMessages();

  // Paginated message loading (same expanding-window model as desktop)
  const {
    messages: paginatedMessages,
    loadMore,
    hasMore,
    isLoadingMore,
    totalCount,
  } = usePaginatedMessages(activeThreadId);

  // Merge paginated + optimistic (optimistic takes precedence)
  const optimisticIds = new Set(optimisticMessages.map(m => m.id));
  const messages = useMemo(() => {
    const paginated = paginatedMessages.filter(m => !optimisticIds.has(m.id));
    return [...optimisticMessages, ...paginated].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }, [optimisticMessages, paginatedMessages]);

  // WebSocket event handlers
  const handleWsMessage = useCallback((msg: Message) => {
    appendMessage(msg);
  }, [appendMessage]);

  const handleWsThreadUpdate = useCallback((thread: Thread) => {
    setThreads((prev) => prev.map((t) => (t.id === thread.id ? thread : t)));
  }, []);

  const handleWsAck = useCallback((clientMsgId: string, message: Message) => {
    confirmMessage(clientMsgId, message);
  }, [confirmMessage]);

  const handleWsSubscribed = useCallback(async (_threadId: string, _msgs: Message[], _thread: Thread | null) => {
    // Initial messages are loaded via the paginated HTTP endpoint;
    // WS only delivers real-time updates (appendMessage). Don't wipe state here.
  }, []);

  const handleWsConnectionChange = useCallback((connected: boolean) => {
    setWsConnected(connected);
  }, []);

  // WebSocket hook
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

  // Data fetching
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
      console.error("API error fetching workspaces", e);
    }
  };

  const fetchThreads = useCallback(async (workspaceId: string) => {
    if (!workspaceId) return;
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/threads`);
      if (res.ok) {
        const data = await res.json();
        setThreads(data);
        // Don't auto-select a thread — let the user pick from the list.
        // Only clear if the currently active thread no longer exists.
        if (activeThreadId && !data.some((t: Thread) => t.id === activeThreadId)) {
          setActiveThreadId("");
          clearOptimistic();
          setConfirmed([]);
        }
      }
    } catch (e) {
      console.error("API error fetching threads", e);
    }
  }, [activeThreadId, clearOptimistic, setConfirmed]);

  // Initialize
  useEffect(() => {
    const initialize = async () => {
      setIsLoading(true);
      await fetchWorkspaces();
      setIsLoading(false);
    };
    initialize();
  }, []);

  // SSE: Thread logs
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

  // SSE: Global logs
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

  // Update threads when workspace changes
  useEffect(() => {
    if (activeWorkspaceId) {
      fetchThreads(activeWorkspaceId);
    }
  }, [activeWorkspaceId, fetchThreads]);

  // Clear optimistic messages when thread changes
  // (paginated messages are handled by usePaginatedMessages)
  useEffect(() => {
    clearOptimistic();
    if (!activeThreadId) setConfirmed([]);
  }, [activeThreadId, clearOptimistic, setConfirmed]);

  const activeThread = threads.find(t => t.id === activeThreadId) || null;
  const activeThreadLogs = activeThreadId ? (threadLogs[activeThreadId] || []) : [];

  // Handlers
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
          setActiveWorkspaceId(data.id);
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

  const handleOpenEditWorkspace = (workspaceId: string) => {
    const ws = workspaces.find(w => w.id === workspaceId);
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

  const handleDeleteWorkspace = async (workspaceId: string) => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}`, { method: "DELETE" });
      if (res.ok) {
        setWorkspaces(prev => prev.filter(w => w.id !== workspaceId));
        if (activeWorkspaceId === workspaceId) {
          const remaining = workspaces.filter(w => w.id !== workspaceId);
          setActiveWorkspaceId(remaining.length > 0 ? remaining[0].id : "");
          setThreads([]);
          clearOptimistic();
          setConfirmed([]);
          setActiveThreadId("");
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreateThread = async () => {
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
        setCurrentView('chat');
      }
    } catch (e) {
      console.error(e);
    }
  };

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

  const handleDeleteThread = async (threadId: string) => {
    try {
      const res = await fetch(`/api/threads/${threadId}`, { method: "DELETE" });
      if (res.ok) {
        setThreads(prev => prev.filter(t => t.id !== threadId));
        if (activeThreadId === threadId) {
          setActiveThreadId("");
          clearOptimistic();
          setConfirmed([]);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Send message via WebSocket with optimistic UI
  const handleSendMessage = async () => {
    if (!inputText.trim() || !activeThreadId) return;

    const messageText = inputText;
    setInputText("");

    const clientMsgId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    addOptimistic(activeThreadId, messageText, clientMsgId);
    wsSendMessage(activeThreadId, messageText, clientMsgId);
  };

  // Handle permission response via WebSocket
  const handlePermissionResponse = (optionId: string, toolCommand?: string, toolName?: string) => {
    if (!activeThreadId) return;
    wsRespond(activeThreadId, optionId, toolCommand, toolName);
  };

  // Cancel agent turn via WebSocket
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
        `[${new Date().toLocaleTimeString()}] GCP Cloud Run deployment successful!`,
        ...prev
      ]);
    }, 2500);
  };

  // Mobile view rendering - stacked single-column layout
  return (
    <div
      className="w-screen bg-[#0B0B0C] text-[#e4e2e4] font-sans antialiased overflow-hidden flex flex-col"
      style={{
        height: '100dvh', // Dynamic viewport height accounts for mobile keyboard
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {/* Workspaces view */}
      {currentView === 'workspaces' && (
        <MobileWorkspaceSidebar
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          onSelectWorkspace={(id) => {
            setActiveWorkspaceId(id);
            setCurrentView('threads');
            navigate(`/messages/${id}`);
          }}
          onOpenNewWorkspace={handleOpenNewWorkspace}
          onEditWorkspace={handleOpenEditWorkspace}
          onDeleteWorkspace={handleDeleteWorkspace}
          onOpenSettings={() => setShowSettingsModal(true)}
        />
      )}

      {/* Threads view */}
      {currentView === 'threads' && (
        <MobileThreadList
          threads={threads}
          activeThreadId={activeThreadId}
          activeWorkspaceId={activeWorkspaceId}
          workspaces={workspaces}
          onSelectThread={(id) => {
            setActiveThreadId(id);
            setCurrentView('chat');
            navigate(`/messages/${activeWorkspaceId}/${id}`);
          }}
          onCreateThread={handleCreateThread}
          onRenameThread={handleRenameThread}
          onDeleteThread={handleDeleteThread}
          onBack={() => { setCurrentView('workspaces'); navigate('/messages'); }}
          onEditWorkspace={handleOpenEditWorkspace}
        />
      )}

      {/* Chat/IDE view with bottom navigation */}
      {currentView === 'chat' && (
        <>
          {/* IDE Panels */}
          {idePanel === 'chat' && (
            <MobileChatCanvas
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
              workspacePath={workspaces.find(w => w.id === activeWorkspaceId)?.path}
              hasMore={hasMore}
              isLoadingMore={isLoadingMore}
              onLoadMore={loadMore}
              totalCount={totalCount}
              onBack={() => { setCurrentView('threads'); navigate(`/messages/${activeWorkspaceId}`); }}
            />
          )}
          {(idePanel === 'files' || idePanel === 'editor') && (
            <MobileIdeView
              panel={idePanel}
              workspaceId={activeWorkspaceId}
              threadTitle={activeThread?.title}
              threadLogs={activeThreadLogs}
              onBack={() => setIdePanel('chat')}
            />
          )}

          {/* Bottom navigation bar */}
          <MobileBottomNav
            active={idePanel}
            onChange={setIdePanel}
            hasActiveThread={!!activeThread}
          />
        </>
      )}

      {/* Dialogs */}
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
