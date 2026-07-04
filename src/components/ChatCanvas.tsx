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

import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  Terminal,
  Bot,
  User,
  Cpu,
  CheckCircle2,
  XCircle,
  Paperclip,
  Send,
  Sparkles,
  Zap,
  Square,
  Menu
} from "lucide-react";
import { Message, Thread } from "../types";
import CopyButton from "./CopyButton";
import { MarkdownContent } from "./shared/MarkdownContent";
import { PermissionBubble } from "./shared/PermissionBubble";
import { StatusIndicatorPill } from "./shared/StatusIndicatorPill";
import { UserMessageBubble } from "./shared/UserMessageBubble";
import { AgentTextBubble } from "./shared/AgentTextBubble";
import { AgentChunkBubble } from "./shared/AgentChunkBubble";
import { ToolPendingBubble } from "./shared/ToolPendingBubble";
import { ToolResultBubble } from "./shared/ToolResultBubble";

/**
 * Parse raw ACP message to extract user-facing content
 * Supports all ACP chat object types
 */
export function getMessageContent(msg: Message): { type: string; content: any } | null {
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
      content: typeof raw.delta?.text === 'string' ? raw.delta.text : (typeof raw.text === 'string' ? raw.text : (typeof raw.content === 'string' ? raw.content : "")),
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
        content: typeof update.content?.text === 'string' ? update.content.text : (typeof update.content === 'string' ? update.content : ""),
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
          content: typeof textContent.content?.text === 'string' ? textContent.content.text : (typeof textContent.text === 'string' ? textContent.text : ""),
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

interface ChatCanvasProps {
  activeThread: Thread | null;
  messages: Message[];
  inputText: string;
  onChangeInput: (text: string) => void;
  onSendMessage: () => void;
  onCancelAgent: () => void;
  onPermissionResponse: (optionId: string, toolCommand?: string, toolName?: string) => void;
  onDeploy: () => void;
  isDeploying: boolean;
  threadLogs: any[];
  onClearThreadLogs: () => void;
  workspacePath?: string;
  onToggleMobileNav?: () => void;
  // Pagination props
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  totalCount?: number;
}


export default function ChatCanvas({
  activeThread,
  messages,
  inputText,
  onChangeInput,
  onSendMessage,
  onCancelAgent,
  onPermissionResponse,
  onDeploy,
  isDeploying,
  threadLogs,
  onClearThreadLogs,
  workspacePath,
  onToggleMobileNav,
  hasMore,
  isLoadingMore,
  onLoadMore,
  totalCount,
}: ChatCanvasProps) {
  const [expandedToolId, setExpandedToolId] = useState<string | null>(null);
  const [showConsole, setShowConsole] = useState(false);

  const isAgentBusy = activeThread?.status !== 'idle';
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  
  // Auto-scroll to bottom — only when user is already near the bottom,
  // so scrolling up to read long responses is not disrupted.
  const isNearBottom = () => {
    const el = scrollContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  // Scroll to bottom on new messages
  useEffect(() => {
    if (isNearBottom()) {
      // Use a small delay to ensure DOM has updated
      const timeoutId = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 0);
      return () => clearTimeout(timeoutId);
    }
  }, [messages]);

  // Scroll to bottom when thread changes.
  // Uses a MutationObserver to wait for the messages to actually render
  // in the DOM before scrolling, since the paginated hook loads async.
  const prevThreadIdRef = useRef<string | null>(null);
  useEffect(() => {
    const threadId = activeThread?.id ?? null;
    if (threadId === prevThreadIdRef.current) return;
    prevThreadIdRef.current = threadId;

    if (!threadId || !scrollContainerRef.current) return;

    // Scroll immediately for empty/loading state
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" });

    // Also scroll once messages finish rendering (paginated hook loads async)
    const el = scrollContainerRef.current;
    const observer = new MutationObserver(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
    });
    observer.observe(el, { childList: true, subtree: true });

    // Cleanup after a short delay — messages should be rendered by then
    const timeoutId = setTimeout(() => observer.disconnect(), 500);
    return () => { observer.disconnect(); clearTimeout(timeoutId); };
  }, [activeThread?.id]);

  // Handle scroll for pagination - load more when near top
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el || !onLoadMore || !hasMore || isLoadingMore) return;
    
    // If we're near the top (within 100px) and there's more to load
    if (el.scrollTop < 100) {
      onLoadMore();
    }
  }, [onLoadMore, hasMore, isLoadingMore]);

  // Add scroll listener
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // Auto-expand textarea as user types, cap at 10 lines (240px)
  const handleTextareaChange = useCallback((text: string) => {
    onChangeInput(text);

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const newHeight = Math.min(textareaRef.current.scrollHeight, 240);
      textareaRef.current.style.height = newHeight + "px";
    }
  }, [onChangeInput]);

  const handleKeyDown = useCallback((_e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter inserts a newline; submission is via the send button only
  }, []);

  // Memoize tool expand handler to prevent unnecessary re-renders
  const handleToggleExpand = useCallback((toolCallId: string) => {
    setExpandedToolId(prev => prev === toolCallId ? null : toolCallId);
  }, []);

  if (!activeThread) {
    return (
      <main className="flex-1 flex flex-col bg-[#0B0B0C] items-center justify-center p-4 sm:p-8 select-none text-center">
        <div className="max-w-md space-y-4 animate-fadeIn">
          <div className="w-16 h-16 bg-emerald-500/10 text-emerald-400 rounded-xl flex items-center justify-center mx-auto border border-emerald-500/20 shadow-[0_0_20px_rgba(16,185,129,0.1)]">
            <Cpu size={32} className="animate-pulse" />
          </div>
          <h2 className="font-sans font-bold text-lg sm:text-xl text-white tracking-tight px-2">
            Welcome to DevOS Multi-Agent Hub
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 leading-relaxed px-2">
            Select a project workspace from the left panel, then double-click any conversation thread or launch a "+ New Thread" to connect a background Claude ACP process runner.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col bg-[#0B0B0C] overflow-hidden relative">
      {/* Header bar - responsive */}
      <header className="h-12 sm:h-14 flex items-center justify-between px-3 sm:px-6 border-b border-white/5 bg-[#0E0E11]/80 backdrop-blur-md z-10 select-none gap-2 shrink-0">
        {/* Mobile nav toggle */}
        <button 
          onClick={onToggleMobileNav}
          className="md:hidden p-1.5 hover:bg-white/5 rounded-md text-slate-400 hover:text-white transition-colors cursor-pointer"
          title="Toggle thread list"
        >
          <Menu size={18} />
        </button>

        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Bot size={16} className="text-emerald-400 flex-shrink-0 hidden sm:block" />
          <div className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm font-sans min-w-0">
            <h1 className="font-semibold text-white tracking-tight truncate">{activeThread.title}</h1>
            <span className="px-1.5 sm:px-2 py-0.5 bg-emerald-500/10 text-emerald-500 text-[9px] sm:text-[10px] border border-emerald-500/20 rounded font-mono uppercase whitespace-nowrap flex-shrink-0">Running</span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 ml-auto">
          {/* Toggle local virtual terminal */}
          <button 
            onClick={() => setShowConsole(!showConsole)}
            className={`flex items-center gap-1 px-2 sm:px-3 py-1 sm:py-1.5 rounded-md text-xs font-mono transition-colors border cursor-pointer ${
              showConsole 
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" 
                : "border-white/10 text-slate-400 hover:text-white"
            }`}
            title="Toggle thread logs"
          >
            <Terminal size={14} />
            <span className="hidden sm:inline">Thread Log</span>
          </button>
          <button 
            onClick={onDeploy}
            disabled={isDeploying}
            className={`px-2 sm:px-3 py-1 sm:py-1.5 bg-white text-black text-xs font-bold rounded-md hover:bg-slate-200 transition-colors shadow-md active:scale-95 disabled:opacity-50 cursor-pointer whitespace-nowrap`}
            title={isDeploying ? "Deploying..." : "Deploy to Cloud Run"}
          >
            <span className="hidden sm:inline">{isDeploying ? "Deploying..." : "Deploy Cloud Run"}</span>
            <span className="sm:hidden">{isDeploying ? "..." : "Deploy"}</span>
          </button>

          {/* User profile avatar */}
          <div className="w-8 h-8 rounded-full border border-emerald-500/20 overflow-hidden bg-emerald-500/5 flex items-center justify-center flex-shrink-0">
            <User size={16} className="text-emerald-400" />
          </div>
        </div>
      </header>

      {/* Floating Thread Log panel - responsive */}
      {showConsole && (
        <div className="absolute top-12 sm:top-14 left-0 w-full max-h-56 sm:max-h-64 bg-[#111114] border-b border-white/5 p-3 sm:p-4 font-mono text-[10px] sm:text-[11px] text-slate-300 overflow-y-auto custom-scrollbar z-20 shadow-2xl">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center text-slate-500 pb-2 border-b border-slate-900 mb-2 select-none gap-2">
            <span className="truncate text-xs">THREAD LOG — {activeThread.title}</span>
            <div className="flex items-center gap-3 whitespace-nowrap">
              <button onClick={onClearThreadLogs} className="hover:text-slate-300 text-[9px] sm:text-[10px]">clear</button>
              <button onClick={() => setShowConsole(false)} className="hover:text-slate-300 text-xs">close</button>
            </div>
          </div>
          <div className="space-y-1">
            {threadLogs.length === 0 ? (
              <p className="text-slate-600 italic text-xs">No ACP messages logged yet for this thread.</p>
            ) : (
              threadLogs.map((log, i) => {
                const time = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                return (
                  <p key={i} className="leading-relaxed border-b border-white/5 pb-1 last:border-none">
                    <span className="text-emerald-500 font-bold mr-1">&gt;&gt;</span>
                    <span className="text-slate-600 mr-2 hidden sm:inline">{time}</span>
                    <span className={`mr-1 ${log.level === 'error' ? 'text-red-400' : 'text-cyan-400'}`}>
                      [{log.component}]
                    </span>
                    <span className="text-slate-400 break-words">{log.message}</span>
                  </p>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Main chat conversation window */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 sm:space-y-8 custom-scrollbar"
      >
        
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
          <>
            {/* Load more trigger / loading indicator */}
            {hasMore && (
              <div className="flex justify-center py-2">
                {isLoadingMore ? (
                  <span className="text-xs text-slate-500 animate-pulse">Loading older messages...</span>
                ) : (
                  <button
                    onClick={onLoadMore}
                    className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                  >
                    Load older messages ({totalCount} total)
                  </button>
                )}
              </div>
            )}
            {messages.map((msg) => {
            const parsed = getMessageContent(msg);
            if (!parsed) return null;

            // 1. User message bubble - responsive
            if (parsed.type === "user") {
              return (
                <UserMessageBubble
                  key={msg.id}
                  content={parsed.content}
                  timestamp={msg.timestamp}
                  compact={false}
                  pending={msg.pending}
                />
              );
            }

            // 2. Agent text response - responsive
            if (parsed.type === "agent_text") {
              const textContent = parsed.content;
              if (!textContent) return null;

              return (
                <AgentTextBubble
                  key={msg.id}
                  content={textContent}
                  timestamp={msg.timestamp}
                  compact={false}
                />
              );
            }

            // 3. Agent text chunk (streaming)
            if (parsed.type === "agent_chunk") {
              if (!parsed.content) return null;

              return (
                <AgentChunkBubble
                  key={msg.id}
                  content={parsed.content}
                  timestamp={msg.timestamp}
                  compact={false}
                />
              );
            }

            // 4. Tool pending (showing what's about to execute)
            if (parsed.type === "tool_pending") {
              const { title: initialTitle, kind, rawInput: initialRawInput, toolCallId, status } = parsed.content;
              const currentMsgIdx = messages.indexOf(msg);

              // The initial tool_call often arrives with rawInput: {} and a generic
              // title. The first tool_call_update carries the real input and a
              // descriptive title — pull from whichever has the richer data.
              const updateMsg = messages.slice(currentMsgIdx + 1).find(
                (m) => {
                  const update = m.raw?.params?.update;
                  return (
                    update?.toolCallId === toolCallId &&
                    update?.sessionUpdate === "tool_call_update"
                  );
                }
              );
              const updateData = updateMsg?.raw?.params?.update;
              const resolvedRawInput =
                (updateData?.rawInput && Object.keys(updateData.rawInput).length > 0)
                  ? updateData.rawInput
                  : initialRawInput;
              const resolvedTitle =
                (updateData?.title && updateData.title !== initialTitle)
                  ? updateData.title
                  : initialTitle;

              // Look ahead for matching tool result that has rawOutput (completed OR failed)
              const resultMsg = messages.slice(currentMsgIdx + 1).find(
                (m) => {
                  const update = m.raw?.params?.update;
                  return (
                    update?.toolCallId === toolCallId &&
                    update?.sessionUpdate === "tool_call_update" &&
                    (update?.status === "completed" || update?.status === "failed")
                  );
                }
              );
              const resultStatus = resultMsg?.raw?.params?.update?.status;
              
              // Look ahead for a permission REQUEST that belongs to this tool,
              // then find the RESPONSE to that specific request.
              const permissionRequest = messages.find((m) => {
                if (m.type !== "session/request_permission") return false;
                return m.raw?.params?.toolCall?.toolCallId === toolCallId;
              });
              let permissionApproved: boolean | undefined;
              let permissionRejected: boolean | undefined;
              if (permissionRequest) {
                const permReqIdx = messages.indexOf(permissionRequest);
                const permissionResponse = messages.find(
                  (m, idx) => idx > permReqIdx && m.type === "permission_response"
                );
                if (permissionResponse) {
                  const optionId = permissionResponse.raw?.selected?.optionId ?? "";
                  const rejectIds = new Set(["reject", "reject_once", "deny", "plan"]);
                  permissionApproved = !rejectIds.has(optionId);
                  permissionRejected = rejectIds.has(optionId);
                }
              }
              const hasApproval = !!(permissionApproved || permissionRejected);
              
              const hasResult = !!resultMsg;
              const isExpanded = expandedToolId === toolCallId;

              const isFailed = resultStatus === "failed";
              const isCompleted = resultStatus === "completed";

              return (
                <ToolPendingBubble
                  key={msg.id}
                  toolCallId={toolCallId}
                  title={resolvedTitle}
                  kind={kind}
                  rawInput={resolvedRawInput}
                  status={status}
                  timestamp={msg.timestamp}
                  resultMsg={resultMsg}
                  resultStatus={resultStatus}
                  permissionApproved={permissionApproved}
                  permissionRejected={permissionRejected}
                  hasApproval={hasApproval}
                  isExpanded={isExpanded}
                  onToggleExpand={(id) => setExpandedToolId(expandedToolId === id ? null : id)}
                  compact={false}
                />
              );
            }

            // 5. Tool result (execution complete) - skip if grouped with pending
            // These are now shown inside the collapsed tool bubble, so we skip them here
            if (parsed.type === "tool_result") {
              const { toolCallId, status, rawOutput } = parsed.content;

              // Skip intermediate tool_call_update messages that have no status or output
              // (these are just rawInput enrichment updates, not final results)
              if (!rawOutput && !status) {
                return null;
              }

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
              const { title, kind } = parsed.content;
              
              return (
                <ToolResultBubble
                  key={msg.id}
                  title={title}
                  kind={kind}
                  rawOutput={rawOutput}
                  timestamp={msg.timestamp}
                  compact={false}
                />
              );
            }

            // Permission request - render as interactive bubble with allow/deny buttons
            if (parsed.type === "permission") {
              const { toolCall, options, permissionId } = parsed.content;

              // If already responded to, don't show the prompt again
              const currentMsgIdx = messages.indexOf(msg);
              const alreadyAnswered = messages.slice(currentMsgIdx + 1).some(
                (m) => m.type === "permission_response"
              );
              if (alreadyAnswered) return null;

              return (
                <PermissionBubble
                  key={msg.id}
                  toolCall={toolCall}
                  options={options}
                  onRespond={onPermissionResponse}
                  timestamp={msg.timestamp}
                  workspacePath={workspacePath}
                />
              );
            }

            // Permission response (user's approval/denial choice) - now embedded in tool UI
            if (parsed.type === "permission_response") {
              // Skip rendering - permission responses are now shown inline with tool calls
              return null;
            }

            // Tool event (call, result, status)
            if (parsed.type === "tool_event") {
              const update = parsed.content;
              const { status, title, kind, toolCallId, rawOutput, rawInput, sessionUpdate } = update;

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
                          <span className="text-[10px] font-mono font-bold uppercase tracking-wider break-all text-slate-400">
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

              return null;
            })}
          </>
        )}

        {/* Anchor point to trigger scroll */}
        <div ref={messagesEndRef} />
      </div>

      {/* Floating active status thinking pulse */}
      {activeThread.status !== "idle" && (
        <StatusIndicatorPill status={activeThread.status} />
      )}

      {/* Error pill — shows after a failed turn, dismisses on next message */}
      {!isAgentBusy && activeThread.lastError && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 bg-red-500/10 border border-red-500/30 text-red-300 font-mono text-[11px] px-4 py-1.5 rounded-full flex items-center gap-2 shadow-2xl select-none z-10">
          <XCircle size={12} className="text-red-400" />
          <span>Agent stopped: {activeThread.lastError}</span>
        </div>
      )}

      {/* Input text area layer - flex child */}
      <div className="shrink-0 w-full p-2 sm:p-4 bg-gradient-to-t from-[#0B0B0C] via-[#0B0B0C]/95 to-transparent select-none z-10">
        <div className="max-w-4xl mx-auto px-2 sm:px-0 relative group">
          <div className="absolute -inset-0.5 bg-emerald-500/10 rounded-lg sm:rounded-xl blur opacity-30 group-focus-within:opacity-100 transition duration-500 animate-pulse" />
          <div className="relative bg-[#0E0E11] border border-white/10 rounded-lg sm:rounded-xl p-2 sm:p-3 flex items-end gap-2 sm:gap-3 shadow-2xl">
            {/* Attachment icon trigger */}
            <button 
              className="p-1 sm:p-1.5 text-slate-500 hover:text-emerald-400 rounded-lg hover:bg-white/5 transition-colors cursor-pointer shrink-0"
              title="Attach code snippet context files"
            >
              <Paperclip size={14} className="sm:w-4 sm:h-4" />
            </button>
            
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={(e) => handleTextareaChange(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isAgentBusy}
              className="flex-1 bg-transparent border-none focus:outline-none focus:ring-0 text-xs sm:text-sm font-sans text-slate-200 placeholder-slate-600 resize-none py-1.5 max-h-60 overflow-y-auto custom-scrollbar disabled:opacity-40 disabled:cursor-not-allowed"
              placeholder={isAgentBusy ? "Agent is busy..." : "Type a command or ask Claude..."}
              rows={1}
              style={{ caretColor: "#10b981", height: "auto", minHeight: "32px" }}
            />

            {isAgentBusy ? (
              <button
                onClick={onCancelAgent}
                className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl flex items-center justify-center shrink-0 bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors cursor-pointer"
                title="Cancel agent turn"
              >
                <Square size={14} className="sm:w-4 sm:h-4" />
              </button>
            ) : (
              <button
                onClick={onSendMessage}
                disabled={!inputText.trim()}
                className={`w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                  inputText.trim()
                    ? "bg-emerald-500 text-black hover:bg-emerald-400"
                    : "bg-white/5 text-slate-600 cursor-not-allowed"
                }`}
                title="Stream instructions"
              >
                <Send size={14} className="sm:w-4 sm:h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
