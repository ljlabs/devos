/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from "react";
import { 
  Terminal, 
  Bot, 
  User, 
  ShieldAlert, 
  CheckCircle2, 
  XCircle, 
  Paperclip, 
  Send, 
  Copy, 
  Check,
  ChevronDown,
  ChevronUp,
  Cpu,
  Layers,
  Sparkles
} from "lucide-react";
import { Message, Thread } from "../types";

interface ChatCanvasProps {
  activeThread: Thread | null;
  messages: Message[];
  inputText: string;
  onChangeInput: (text: string) => void;
  onSendMessage: () => void;
  onApproveAction: () => void;
  onDenyAction: () => void;
  onDeploy: () => void;
  isDeploying: boolean;
  onAddRule: (cmd: string) => void;
  rules: any[];
}

export default function ChatCanvas({
  activeThread,
  messages,
  inputText,
  onChangeInput,
  onSendMessage,
  onApproveAction,
  onDenyAction,
  onDeploy,
  isDeploying,
  onAddRule,
  rules
}: ChatCanvasProps) {
  const [copiedFile, setCopiedFile] = useState<string | null>(null);
  const [expandedLogId, setExpandedLogId] = useState<string | null>("initial");
  const [showConsole, setShowConsole] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of conversation
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleCopyCode = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedFile(id);
    setTimeout(() => setCopiedFile(null), 2000);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSendMessage();
    }
  };

  if (!activeThread) {
    return (
      <main className="flex-1 flex flex-col bg-[#0B0B0C] items-center justify-center p-8 select-none text-center">
        <div className="max-w-md space-y-4 animate-fadeIn">
          <div className="w-16 h-16 bg-emerald-500/10 text-emerald-400 rounded-xl flex items-center justify-center mx-auto border border-emerald-500/20 shadow-[0_0_20px_rgba(16,185,129,0.1)]">
            <Cpu size={32} className="animate-pulse" />
          </div>
          <h2 className="font-sans font-bold text-xl text-white tracking-tight">
            Welcome to DevOS Multi-Agent Hub
          </h2>
          <p className="text-sm text-slate-500 leading-relaxed">
            Select a project workspace from the left panel, then double-click any conversation thread or launch a "+ New Thread" to connect a background Claude ACP process runner.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col bg-[#0B0B0C] overflow-hidden relative">
      {/* Header bar */}
      <header className="h-14 flex items-center justify-between px-6 border-b border-white/5 bg-[#0E0E11]/80 backdrop-blur-md z-10 sticky top-0 select-none">
        <div className="flex items-center gap-3">
          <Bot size={18} className="text-emerald-400" />
          <div className="flex items-center gap-2 text-sm font-sans">
            <h1 className="font-semibold text-white tracking-tight">{activeThread.title}</h1>
            <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-500 text-[10px] border border-emerald-500/20 rounded font-mono uppercase">Running</span>
            {activeThread.targetFile && (
              <>
                <span className="text-slate-700">/</span>
                <span className="font-mono text-xs text-emerald-400 bg-emerald-500/5 px-2 py-0.5 rounded border border-emerald-500/10">
                  {activeThread.targetFile}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Toggle local virtual terminal */}
          <button 
            onClick={() => setShowConsole(!showConsole)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono transition-colors border cursor-pointer ${
              showConsole 
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" 
                : "border-white/10 text-slate-400 hover:text-white"
            }`}
          >
            <Terminal size={14} />
            <span>Console Log</span>
          </button>
          
          <div className="h-4 w-[1px] bg-white/5 mx-1" />

          {/* Trigger interactive cloud run deployment simulation */}
          <button 
            onClick={onDeploy}
            disabled={isDeploying}
            className={`px-3 py-1.5 bg-white text-black text-xs font-bold rounded-md hover:bg-slate-200 transition-colors shadow-md active:scale-95 disabled:opacity-50 cursor-pointer`}
          >
            {isDeploying ? "Deploying..." : "Deploy Cloud Run"}
          </button>

          {/* User profile avatar */}
          <div className="w-8 h-8 rounded-full border border-emerald-500/20 overflow-hidden bg-emerald-500/5 flex items-center justify-center">
            <User size={16} className="text-emerald-400" />
          </div>
        </div>
      </header>

      {/* Floating local mock terminal layer */}
      {showConsole && (
        <div className="absolute top-14 left-0 w-full h-44 bg-[#111114] border-b border-white/5 p-4 font-mono text-[11px] text-slate-300 overflow-y-auto custom-scrollbar z-20 shadow-2xl">
          <div className="flex justify-between text-slate-500 pb-2 border-b border-slate-900 mb-2 select-none">
            <span>DEVOS VIRTUAL BACKGROUND WORKER CONSOLE</span>
            <button onClick={() => setShowConsole(false)} className="hover:text-slate-300">close</button>
          </div>
          <div className="space-y-1">
            <p className="text-emerald-400">[$] Connecting DevOS Agent Client Protocol (ACP) system layer...</p>
            <p className="text-slate-500">[system] Binding process node to folder: {activeThread.targetFile || "workspace root"}</p>
            <p className="text-[#4ADE80]">[acp] Server connection verified on http://localhost:3000</p>
            <p className="text-slate-400">[info] Active rules count: {rules.length}</p>
            {rules.map((r, i) => (
              <p key={i} className="text-amber-400">[rule] Active policy: Allow command matching "{r.commandPattern}"</p>
            ))}
            <p className="text-slate-500">[log] Awaiting user prompt inputs...</p>
          </div>
        </div>
      )}

      {/* Main chat conversation window */}
      <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar pb-32">
        
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-4 max-w-md mx-auto py-12 select-none">
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 animate-bounce">
              <Sparkles size={20} />
            </div>
            <p className="text-sm font-sans font-semibold text-slate-200">Start a secure conversation stream</p>
            <p className="text-xs text-slate-500 leading-relaxed font-sans">
              Type your instructions into the input bar below (e.g. "Clean up imports in route code", "Write test script", or "Install mock package"). The ACP background process coordinator will translate terminal logs and prompt alerts cleanly.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            // Skip tool_call messages - they're rendered with their tool_result
            if (msg.type === 'tool_call') {
              return null;
            }

            // Render user messages
            if (msg.type === 'user_message') {
              return (
                <div key={msg.id} className="flex justify-end max-w-4xl mx-auto w-full group animate-fadeIn select-text">
                  <div className="max-w-[80%] bg-[#18181B] border border-white/5 p-4 rounded-2xl rounded-tr-none">
                    <p className="text-sm leading-relaxed text-slate-200">
                      {msg.text}
                    </p>
                    <div className="text-[10px] text-slate-500 font-mono mt-2 text-right select-none">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              );
            }

            // Render agent messages
            if (msg.type === 'agent_message') {
              return (
                <div key={msg.id} className="flex justify-start gap-4 max-w-4xl mx-auto w-full group animate-fadeIn select-text">
                  <div className="w-8 h-8 bg-emerald-500/20 border border-emerald-500/40 rounded-lg flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(16,185,129,0.15)] select-none">
                    <Bot size={16} className="text-emerald-400" />
                  </div>
                  <div className="flex-1 max-w-[90%]">
                    <div className="bg-[#0E0E11] border border-white/5 p-5 rounded-2xl rounded-tl-none relative">
                      <div className="flex items-center justify-between pb-2 mb-3 border-b border-white/5 select-none text-[10px] font-mono tracking-widest text-emerald-400 font-bold">
                        <span>CLAUDE AI AGENT</span>
                        <span className="text-slate-500 font-normal">
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      
                      <p className="text-sm text-slate-300 leading-relaxed">
                        {msg.text}
                      </p>

                      {/* Code block change preview (if attached) */}
                      {msg.codeBlock && (
                        <div className="code-block bg-black/40 border border-white/10 rounded-lg overflow-hidden mt-4 select-text">
                          <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/10 select-none">
                            <span className="text-[11px] font-mono text-slate-400">
                              {msg.codeBlock.filePath}
                            </span>
                            <span className="text-[10px] text-slate-500 uppercase font-bold">Modified</span>
                          </div>
                          <div className="relative">
                            <pre className="p-4 overflow-x-auto font-mono text-xs text-slate-300 custom-scrollbar bg-black/20 leading-relaxed max-h-96">
                              <code>{msg.codeBlock.content}</code>
                            </pre>
                            <button 
                              onClick={() => handleCopyCode(msg.codeBlock!.content, msg.id)}
                              className="absolute right-3 top-3 flex items-center gap-1.5 text-[10px] font-mono bg-black/60 border border-white/5 hover:border-white/20 text-slate-400 hover:text-white px-2 py-1 rounded transition-colors cursor-pointer select-none"
                            >
                              {copiedFile === msg.id ? (
                                <>
                                  <Check size={11} className="text-emerald-400" />
                                  <span className="text-emerald-400">Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy size={11} />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            }

            // Render tool result messages (grouped with tool call)
            if (msg.type === 'tool_result') {
              // Find the corresponding tool_call to get the command and tool type
              const toolCall = messages.find(m => m.type === 'tool_call' && m.id === msg.toolCallId);
              const toolType = toolCall?.toolName?.split(':')[0] || 'BASH';
              const toolCommand = toolCall?.toolCommand || msg.logs?.command || 'tool_execution';
              
              return (
                <div key={msg.id} className="flex justify-start gap-4 max-w-4xl mx-auto w-full group animate-fadeIn select-text">
                  <div className="w-8 h-8 bg-slate-500/20 border border-slate-500/40 rounded-lg flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(100,116,139,0.15)] select-none">
                    <Terminal size={16} className="text-slate-400" />
                  </div>
                  <div className="flex-1 max-w-[90%]">
                    <div className="border border-white/5 rounded-lg overflow-hidden bg-black/40">
                      <button 
                        onClick={() => setExpandedLogId(expandedLogId === msg.id ? null : msg.id)}
                        className="w-full flex items-center justify-between px-4 py-2 hover:bg-white/5 transition-colors select-none text-left bg-[#0E0E11]"
                      >
                        <div className="flex items-center gap-2">
                          <Terminal size={14} className="text-slate-400" />
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400">
                              {toolType}: {toolCommand}
                            </span>
                          </div>
                        </div>
                        {expandedLogId === msg.id ? (
                          <ChevronUp size={14} className="text-slate-500" />
                        ) : (
                          <ChevronDown size={14} className="text-slate-500" />
                        )}
                      </button>
                      
                      {expandedLogId === msg.id && msg.logs && (
                        <div className="p-4 border-t border-white/10 bg-black/95 select-text">
                          <pre className="font-mono text-xs text-slate-400 leading-relaxed overflow-x-auto custom-scrollbar">
                            {msg.logs.output}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            }

            // Render security permission messages
            if (msg.type === 'security_permission') {
              return (
                <div key={msg.id} className="flex justify-start gap-4 max-w-4xl mx-auto w-full group animate-fadeIn select-text max-w-[90%]">
                  <div className="w-8 h-8 bg-amber-500/20 border border-amber-500/40 rounded-lg flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(245,158,11,0.15)] select-none" />
                  <div className="flex-1">
                    <div className="border-2 border-amber-500/30 bg-amber-500/5 p-4 rounded-xl flex items-center justify-between shadow-[0_8px_30px_rgba(0,0,0,0.5)] animate-pulse border-dashed">
                      <div className="flex items-center gap-4 pr-4">
                        <div className="w-10 h-10 bg-amber-500/20 rounded-full flex items-center justify-center text-amber-500 select-none shrink-0">
                          <ShieldAlert size={20} />
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-amber-100 font-sans">Security Permission Required</h4>
                          <p className="text-[11px] text-amber-500/80 font-mono mt-0.5">
                            execute_command: {msg.pendingAction?.command}
                          </p>
                        </div>
                      </div>

                      {msg.pendingAction?.approved === null ? (
                        <div className="flex items-center gap-2 select-none shrink-0">
                          <button 
                            onClick={onDenyAction}
                            className="px-4 py-2 bg-transparent hover:bg-white/5 border border-white/10 text-white text-xs font-semibold rounded-md transition-all cursor-pointer"
                          >
                            Deny
                          </button>
                          
                          <button 
                            onClick={onApproveAction}
                            className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold rounded-md transition-all shadow-[0_0_15px_rgba(245,158,11,0.3)] cursor-pointer"
                          >
                            Approve
                          </button>

                          <button 
                            onClick={() => onAddRule(msg.pendingAction!.command)}
                            className="px-2.5 py-2 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white rounded-md text-[10px] font-mono cursor-pointer"
                            title="Add to rules to auto-allow in future"
                          >
                            Trust
                          </button>
                        </div>
                      ) : msg.pendingAction?.approved === true ? (
                        <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 select-none bg-emerald-950/20 border border-emerald-500/20 py-2 px-3 rounded-lg shrink-0">
                          <CheckCircle2 size={14} />
                          <span>Approved & Executed</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-xs font-mono text-rose-400 select-none bg-rose-950/20 border border-rose-500/20 py-2 px-3 rounded-lg shrink-0">
                          <XCircle size={14} />
                          <span>Clearance Denied</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            }

            // Fallback for unknown types
            return null;
          })
        )}

        {/* Anchor point to trigger scroll */}
        <div ref={messagesEndRef} />
      </div>

      {/* Floating active status thinking pulse */}
      {(activeThread.status === "thinking" || activeThread.status === "running") && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 bg-[#0E0E11] border border-emerald-500/20 text-emerald-300 font-mono text-[11px] px-4 py-1.5 rounded-full flex items-center gap-2 shadow-2xl select-none z-10">
          <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-ping" />
          <span>Claude AI agent executing local refactor loop...</span>
        </div>
      )}

      {/* Floating Input text area layer */}
      <div className="absolute bottom-0 left-0 w-full p-4 bg-gradient-to-t from-[#0B0B0C] via-[#0B0B0C]/95 to-transparent select-none z-10">
        <div className="max-w-4xl mx-auto relative group">
          <div className="absolute -inset-0.5 bg-emerald-500/10 rounded-xl blur opacity-30 group-focus-within:opacity-100 transition duration-500 animate-pulse" />
          <div className="relative bg-[#0E0E11] border border-white/10 rounded-xl p-3 flex items-end gap-3 shadow-2xl">
            {/* Attachment icon trigger */}
            <button 
              className="p-1.5 text-slate-500 hover:text-emerald-400 rounded-lg hover:bg-white/5 transition-colors cursor-pointer shrink-0"
              title="Attach code snippet context files"
            >
              <Paperclip size={16} />
            </button>
            
            <textarea 
              value={inputText}
              onChange={(e) => onChangeInput(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 bg-transparent border-none focus:outline-none focus:ring-0 text-sm font-sans text-slate-200 placeholder-slate-600 resize-none py-1.5 h-10 max-h-40 overflow-y-auto custom-scrollbar" 
              placeholder="Type a command or ask Claude to do something..."
              rows={1}
              style={{ caretColor: "#10b981" }}
            />

            <button 
              onClick={onSendMessage}
              disabled={!inputText.trim()}
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                inputText.trim() 
                  ? "bg-emerald-500 text-black hover:bg-emerald-400" 
                  : "bg-white/5 text-slate-600 cursor-not-allowed"
              }`}
              title="Stream instructions"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
