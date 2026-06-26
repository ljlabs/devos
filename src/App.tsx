/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { 
  Laptop, 
  Cpu, 
  RefreshCw, 
  Search, 
  History, 
  Trash2, 
  Check, 
  Plus, 
  FolderPlus, 
  ShieldAlert, 
  CheckCircle2, 
  XCircle,
  FileCode,
  ShieldCheck,
  Code
} from "lucide-react";
import WorkspaceSidebar from "./components/WorkspaceSidebar";
import ThreadList from "./components/ThreadList";
import ChatCanvas from "./components/ChatCanvas";
import ContextExplorer from "./components/ContextExplorer";
import { NewWorkspaceModal, NewThreadModal } from "./components/Dialogs";
import { Workspace, Thread, Message, SecurityRule } from "./types";

export default function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>("");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState<string>("");
  const [rules, setRules] = useState<SecurityRule[]>([]);
  
  // Navigation / views
  const [activeView, setActiveView] = useState<'threads' | 'search' | 'activity' | 'security'>('threads');
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [globalLogs, setGlobalLogs] = useState<string[]>([]);
  const [searchResult, setSearchResult] = useState<any[]>([]);

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

  const fetchRules = async () => {
    try {
      const res = await fetch("/api/rules");
      if (res.ok) {
        const data = await res.json();
        setRules(data);
      }
    } catch (e) {
      console.error("API error fetching rules", e);
    }
  };

  // Run on mount
  useEffect(() => {
    const initialize = async () => {
      setIsLoading(true);
      await fetchWorkspaces();
      await fetchRules();
      
      // Setup mock global system logs for activity tab
      setGlobalLogs([
        `[${new Date(Date.now() - 3600000).toLocaleTimeString()}] DevOS ACP Background state controller initialized.`,
        `[${new Date(Date.now() - 3200000).toLocaleTimeString()}] Connected local folders to SQLite single-file database.`,
        `[${new Date(Date.now() - 2800000).toLocaleTimeString()}] Registered workspace project: frontend-auth`,
        `[${new Date(Date.now() - 2400000).toLocaleTimeString()}] Bound Claude Code client thread 'Refactor API' to port 3000`,
        `[${new Date(Date.now() - 120000).toLocaleTimeString()}] User submitted workspace query: 'Refactor routes.js'`,
        `[${new Date(Date.now() - 90000).toLocaleTimeString()}] Claude Code triggered ACP action: 'rm -rf dist && npm run build' (Pending Clearance)`
      ]);
      
      setIsLoading(false);
    };
    initialize();
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

  // Polling state helper to update message states or threads status
  useEffect(() => {
    const interval = setInterval(() => {
      if (activeThreadId) {
        fetchMessages(activeThreadId);
      }
      if (activeWorkspaceId) {
        fetchThreads(activeWorkspaceId);
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [activeThreadId, activeWorkspaceId]);

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
    if (!newThreadTitle.trim() || !activeWorkspaceId) return;

    try {
      const res = await fetch(`/api/workspaces/${activeWorkspaceId}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newThreadTitle })
      });
      if (res.ok) {
        const data = await res.json();
        setThreads(prev => [...prev, data]);
        setActiveThreadId(data.id);
        
        // Log activity
        setGlobalLogs(prev => [
          `[${new Date().toLocaleTimeString()}] Initialized Claude ACP process thread '${newThreadTitle}'`,
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

    // Append user message instantly in client
    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`,
      threadId: activeThreadId,
      type: "user_message",
      sender: "user",
      timestamp: new Date().toISOString(),
      text: messageText,
      codeBlock: null,
      logs: null,
      pendingAction: null
    };
    setMessages(prev => [...prev, tempUserMsg]);

    try {
      const res = await fetch(`/api/threads/${activeThreadId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: messageText })
      });
      if (res.ok) {
        // Fetch fresh thread state and messages
        await fetchMessages(activeThreadId);
        await fetchThreads(activeWorkspaceId);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Approve action
  const handleApproveAction = async () => {
    if (!activeThreadId) return;
    try {
      const res = await fetch(`/api/threads/${activeThreadId}/approve`, {
        method: "POST"
      });
      if (res.ok) {
        setGlobalLogs(prev => [
          `[${new Date().toLocaleTimeString()}] Terminal command execution approved by user on thread '${threads.find(t => t.id === activeThreadId)?.title}'`,
          ...prev
        ]);
        await fetchMessages(activeThreadId);
        await fetchThreads(activeWorkspaceId);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Deny action
  const handleDenyAction = async () => {
    if (!activeThreadId) return;
    try {
      const res = await fetch(`/api/threads/${activeThreadId}/deny`, {
        method: "POST"
      });
      if (res.ok) {
        setGlobalLogs(prev => [
          `[${new Date().toLocaleTimeString()}] Terminal command blocked by user safety check.`,
          ...prev
        ]);
        await fetchMessages(activeThreadId);
        await fetchThreads(activeWorkspaceId);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Add wildcard rule
  const handleAddRule = async (cmdPattern: string) => {
    try {
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commandPattern: cmdPattern })
      });
      if (res.ok) {
        await fetchRules();
        setGlobalLogs(prev => [
          `[${new Date().toLocaleTimeString()}] Registered permanent rule clearance wildcard for: ${cmdPattern}`,
          ...prev
        ]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Flush Rules
  const handleClearRules = async () => {
    // We can clear active rules client-side or simply reset them
    setRules([]);
    setGlobalLogs(prev => [
      `[${new Date().toLocaleTimeString()}] Flushed local settings auto-approval policies.`,
      ...prev
    ]);
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

  const activeThread = threads.find(t => t.id === activeThreadId) || null;

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
            onApproveAction={handleApproveAction}
            onDenyAction={handleDenyAction}
            onDeploy={handleDeploy}
            isDeploying={isDeploying}
            onAddRule={handleAddRule}
            rules={rules}
          />

          {/* COLUMN 4: CONTEXT EXPLORER */}
          <ContextExplorer
            activeThread={activeThread}
            rules={rules}
            onRemoveRule={(id) => setRules(prev => prev.filter(r => r.id !== id))}
            onClearRules={handleClearRules}
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
          <div className="max-w-4xl w-full mx-auto space-y-6 h-full flex flex-col">
            <div className="flex items-center gap-2 select-none pb-4 border-b border-white/5 justify-between shrink-0">
              <div className="flex items-center gap-2">
                <ShieldCheck className="text-emerald-400" size={24} />
                <h2 className="font-sans font-bold text-xl text-white">ACP Gatekeeping Clearance Policies</h2>
              </div>
              {rules.length > 0 && (
                <button 
                  onClick={handleClearRules}
                  className="text-xs text-rose-400 hover:text-rose-300 hover:underline cursor-pointer"
                >
                  Clear All Policies
                </button>
              )}
            </div>

            <p className="text-sm text-slate-400 font-sans leading-relaxed shrink-0">
              DevOS implements an interactive safety sandbox. Whenever Claude Code requests a destructive or external terminal script (such as <code className="bg-[#18181B] border border-white/5 px-1.5 py-0.5 rounded text-xs text-amber-400 font-mono">rm</code>, <code className="bg-[#18181B] border border-white/5 px-1.5 py-0.5 rounded text-xs text-amber-400 font-mono">git push</code>, or build bundles), the operation blocks. You can set wildcard patterns to auto-approve safe, routine commands in local configuration settings.
            </p>

            <div className="flex gap-3 py-3 border-y border-white/5 shrink-0 select-none">
              <input
                type="text"
                placeholder="e.g. npm run test, jest --watchAll, py.test"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleAddRule((e.target as HTMLInputElement).value);
                    (e.target as HTMLInputElement).value = "";
                  }
                }}
                className="flex-1 bg-[#0E0E11] border border-white/10 rounded-lg px-4 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors font-mono"
              />
              <button 
                onClick={(e) => {
                  const input = e.currentTarget.previousSibling as HTMLInputElement;
                  if (input.value.trim()) {
                    handleAddRule(input.value);
                    input.value = "";
                  }
                }}
                className="bg-emerald-500 hover:bg-emerald-400 text-black px-5 py-2 rounded-lg font-bold text-xs cursor-pointer active:scale-95 transition-all"
              >
                Add Rule Pattern
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-2">
              <h4 className="text-[10px] font-mono font-bold tracking-widest text-slate-500 uppercase">
                Currently Authorized Policies ({rules.length})
              </h4>
              
              {rules.length === 0 ? (
                <div className="bg-[#0E0E11]/40 border border-white/5 rounded-xl p-12 text-center text-slate-500 space-y-2 select-none">
                  <ShieldCheck size={36} className="mx-auto text-slate-700" />
                  <p className="text-sm font-semibold text-slate-400">Sandbox Safety Engaged</p>
                  <p className="text-xs text-slate-600 max-w-sm mx-auto">
                    No bypass command wildcards matching. All terminal operations proposed by agent will lock down until user clicks Approve.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 select-none">
                  {rules.map((rule) => (
                    <div 
                      key={rule.id}
                      className="p-4 rounded-xl bg-[#0E0E11] border border-white/5 flex justify-between items-center shadow-md hover:border-emerald-500/20 transition-all"
                    >
                      <div className="space-y-1 overflow-hidden pr-2">
                        <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-mono">
                          <ShieldCheck size={14} />
                          <span>AUTO_ALLOW_POLICY</span>
                        </div>
                        <p className="font-mono text-sm text-slate-200 truncate font-semibold" title={rule.commandPattern}>
                          {rule.commandPattern}
                        </p>
                        <p className="text-[9px] text-slate-500 font-mono uppercase tracking-widest">
                          Created {new Date(rule.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <button 
                        onClick={() => setRules(prev => prev.filter(r => r.id !== rule.id))}
                        className="p-2 text-slate-500 hover:text-rose-400 hover:bg-rose-950/20 rounded-lg transition-all cursor-pointer shrink-0"
                        title="Delete policy pattern"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
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
