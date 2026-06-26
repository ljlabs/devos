/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ChatCanvas: Renders raw ACP messages as interactive speech bubbles.
 * 
 * ACP message types handled:
 * - session/update (tool calls & results as bubbles)
 * - session/request_permission (dynamic permission buttons)
 * - user messages (persisted user prompts)
 * - agent text responses (session/update with text content)
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
  Sparkles,
  Zap
} from "lucide-react";
import { Message, Thread } from "../types";

interface ChatCanvasProps {
  activeThread: Thread | null;
  messages: Message[];
  inputText: string;
  onChangeInput: (text: string) => void;
  onSendMessage: () => void;
  onPermissionResponse: (optionId: string) => void;
  onDeploy: () => void;
  isDeploying: boolean;
}

/**
 * Parse raw ACP message to extract user-facing content
 * Supports all ACP chat object types
 * 
 * Supported message types:
 * - user messages (role: "user")
 * - agent_message_chunk (streaming text)
 * - session/update:
 *   - available_commands_update
 *   - tool_call (pending)
 *   - tool_call_update (result)
 *   - agent_message_chunk (alt format)
 *   - usage_update
 *   - session_info_update
 * - session/request_permission (permission prompts)
 * - response (JSON-RPC responses)
 * - permission_response (user choices)
 */
function getMessageContent(msg: Message): { type: string; content: any } | null {
  const raw = msg.raw;
  if (!raw) return null;

  // 0. PERMISSION RESPONSE: User's approval/denial choice
  if (msg.type === "permission_response") {
    return {
      type: "permission_response",
      content: raw.selected?.optionId || "unknown",
    };
  }

  // 1. USER MESSAGE: {role: "user", content: "..."}
  if (raw.role === "user" && raw.content) {
    return { type: "user", content: raw.content };
  }

  // 2. AGENT MESSAGE CHUNK: Streaming text chunks from agent
  if (msg.type === "agent_message_chunk") {
    return {
      type: "agent_chunk",
      content: raw.delta?.text || raw.text || raw.content || "",
    };
  }

  // 3. SESSION/UPDATE: Main wrapper for all tool and agent updates
  if (msg.type === "session/update") {
    const update = raw.params?.update;
    if (!update) return null;

    // 3a. AVAILABLE COMMANDS UPDATE
    if (update.sessionUpdate === "available_commands_update") {
      return {
        type: "available_commands",
        content: {
          availableCommands: update.availableCommands,
        },
      };
    }

    // 3b. TOOL CALL: {toolCallId, status, kind, title, rawInput, ...}
    if (update.toolCallId && update.sessionUpdate === "tool_call") {
      return {
        type: "tool_pending",
        content: update,
      };
    }

    // 3c. TOOL CALL UPDATE: Result of tool execution
    if (update.toolCallId && update.sessionUpdate === "tool_call_update") {
      return {
        type: "tool_result",
        content: update,
      };
    }

    // 3d. AGENT MESSAGE CHUNK (alt format): Streaming text
    if (update.sessionUpdate === "agent_message_chunk") {
      return {
        type: "agent_chunk",
        content: update.content?.text || update.content || "",
      };
    }

    // 3e. USAGE UPDATE: Token/cost tracking
    if (update.sessionUpdate === "usage_update") {
      return {
        type: "usage_update",
        content: {
          used: update.used,
          size: update.size,
          cost: update.cost,
        },
      };
    }

    // 3f. SESSION INFO UPDATE: Title, metadata
    if (update.sessionUpdate === "session_info_update") {
      return {
        type: "session_info",
        content: {
          title: update.title,
          updatedAt: update.updatedAt,
        },
      };
    }

    // 3g. GENERIC CONTENT UPDATE: Text content array
    if (update.content && Array.isArray(update.content)) {
      const textContent = update.content.find((c: any) => c.type === "text");
      if (textContent) {
        return {
          type: "agent_text",
          content: textContent.content?.text || textContent.text || "",
        };
      }
    }
  }

  // 4. SESSION/REQUEST PERMISSION: Permission prompt from ACP
  if (msg.type === "session/request_permission") {
    return {
      type: "permission",
      content: {
        toolCall: raw.params?.toolCall,
        options: raw.params?.options,
        permissionId: raw.id,
        sessionId: raw.params?.sessionId,
      },
    };
  }

  // 5. JSON-RPC RESPONSE: Result/error from RPC call
  if (msg.type === "response") {
    return {
      type: "rpc_response",
      content: {
        result: raw.result,
        error: raw.error,
      },
    };
  }

  return null;
}

