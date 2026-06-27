/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { 
  Laptop, 
  Cpu, 
  RefreshCw, 
  Search, 
  History, 
  Plus, 
  FolderPlus, 
  ShieldCheck,
  FileCode,
  Code
} from "lucide-react";
import WorkspaceSidebar from "./components/WorkspaceSidebar";
import ThreadList from "./components/ThreadList";
import ChatCanvas from "./components/ChatCanvas";
import { NewWorkspaceModal, NewThreadModal } from "./components/Dialogs";
import { Workspace, Thread, Message } from "./types";

export default function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>("");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState<string>("");
  
  // Navigation / views
  const [activeView, setActiveView] = useState<'threads' | 'search' | 'activity' | 'security'>('threads');
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [globalLogs, setGlobalLogs] = useState<string[]>([]);
  const [threadLogs, setThreadLogs] = useState<Record<string, any[]>>({});
  const [searchResult, setSearchResult] = useState<any[]>([]);
  const threadSseRef = useRef<EventSource | null>(null);
  const globalSseRef = useRef<EventSource | null>(null);

  // Dialog states
  const [showNewWorkspace, setShowNewWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [newWorkspacePath, setNewWorkspacePath] = useState("");
  const [showNewThread, setShowNewThread] = useState(false);
  const [newThreadTitle, setNewThreadTitle] = useState("");

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
        // Find if active thread exists or choose first
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

  // Polling state helper to update message states or threads status
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

  // Handle Workspace creation
  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkspaceName.trim()) return;

    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newWorkspaceName, path: newWorkspacePath })
      });
      if (res.ok) {
        const data = await res.json();
        setWorkspaces(prev => [...prev, data]);
        setActiveWorkspaceId(data.id);
        
        // Log activity
        setGlobalLogs(prev => [
          `[${new Date().toLocaleTimeString()}] Registered new local workspace project: ${newWorkspaceName}`,
          ...prev
        ]);
        
        // Reset and close
        setNewWorkspaceName("");
        setNewWorkspacePath("");
        setShowNewWorkspace(false);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Handle Thread creation
  const handleCreateThread = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWorkspaceId) return;
    // Title is optional now - will be auto-set from ACP session_info_update

    try {
      const res = await fetch(`/api/workspaces/${activeWorkspaceId}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          title: newThreadTitle || "Untitled"
        })
      });
      if (res.ok) {
        const data = await res.json();
        setThreads(prev => [...prev, data]);
        setActiveThreadId(data.id);
        
        // Log activity
        setGlobalLogs(prev => [
          `[${new Date().toLocaleTimeString()}] Initialized Claude ACP process thread`,
          ...prev
        ]);
        
        setNewThreadTitle("");
        setShowNewThread(false);
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
        // Fetch fresh messages and thread state
        await fetchMessages(activeThreadId);
        await fetchThreads(activeWorkspaceId);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Handle permission response from ACP permission request
  const handlePermissionResponse = async (optionId: string) => {
    if (!activeThreadId) return;
    try {
      const res = await fetch(`/api/threads/${activeThreadId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionId })
      });
      if (res.ok) {
        setGlobalLogs(prev => [
          `[${new Date().toLocaleTimeString()}] Permission response sent: ${optionId}`,
          ...prev
        ]);
        // Fetch fresh state
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

  // Code search simulation
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResult([]);
      return;
    }
    const filtered = [
      { file: "/src/api/routes.js", preview: "router.get('/users', UserController.getAllUsers);" },
      { file: "/src/api/UserController.js", preview: "export const UserController = { getAllUsers..." },
      { file: "/src/auth/jwt.ts", preview: "export function signToken(payload) {..." }
    ].filter(item => 
      item.file.toLowerCase().includes(searchQuery.toLowerCase()) || 
      item.preview.toLowerCase().includes(searchQuery.toLowerCase())
    );
    setSearchResult(filtered);
  }, [searchQuery]);

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
        onOpenNewWorkspace={() => setShowNewWorkspace(true)}
        activeView={activeView}
        onSelectView={setActiveView}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      {/* RENDER CONTENT PANELS ACCORDING TO NAVIGATION STATE */}
      {activeView === 'threads' && (
        <>
          {/* COLUMN 2: THREADS SELECTOR */}
          <ThreadList
            threads={threads}
            activeThreadId={activeThreadId}
            onSelectThread={setActiveThreadId}
            onOpenNewThread={() => setShowNewThread(true)}
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

      {/* SEARCH VIEW PANEL */}
      {activeView === 'search' && (
        <main className="flex-1 flex flex-col bg-[#0B0B0C] overflow-hidden p-8 animate-fadeIn">
          <div className="max-w-4xl w-full mx-auto space-y-6">
            <div className="flex items-center gap-2 select-none pb-4 border-b border-white/5">
              <Search className="text-emerald-400" size={24} />
              <h2 className="font-sans font-bold text-xl text-white">Search Local Workspace Directory</h2>
            </div>

            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search class declarations, endpoints, functions or keywords..."
                className="w-full bg-[#0E0E11] border border-white/10 rounded-xl px-5 py-4 pl-12 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-all font-sans"
              />
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
            </div>

            <div className="space-y-3 pt-4 overflow-y-auto max-h-[60vh] custom-scrollbar pr-2">
              {searchResult.length === 0 ? (
                <p className="text-sm text-slate-500 font-sans italic text-center py-12">
                  {searchQuery ? "No matches found in active repository." : "Type keywords to search code files indexed by the workspace indexer."}
                </p>
              ) : (
                searchResult.map((res, i) => (
                  <div 
                    key={i} 
                    className="p-4 rounded-lg bg-[#0E0E11] border border-white/5 hover:border-emerald-500/20 cursor-pointer transition-all space-y-2 group"
                    onClick={() => {
                      setNewThreadTitle(`Inspect: ${res.file.split("/").pop()}`);
                      setShowNewThread(true);
                    }}
                  >
                    <div className="flex justify-between items-center select-none">
                      <span className="font-mono text-xs text-emerald-400 font-semibold">{res.file}</span>
                      <span className="text-[10px] font-mono text-slate-500 group-hover:text-emerald-400 flex items-center gap-1 transition-colors">
                        Launch inspection thread
                        <span>+</span>
                      </span>
                    </div>
                    <pre className="font-mono text-xs text-slate-300 bg-black/40 p-2.5 rounded-md border border-white/5 overflow-x-auto">
                      <code>{res.preview}</code>
                    </pre>
                  </div>
                ))
              )}
            </div>
          </div>
        </main>
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

      {/* GATEKEEPING RULES VIEW PANEL */}
      {activeView === 'security' && (
        <main className="flex-1 flex flex-col bg-[#0B0B0C] overflow-hidden p-8 animate-fadeIn">
          <div className="max-w-4xl w-full mx-auto h-full flex items-center justify-center">
            <div className="text-center space-y-4 select-none">
              <ShieldCheck className="w-16 h-16 text-emerald-400 mx-auto opacity-20" />
              <h2 className="font-sans font-bold text-xl text-white">Permissions Managed by ACP</h2>
              <p className="text-sm text-slate-400 max-w-md mx-auto">
                Permission requests are now managed dynamically by the Agent Client Protocol. When Claude requests access to files or system resources, you'll see interactive permission prompts in the chat.
              </p>
              <p className="text-xs text-slate-500 font-mono mt-4">
                All permission decisions are routed through the ACP session/request_permission protocol.
              </p>
            </div>
          </div>
        </main>
      )}

      {/* --- MODAL DIALOGS --- */}
      <NewWorkspaceModal
        isOpen={showNewWorkspace}
        onClose={() => setShowNewWorkspace(false)}
        name={newWorkspaceName}
        setName={setNewWorkspaceName}
        path={newWorkspacePath}
        setPath={setNewWorkspacePath}
        onSubmit={handleCreateWorkspace}
      />

      <NewThreadModal
        isOpen={showNewThread}
        onClose={() => setShowNewThread(false)}
        title={newThreadTitle}
        setTitle={setNewThreadTitle}
        onSubmit={handleCreateThread}
      />
    </div>
  );
}
