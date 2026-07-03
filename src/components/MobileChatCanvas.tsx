/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { ArrowLeft, Send, Square, Bot, Terminal, CheckCircle2, XCircle, Zap } from "lucide-react";
import { Thread, Message } from "../types";
import CopyButton from "./CopyButton";
import { MarkdownContent } from "./shared/MarkdownContent";
import { PermissionBubble } from "./shared/PermissionBubble";
import { StatusIndicatorPillMobile } from "./shared/StatusIndicatorPillMobile";
import { getMessageContent } from "./ChatCanvas";
import { UserMessageBubble } from "./shared/UserMessageBubble";
import { AgentTextBubble } from "./shared/AgentTextBubble";
import { AgentChunkBubble } from "./shared/AgentChunkBubble";
import { ToolPendingBubble } from "./shared/ToolPendingBubble";
import { ToolResultBubble } from "./shared/ToolResultBubble";

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

  // Monitor virtual keyboard and adjust scroll area
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer || !window.visualViewport) return;

    const updateScrollHeight = () => {
      const vh = window.visualViewport.height;
      const headerHeight = 56; // h-14 = 56px
      const inputHeight = 80; // Input area ~80px (textarea + padding)
      const extraBuffer = 20; // Extra clearance for virtual keyboard and nav
      
      // Available height = viewport - header - input - extra buffer
      const availableHeight = vh - headerHeight - inputHeight - extraBuffer;
      const maxHeight = Math.max(availableHeight, 150); // Minimum 150px
      
      scrollContainer.style.maxHeight = `${maxHeight}px`;
    };

    // Listen to keyboard open/close
    window.visualViewport.addEventListener("resize", updateScrollHeight);
    window.visualViewport.addEventListener("scroll", updateScrollHeight);
    
    updateScrollHeight();

    return () => {
      window.visualViewport?.removeEventListener("resize", updateScrollHeight);
      window.visualViewport?.removeEventListener("scroll", updateScrollHeight);
    };
  }, []);

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

  // Also scroll to bottom when thread changes (new chat window opened)
  useEffect(() => {
    if (activeThread) {
      const timeoutId = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
      }, 0);
      return () => clearTimeout(timeoutId);
    }
  }, [activeThread?.id]);

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
      style={{ position: 'fixed', inset: '0 0 56px 0' }}
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
        style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch', maxHeight: '100%' }}
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
                <UserMessageBubble
                  key={msg.id}
                  content={parsed.content}
                  timestamp={msg.timestamp}
                  compact={true}
                  pending={msg.pending}
                />
              );
            }

            // --- AGENT TEXT (full response) ---
            if (parsed.type === "agent_text") {
              const textContent = Array.isArray(parsed.content)
                ? parsed.content.find((c: any) => c.type === "text")?.text || ""
                : parsed.content;
              if (!textContent) return null;

              return (
                <AgentTextBubble
                  key={msg.id}
                  content={textContent}
                  timestamp={msg.timestamp}
                  compact={true}
                />
              );
            }

            // --- AGENT CHUNK (streaming) ---
            if (parsed.type === "agent_chunk") {
              if (!parsed.content) return null;

              return (
                <AgentChunkBubble
                  key={msg.id}
                  content={parsed.content}
                  timestamp={msg.timestamp}
                  compact={true}
                />
              );
            }

            // --- TOOL PENDING ---
            if (parsed.type === "tool_pending") {
              const { title: initialTitle, kind, rawInput: initialRawInput, toolCallId, status } = parsed.content;
              const currentMsgIdx = messages.indexOf(msg);

              // Pull enriched input/title from the first tool_call_update
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

              const resultMsg = messages.slice(currentMsgIdx + 1).find((m) => {
                const update = m.raw?.params?.update;
                return (
                  update?.toolCallId === toolCallId &&
                  update?.sessionUpdate === "tool_call_update" &&
                  (update?.status === "completed" || update?.status === "failed")
                );
              });
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
                  compact={true}
                />
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
                <ToolResultBubble
                  key={msg.id}
                  title={undefined}
                  kind={kind}
                  rawOutput={rawOutput}
                  timestamp={msg.timestamp}
                  compact={true}
                />
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
        {activeThread.status !== "idle" && (
          <StatusIndicatorPillMobile status={activeThread.status} />
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