export default function ChatCanvas({
  activeThread,
  messages,
  inputText,
  onChangeInput,
  onSendMessage,
  onPermissionResponse,
  onDeploy,
  isDeploying,
}: ChatCanvasProps) {
  const [expandedToolId, setExpandedToolId] = useState<string | null>(null);
  const [showConsole, setShowConsole] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of conversation
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
            <span>DEVOS AGENT CLIENT PROTOCOL CONSOLE</span>
            <button onClick={() => setShowConsole(false)} className="hover:text-slate-300">close</button>
          </div>
          <div className="space-y-1">
            <p className="text-emerald-400">[$] Connecting Claude Agent Client Protocol (ACP) system layer...</p>
            <p className="text-slate-500">[system] Session ID: {activeThread.sessionId || "initializing…"}</p>
            <p className="text-[#4ADE80]">[acp] Server connection verified on http://localhost:3000</p>
            <p className="text-slate-500">[info] Active messages: {messages.length}</p>
            <p className="text-slate-500">[status] Thread status: {activeThread.status}</p>
            {activeThread.pendingPermissionId && (
              <p className="text-amber-400">[warning] Awaiting permission response (ID: {activeThread.pendingPermissionId})</p>
            )}
            <p className="text-slate-500">[log] Ready to receive ACP notifications…</p>
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
              Type your instructions and watch the Claude ACP agent execute tasks. Permission requests will appear as interactive prompts.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const parsed = getMessageContent(msg);
            if (!parsed) return null;

            // 1. User message bubble
            if (parsed.type === "user") {
              return (
                <div key={msg.id} className="flex justify-end max-w-4xl mx-auto w-full group animate-fadeIn select-text">
                  <div className="max-w-[80%] bg-[#18181B] border border-white/5 p-4 rounded-2xl rounded-tr-none">
                    <p className="text-sm leading-relaxed text-slate-200">
                      {parsed.content}
                    </p>
                    <div className="text-[10px] text-slate-500 font-mono mt-2 text-right select-none">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              );
            }

            // 2. Agent text response
            if (parsed.type === "agent_text") {
              const textContent = parsed.content;
              if (!textContent) return null;

              return (
                <div key={msg.id} className="flex justify-start gap-4 max-w-4xl mx-auto w-full group animate-fadeIn select-text">
                  <div className="w-8 h-8 bg-emerald-500/20 border border-emerald-500/40 rounded-lg flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(16,185,129,0.15)] select-none">
                    <Bot size={16} className="text-emerald-400" />
                  </div>
                  <div className="flex-1 max-w-[90%]">
                    <div className="bg-[#0E0E11] border border-white/5 p-5 rounded-2xl rounded-tl-none">
                      <div className="flex items-center justify-between pb-2 mb-3 border-b border-white/5 select-none text-[10px] font-mono tracking-widest text-emerald-400 font-bold">
                        <span>CLAUDE AI AGENT</span>
                        <span className="text-slate-500 font-normal">
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-sm text-slate-300 leading-relaxed">
                        {textContent}
                      </p>
                    </div>
                  </div>
                </div>
              );
            }

            // 3. Agent text chunk (streaming)
            if (parsed.type === "agent_chunk") {
              if (!parsed.content) return null;

              return (
                <div key={msg.id} className="flex justify-start gap-4 max-w-4xl mx-auto w-full group animate-fadeIn select-text">
                  <div className="w-8 h-8 bg-emerald-500/20 border border-emerald-500/40 rounded-lg flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(16,185,129,0.15)] select-none">
                    <Bot size={16} className="text-emerald-400" />
                  </div>
                  <div className="flex-1 max-w-[90%]">
                    <div className="bg-[#0E0E11] border border-white/5 p-5 rounded-2xl rounded-tl-none">
                      <div className="flex items-center justify-between pb-2 mb-3 border-b border-white/5 select-none text-[10px] font-mono tracking-widest text-emerald-400 font-bold">
                        <span>CLAUDE AI AGENT</span>
                        <span className="text-slate-500 font-normal">
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
                        {parsed.content}
                      </p>
                    </div>
                  </div>
                </div>
              );
            }

            // 4. Tool pending (showing what's about to execute)
            if (parsed.type === "tool_pending") {
              const { title, kind, rawInput, toolCallId, status } = parsed.content;
              const currentMsgIdx = messages.indexOf(msg);
              
              // Look ahead for matching tool result that has rawOutput
              const resultMsg = messages.slice(currentMsgIdx + 1).find(
                (m) => {
                  const update = m.raw?.params?.update;
                  return (
                    update?.toolCallId === toolCallId &&
                    update?.sessionUpdate === "tool_call_update" &&
                    update?.status === "completed"
                  );
                }
              );
              
              const hasResult = !!resultMsg;
              const isExpanded = expandedToolId === toolCallId;

              return (
                <div key={msg.id} className="flex justify-start gap-4 max-w-4xl mx-auto w-full group animate-fadeIn select-text">
                  <div className="w-8 h-8 bg-slate-500/20 border border-slate-500/40 rounded-lg flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(100,116,139,0.15)] select-none">
                    {hasResult ? (
                      <Terminal size={16} className="text-emerald-400" />
                    ) : (
                      <Zap size={16} className="text-slate-400 animate-pulse" />
                    )}
                  </div>
                  <div className="flex-1 max-w-[90%]">
                    <div className="border border-slate-500/20 rounded-lg overflow-hidden bg-black/40">
                      {/* Tool header / toggle button */}
                      <button
                        onClick={() => setExpandedToolId(isExpanded ? null : toolCallId)}
                        className={`w-full flex items-center justify-between px-4 py-2 bg-[#0E0E11] border-b border-slate-500/10 hover:bg-slate-900/20 transition-colors select-none text-left ${
                          hasResult ? "cursor-pointer" : ""
                        }`}
                        disabled={!hasResult}
                      >
                        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400">
                          {kind?.toUpperCase() || "TOOL"}: {title || "pending…"}
                        </span>
                        {hasResult && (
                          <div className="text-slate-500 text-xs">
                            {isExpanded ? "▼ Hide output" : "▶ Show output"}
                          </div>
                        )}
                      </button>

                      {/* Tool output (collapsible, shown if expanded and result exists) */}
                      {hasResult && isExpanded && resultMsg && (
                        <div className="p-3 bg-black/95 max-h-60 overflow-y-auto custom-scrollbar">
                          <pre className="font-mono text-xs text-slate-300 whitespace-pre-wrap break-words">
                            {typeof resultMsg.raw?.params?.update?.rawOutput === 'string' 
                              ? resultMsg.raw.params.update.rawOutput 
                              : JSON.stringify(resultMsg.raw?.params?.update?.rawOutput, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            }

            // 5. Tool result (execution complete) - skip if grouped with pending
            // These are now shown inside the collapsed tool bubble, so we skip them here
            if (parsed.type === "tool_result") {
              const { toolCallId } = parsed.content;
              
              // Check if there's a pending tool call before this result
              const currentMsgIdx = messages.indexOf(msg);
              const hasPendingBefore = messages.slice(0, currentMsgIdx).some(
                (m) => {
                  const update = m.raw?.params?.update;
                  return (
                    update?.toolCallId === toolCallId &&
                    update?.sessionUpdate === "tool_call"
                  );
                }
              );
              
              // If there's a pending call before this result, hide the result (it's shown in the expanded pending bubble)
              if (hasPendingBefore) {
                return null;
              }
              
              // Orphaned result (no pending call before it) - render it standalone
              const { status, title, kind, rawOutput } = parsed.content;
              
              return (
                <div key={msg.id} className="flex justify-start gap-4 max-w-4xl mx-auto w-full group animate-fadeIn select-text">
                  <div className="w-8 h-8 bg-emerald-500/20 border border-emerald-500/40 rounded-lg flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(16,185,129,0.15)] select-none">
                    <CheckCircle2 size={16} className="text-emerald-400" />
                  </div>
                  <div className="flex-1 max-w-[90%]">
                    <div className="border border-emerald-500/20 rounded-lg overflow-hidden bg-emerald-500/5">
                      <div className="px-4 py-2 bg-emerald-500/10 border-b border-emerald-500/20 select-none">
                        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-400">
                          {kind?.toUpperCase() || "TOOL"}: Complete
                        </span>
                      </div>
                      <div className="p-3 bg-black/95 max-h-60 overflow-y-auto custom-scrollbar">
                        <pre className="font-mono text-xs text-slate-300 whitespace-pre-wrap break-words">
                          {typeof rawOutput === 'string' 
                            ? rawOutput 
                            : JSON.stringify(rawOutput, null, 2)}
                        </pre>
                      </div>
                    </div>
                  </div>
                </div>
              );
            }

            // Permission request
            if (parsed.type === "permission") {
              const { toolCall, options, permissionId } = parsed.content;
              
              // Look ahead for a permission_response that answers this request
              const currentMsgIdx = messages.indexOf(msg);
              const hasResponse = messages.slice(currentMsgIdx + 1).some(
                (m) => {
                  // Check if this is a permission_response message type
                  if (m.type === "permission_response") {
                    return true;
                  }
                  // Also check raw.type in case message type isn't set
                  return m.raw?.type === "permission_response" && m.raw?.selected?.optionId;
                }
              );
              
              // Hide permission bubble if it's already been responded to
              if (hasResponse) {
                return null;
              }
              
              return (
                <div key={msg.id} className="flex justify-start gap-4 max-w-4xl mx-auto w-full group animate-fadeIn select-text max-w-[90%]">
                  <div className="w-8 h-8 bg-amber-500/20 border border-amber-500/40 rounded-lg flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(245,158,11,0.15)] select-none" />
                  <div className="flex-1">
                    <div className="border-2 border-amber-500/30 bg-amber-500/5 p-4 rounded-xl flex flex-col gap-4 shadow-[0_8px_30px_rgba(0,0,0,0.5)] animate-pulse border-dashed">
                      <div>
                        <h4 className="text-sm font-bold text-amber-100 font-sans">Permission Required</h4>
                        <p className="text-[11px] text-amber-500/80 font-mono mt-1">
                          {toolCall?.title || "Tool execution requested"}
                        </p>
                        {toolCall?.kind && (
                          <p className="text-[10px] text-amber-400/60 font-mono mt-0.5">
                            Kind: {toolCall.kind}
                          </p>
                        )}
                        {toolCall?.locations?.[0]?.path && (
                          <p className="text-[10px] text-amber-400/60 font-mono mt-0.5 truncate">
                            Path: {toolCall.locations[0].path}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 select-none shrink-0 flex-wrap">
                        {options?.map((opt: any) => (
                          <button
                            key={opt.optionId}
                            onClick={() => onPermissionResponse(opt.optionId)}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                              opt.kind === "allow_always"
                                ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                                : opt.kind === "allow_once"
                                ? "bg-amber-500 hover:bg-amber-400 text-black"
                                : "bg-transparent hover:bg-white/5 border border-white/10 text-white"
                            }`}
                          >
                            {opt.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            }

            // Permission response (user's approval/denial choice)
            if (parsed.type === "permission_response") {
              const optionId = parsed.content;
              const optionNames: { [key: string]: string } = {
                "allow_always": "✓ Allow Always",
                "allow": "✓ Allow",
                "allow_once": "✓ Allow",
                "reject": "✗ Reject",
                "reject_once": "✗ Reject",
              };
              
              return (
                <div key={msg.id} className="flex justify-start gap-4 max-w-4xl mx-auto w-full group animate-fadeIn select-text max-w-[90%]">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 select-none border ${
                    optionId?.includes("allow") 
                      ? "bg-emerald-500/20 border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.15)]" 
                      : "bg-red-500/20 border-red-500/40 shadow-[0_0_15px_rgba(239,68,68,0.15)]"
                  }`}>
                    {optionId?.includes("allow") 
                      ? <CheckCircle2 size={16} className="text-emerald-400" />
                      : <XCircle size={16} className="text-red-400" />
                    }
                  </div>
                  <div className="flex-1">
                    <div className={`border rounded-xl p-3 ${
                      optionId?.includes("allow")
                        ? "border-emerald-500/30 bg-emerald-500/5"
                        : "border-red-500/30 bg-red-500/5"
                    }`}>
                      <p className={`text-sm font-semibold font-sans ${
                        optionId?.includes("allow")
                          ? "text-emerald-300"
                          : "text-red-300"
                      }`}>
                        {optionNames[optionId] || optionId}
                      </p>
                      <p className={`text-[11px] mt-1 font-mono ${
                        optionId?.includes("allow")
                          ? "text-emerald-500/70"
                          : "text-red-500/70"
                      }`}>
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                </div>
              );
            }

            // Tool event (call, result, status)
            if (parsed.type === "tool_event") {
              const update = parsed.content;
              const { status, title, kind, toolCallId, rawOutput, content, rawInput, sessionUpdate } = update;

              // Skip intermediate tool_call_update messages that don't have status or output yet
              if (sessionUpdate === "tool_call_update" && !rawOutput && !status) {
                return null;
              }

              // Show completed tool with result
              if ((status === "completed" || rawOutput) && rawOutput) {
                return (
                  <div key={msg.id} className="flex justify-start gap-4 max-w-4xl mx-auto w-full group animate-fadeIn select-text">
                    <div className="w-8 h-8 bg-slate-500/20 border border-slate-500/40 rounded-lg flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(100,116,139,0.15)] select-none">
                      <Terminal size={16} className="text-emerald-400" />
                    </div>
                    <div className="flex-1 max-w-[90%]">
                      <div className="border border-slate-500/20 rounded-lg overflow-hidden bg-black/40">
                        <div className="px-4 py-2 bg-[#0E0E11] border-b border-slate-500/10 select-none">
                          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-400">
                            {kind?.toUpperCase() || "TOOL"}: Success
                          </span>
                        </div>
                        <div className="p-3 bg-black/95 max-h-60 overflow-y-auto custom-scrollbar">
                          <pre className="font-mono text-xs text-slate-300 whitespace-pre-wrap break-words">
                            {typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }

              // Show pending tool with input
              if (status === "pending" && rawInput) {
                return (
                  <div key={msg.id} className="flex justify-start gap-4 max-w-4xl mx-auto w-full group animate-fadeIn select-text">
                    <div className="w-8 h-8 bg-slate-500/20 border border-slate-500/40 rounded-lg flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(100,116,139,0.15)] select-none">
                      <Zap size={16} className="text-slate-400 animate-pulse" />
                    </div>
                    <div className="flex-1 max-w-[90%]">
                      <div className="border border-slate-500/20 rounded-lg overflow-hidden bg-black/40">
                        <div className="px-4 py-2 bg-[#0E0E11] border-b border-slate-500/10 select-none">
                          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400">
                            {kind?.toUpperCase() || "TOOL"}: {title || "pending…"}
                          </span>
                        </div>
                        <div className="p-3 bg-black/95">
                          <pre className="font-mono text-xs text-slate-400 overflow-x-auto custom-scrollbar max-h-40">
                            {JSON.stringify(rawInput, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }

              return null;
            }

            // Agent text response
            if (parsed.type === "agent_text") {
              const textContent = Array.isArray(parsed.content)
                ? parsed.content.find((c: any) => c.type === "text")?.text || ""
                : parsed.content;

              if (!textContent) return null;

              return (
                <div key={msg.id} className="flex justify-start gap-4 max-w-4xl mx-auto w-full group animate-fadeIn select-text">
                  <div className="w-8 h-8 bg-emerald-500/20 border border-emerald-500/40 rounded-lg flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(16,185,129,0.15)] select-none">
                    <Bot size={16} className="text-emerald-400" />
                  </div>
                  <div className="flex-1 max-w-[90%]">
                    <div className="bg-[#0E0E11] border border-white/5 p-5 rounded-2xl rounded-tl-none">
                      <div className="flex items-center justify-between pb-2 mb-3 border-b border-white/5 select-none text-[10px] font-mono tracking-widest text-emerald-400 font-bold">
                        <span>CLAUDE AI AGENT</span>
                        <span className="text-slate-500 font-normal">
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-sm text-slate-300 leading-relaxed">
                        {textContent}
                      </p>
                    </div>
                  </div>
                </div>
              );
            }

            // Agent text chunk (streaming)
            if (parsed.type === "agent_chunk") {
              if (!parsed.content) return null;

              return (
                <div key={msg.id} className="flex justify-start gap-4 max-w-4xl mx-auto w-full group animate-fadeIn select-text">
                  <div className="w-8 h-8 bg-emerald-500/20 border border-emerald-500/40 rounded-lg flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(16,185,129,0.15)] select-none">
                    <Bot size={16} className="text-emerald-400" />
                  </div>
                  <div className="flex-1 max-w-[90%]">
                    <div className="bg-[#0E0E11] border border-white/5 p-5 rounded-2xl rounded-tl-none">
                      <div className="flex items-center justify-between pb-2 mb-3 border-b border-white/5 select-none text-[10px] font-mono tracking-widest text-emerald-400 font-bold">
                        <span>CLAUDE AI AGENT</span>
                        <span className="text-slate-500 font-normal">
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
                        {parsed.content}
                      </p>
                    </div>
                  </div>
                </div>
              );
            }

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
