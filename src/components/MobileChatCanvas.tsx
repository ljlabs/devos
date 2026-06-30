/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { ArrowLeft, Send, Square, Bot, Terminal, ShieldAlert, CheckCircle2, XCircle, Zap } from "lucide-react";
import { Thread, Message } from "../types";
import CopyButton from "./CopyButton";
// Reuse the EXACT same parsing logic as the desktop - this prevents message type divergence
import { PermissionBubble, getMessageContent, MarkdownContent } from "./ChatCanvas";

interface MobileChatCanvasProps {
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
  workspacePath?: string;
  onBack: () => void;
}

/**
 * Mobile-optimized chat canvas.
 * Uses the exact same getMessageContent() parser as desktop ChatCanvas to
 * ensure identical message rendering. Only layout/sizing differs.
 */
export default function MobileChatCanvas({
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
  workspacePath,
  onBack,
}: MobileChatCanvasProps) {
  const [expandedToolId, setExpandedToolId] = useState<string | null>(null);
  const [showConsole, setShowConsole] = useState(false);

  const isAgentBusy = activeThread?.status !== 'idle';
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);

  const isNearBottom = () => {
    const el = scrollContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  useEffect(() => {
    if (isNearBottom()) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const handleTextareaChange = (text: string) => {
    onChangeInput(text);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const newHeight = Math.min(textareaRef.current.scrollHeight, 120);
      textareaRef.current.style.height = newHeight + "px";
    }
  };

  if (!activeThread) {
    return (
      <main className="flex-1 flex flex-col bg-[#0B0B0C] items-center justify-center p-4">
        <p className="text-sm text-slate-500">No thread selected</p>
      </main>
    );
  }

  return (
    <div
      className="flex flex-col bg-[#0B0B0C] overflow-hidden"
      style={{ position: 'fixed', inset: 0 }}
    >
      {/* Header */}
      <header className="flex-shrink-0 h-14 flex items-center justify-between px-3 border-b border-white/5 bg-[#0E0E11]/80 gap-2">
        <button
          onClick={onBack}
          className="p-2 hover:bg-white/5 rounded-lg text-slate-400 hover:text-white transition-colors flex-shrink-0"
        >
          <ArrowLeft size={18} />
        </button>

        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-white truncate text-sm">{activeThread.title}</h1>
          <div className="text-[10px] text-emerald-500 font-mono uppercase">
            {activeThread.status === 'thinking' && '⏳ Thinking...'}
            {activeThread.status === 'running' && '▶ Running...'}
            {activeThread.status === 'awaiting_permission' && '⏸ Awaiting approval...'}
            {activeThread.status === 'idle' && '● Ready'}
          </div>
        </div>

        <button
          onClick={() => setShowConsole(!showConsole)}
          className={`p-2 rounded-lg text-xs transition-colors flex-shrink-0 ${
            showConsole ? "bg-emerald-500/10 text-emerald-400" : "text-slate-400 hover:bg-white/5"
          }`}
        >
          <Terminal size={16} />
        </button>
      </header>

      {/* Thread logs panel */}
      {showConsole && (
        <div className="flex-shrink-0 max-h-40 bg-[#111114] border-b border-white/5 p-3 font-mono text-[10px] text-slate-300 overflow-y-auto">
          <div className="text-slate-500 pb-2 border-b border-slate-900 mb-2 flex justify-between items-center text-[9px]">
            <span>THREAD LOG</span>
            <button onClick={() => setShowConsole(false)} className="text-slate-500 hover:text-slate-300">✕</button>
          </div>
          {threadLogs.length === 0 ? (
            <p className="text-slate-600 italic">No logs yet</p>
          ) : (
            threadLogs.map((log, i) => (
              <p key={i} className="leading-relaxed">
                <span className="text-emerald-500">▶</span> [{log.component}] {log.message}
              </p>
            ))
          )}
        </div>
      )}

      {/* Messages scroll area */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-3 space-y-4 min-h-0"
        style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}
      >
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-center">
            <div className="text-sm text-slate-500">
              <p>Start the conversation</p>
              <p className="text-xs mt-1 text-slate-600">Type your first message below</p>
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const parsed = getMessageContent(msg);
            if (!parsed) return null;

            // --- USER MESSAGE ---
            if (parsed.type === "user") {
              return (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[85%] bg-[#18181B] border border-white/5 p-2.5 rounded-lg rounded-tr-none text-xs">
                    <p className="leading-relaxed text-slate-200 whitespace-pre-wrap break-words">{parsed.content}</p>
                    <div className="text-[9px] text-slate-500 font-mono mt-1 text-right">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              );
            }

            // --- AGENT TEXT (full response) ---
            if (parsed.type === "agent_text") {
              const textContent = Array.isArray(parsed.content)
                ? parsed.content.find((c: any) => c.type === "text")?.text || ""
                : parsed.content;
              if (!textContent) return null;

              return (
                <div key={msg.id} className="flex justify-start gap-2">
                  <div className="w-6 h-6 bg-emerald-500/20 border border-emerald-500/40 rounded flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Bot size={12} className="text-emerald-400" />
                  </div>
                  <div className="flex-1 max-w-[88%]">
                    <div className="bg-[#0E0E11] border border-white/5 p-2.5 rounded-lg rounded-tl-none text-xs">
                      <div className="text-[9px] font-mono text-emerald-400 pb-1.5 mb-1.5 border-b border-white/5 flex justify-between">
                        <span>CLAUDE</span>
                        <span className="text-slate-500">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <MarkdownContent content={textContent} />
                    </div>
                    <div className="mt-1 flex justify-end">
                      <CopyButton content={textContent} />
                    </div>
                  </div>
                </div>
              );
            }

            // --- AGENT CHUNK (streaming) ---
            if (parsed.type === "agent_chunk") {
              if (!parsed.content) return null;

              return (
                <div key={msg.id} className="flex justify-start gap-2">
                  <div className="w-6 h-6 bg-emerald-500/20 border border-emerald-500/40 rounded flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Bot size={12} className="text-emerald-400" />
                  </div>
                  <div className="flex-1 max-w-[88%]">
                    <div className="bg-[#0E0E11] border border-white/5 p-2.5 rounded-lg rounded-tl-none text-xs">
                      <div className="text-[9px] font-mono text-emerald-400 pb-1.5 mb-1.5 border-b border-white/5">CLAUDE</div>
                      <MarkdownContent content={parsed.content} />
                    </div>
                    <div className="mt-1 flex justify-end">
                      <CopyButton content={parsed.content} />
                    </div>
                  </div>
                </div>
              );
            }

            // --- TOOL PENDING ---
            if (parsed.type === "tool_pending") {
              const { title, kind, rawInput, toolCallId, status } = parsed.content;
              const currentMsgIdx = messages.indexOf(msg);

              const resultMsg = messages.slice(currentMsgIdx + 1).find((m) => {
                const update = m.raw?.params?.update;
                return (
                  update?.toolCallId === toolCallId &&
                  update?.sessionUpdate === "tool_call_update" &&
                  (update?.status === "completed" || update?.status === "failed")
                );
              });
              const resultStatus = resultMsg?.raw?.params?.update?.status;

              const permissionMsg = messages.find(
                (m, idx) => idx > currentMsgIdx && m.type === "permission_response"
              );
              const permissionApproved = permissionMsg && permissionMsg.raw?.selected?.optionId?.includes("allow");
              const permissionRejected = permissionMsg && !permissionMsg.raw?.selected?.optionId?.includes("allow");
              const hasApproval = permissionApproved || permissionRejected;

              const hasResult = !!resultMsg;
              const isExpanded = expandedToolId === toolCallId;
              const isFailed = resultStatus === "failed";
              const isCompleted = resultStatus === "completed";

              return (
                <div key={msg.id} className="flex justify-start gap-2">
                  <div className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 mt-0.5 border ${
                    isFailed ? "bg-red-500/20 border-red-500/40"
                    : hasApproval
                      ? permissionApproved ? "bg-emerald-500/20 border-emerald-500/40" : "bg-red-500/20 border-red-500/40"
                      : "bg-slate-500/20 border-slate-500/40"
                  }`}>
                    {isFailed ? <XCircle size={12} className="text-red-400" />
                    : hasApproval
                      ? permissionApproved ? <CheckCircle2 size={12} className="text-emerald-400" /> : <XCircle size={12} className="text-red-400" />
                      : isCompleted ? <Terminal size={12} className="text-emerald-400" />
                      : <Zap size={12} className="text-slate-400 animate-pulse" />}
                  </div>
                  <div className="flex-1 max-w-[88%]">
                    <div className={`border rounded-lg overflow-hidden bg-black/40 ${isFailed ? "border-red-500/30" : "border-slate-500/20"}`}>
                      <button
                        onClick={() => hasResult ? setExpandedToolId(isExpanded ? null : toolCallId) : undefined}
                        className={`w-full flex items-center justify-between px-3 py-2 border-b text-left ${
                          isFailed ? "bg-red-950/40 border-red-500/20" : "bg-[#0E0E11] border-slate-500/10"
                        } ${hasResult ? "cursor-pointer" : ""}`}
                        disabled={!hasResult}
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className={`text-[9px] font-mono font-bold uppercase tracking-wider truncate ${isFailed ? "text-red-400" : "text-slate-400"}`}>
                            {kind?.toUpperCase() || "TOOL"}: {title || "pending…"}
                          </span>
                          {isFailed && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/30 flex-shrink-0">✗ Failed</span>
                          )}
                          {!isFailed && hasApproval && (
                            <span className={`text-[9px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                              permissionApproved ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" : "bg-red-500/20 text-red-300 border border-red-500/30"
                            }`}>
                              {permissionApproved ? "✓ Approved" : "✗ Rejected"}
                            </span>
                          )}
                        </div>
                        {hasResult && (
                          <span className={`text-[9px] ml-2 flex-shrink-0 ${isFailed ? "text-red-400/70" : "text-slate-500"}`}>
                            {isExpanded ? "▼" : "▶"}
                          </span>
                        )}
                      </button>

                      {hasResult && isExpanded && resultMsg && (
                        <div className={`p-2.5 max-h-48 overflow-y-auto custom-scrollbar ${isFailed ? "bg-red-950/20" : "bg-black/95"}`}>
                          <pre className={`font-mono text-[10px] whitespace-pre-wrap break-words ${isFailed ? "text-red-300" : "text-slate-300"}`}>
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

            // --- TOOL RESULT (skip if paired with a pending bubble) ---
            if (parsed.type === "tool_result") {
              const { toolCallId } = parsed.content;
              const currentMsgIdx = messages.indexOf(msg);
              const hasPendingBefore = messages.slice(0, currentMsgIdx).some((m) => {
                const update = m.raw?.params?.update;
                return update?.toolCallId === toolCallId && update?.sessionUpdate === "tool_call";
              });
              if (hasPendingBefore) return null;

              const { kind, rawOutput } = parsed.content;
              return (
                <div key={msg.id} className="flex justify-start gap-2">
                  <div className="w-6 h-6 bg-emerald-500/20 border border-emerald-500/40 rounded flex items-center justify-center flex-shrink-0 mt-0.5">
                    <CheckCircle2 size={12} className="text-emerald-400" />
                  </div>
                  <div className="flex-1 max-w-[88%]">
                    <div className="border border-emerald-500/20 rounded-lg overflow-hidden bg-emerald-500/5">
                      <div className="px-3 py-1.5 bg-emerald-500/10 border-b border-emerald-500/20">
                        <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-emerald-400">
                          {kind?.toUpperCase() || "TOOL"}: Complete
                        </span>
                      </div>
                      <div className="p-2.5 bg-black/95 max-h-48 overflow-y-auto custom-scrollbar">
                        <pre className="font-mono text-[10px] text-slate-300 whitespace-pre-wrap break-words">
                          {typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput, null, 2)}
                        </pre>
                      </div>
                    </div>
                  </div>
                </div>
              );
            }

            // --- PERMISSION REQUEST ---
            if (parsed.type === "permission") {
              const { toolCall, options } = parsed.content;
              const currentMsgIdx = messages.indexOf(msg);
              const alreadyAnswered = messages.slice(currentMsgIdx + 1).some((m) => m.type === "permission_response");
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

            // --- PERMISSION RESPONSE (hidden, shown inline in tool bubble) ---
            if (parsed.type === "permission_response") return null;

            return null;
          })
        )}

        {/* Agent status indicator */}
        {(activeThread.status === "thinking" || activeThread.status === "running" || activeThread.status === "awaiting_permission") && (
          <div className="text-center py-3">
            <div className={`inline-flex items-center gap-2 border px-3 py-1.5 rounded-full text-[11px] font-mono ${
              activeThread.status === "awaiting_permission"
                ? "bg-[#0E0E11] border-amber-500/30 text-amber-400"
                : "bg-[#0E0E11] border-emerald-500/20 text-emerald-400"
            }`}>
              <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${
                activeThread.status === "awaiting_permission" ? "bg-amber-500" : "bg-emerald-500"
              }`} />
              {activeThread.status === "thinking" ? "Claude is thinking..."
                : activeThread.status === "running" ? "Claude is executing..."
                : "Awaiting approval..."}
            </div>
          </div>
        )}

        {/* Error pill */}
        {!isAgentBusy && activeThread.lastError && (
          <div className="text-center py-2">
            <div className="inline-flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-300 font-mono text-[11px] px-3 py-1.5 rounded-full">
              <XCircle size={12} className="text-red-400" />
              <span>Agent stopped: {activeThread.lastError}</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div
        ref={inputContainerRef}
        className="flex-shrink-0 p-3 border-t border-white/5 bg-[#0B0B0C]"
        style={{ position: 'sticky', bottom: 0, zIndex: 50 }}
      >
        <div className="relative group">
          <div className="absolute -inset-0.5 bg-emerald-500/10 rounded-lg blur opacity-20 group-focus-within:opacity-100 transition" />
          <div className="relative bg-[#0E0E11] border border-white/10 rounded-lg p-2.5 flex items-end gap-2 shadow-xl">
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={(e) => handleTextareaChange(e.target.value)}
              disabled={isAgentBusy}
              className="flex-1 bg-transparent border-none focus:outline-none focus:ring-0 text-xs font-sans text-slate-200 placeholder-slate-600 resize-none max-h-24 overflow-y-auto disabled:opacity-40 disabled:cursor-not-allowed"
              placeholder={isAgentBusy ? "Agent is busy..." : "Type message..."}
              rows={1}
              style={{ caretColor: "#10b981", height: "auto", minHeight: "28px" }}
            />
            {isAgentBusy ? (
              <button
                onClick={onCancelAgent}
                className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0 bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
              >
                <Square size={12} />
              </button>
            ) : (
              <button
                onClick={onSendMessage}
                disabled={!inputText.trim()}
                className={`w-8 h-8 rounded flex items-center justify-center flex-shrink-0 transition-colors ${
                  inputText.trim() ? "bg-emerald-500 text-black hover:bg-emerald-400" : "bg-white/5 text-slate-600 cursor-not-allowed"
                }`}
              >
                <Send size={12} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
