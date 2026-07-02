/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ChatPage — mobile route: /messages/:workspaceId/:threadId
 * Chat view for a thread with bottom nav to switch to IDE panels.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import MobileChatCanvas from "../components/MobileChatCanvas";
import MobileBottomNav from "../components/MobileBottomNav";
import MobileIdeView from "../components/MobileIdeView";
import { IdePanel, Thread, Message } from "../types";
import { useWebSocket } from "../hooks/useWebSocket";
import { useOptimisticMessages } from "../hooks/useOptimisticMessages";

export default function ChatPage() {
  const { workspaceId, threadId } = useParams<{ workspaceId: string; threadId: string }>();
  const navigate = useNavigate();

  const [thread, setThread] = useState<Thread | null>(null);
  const [workspacePath, setWorkspacePath] = useState<string>("");
  const [idePanel, setIdePanel] = useState<IdePanel>("chat");
  const [inputText, setInputText] = useState("");
  const [isDeploying, setIsDeploying] = useState(false);
  const [threadLogs, setThreadLogs] = useState<any[]>([]);
  const threadSseRef = useRef<EventSource | null>(null);

  const {
    messages,
    addOptimistic,
    confirmMessage,
    setConfirmed,
    appendMessage,
    clearOptimistic,
  } = useOptimisticMessages();

  const handleWsMessage = useCallback((msg: Message) => appendMessage(msg), [appendMessage]);
  const handleWsThreadUpdate = useCallback((t: Thread) => setThread(prev => prev?.id === t.id ? t : prev), []);
  const handleWsAck = useCallback((clientMsgId: string, message: Message) => confirmMessage(clientMsgId, message), [confirmMessage]);
  const handleWsSubscribed = useCallback((_tid: string, msgs: Message[]) => setConfirmed(msgs), [setConfirmed]);

  const { sendMessage: wsSendMessage, respondToPermission: wsRespond, cancelAgent: wsCancel } = useWebSocket({
    threadId: threadId || null,
    onMessage: handleWsMessage,
    onThreadUpdate: handleWsThreadUpdate,
    onAck: handleWsAck,
    onSubscribed: handleWsSubscribed,
    onConnectionChange: () => {},
  });

  // Load thread + workspace path
  useEffect(() => {
    if (!threadId || !workspaceId) return;

    fetch(`/api/threads/${threadId}/messages`)
      .then(r => r.ok ? r.json() : [])
      .then(setConfirmed)
      .catch(console.error);

    fetch(`/api/workspaces/${workspaceId}`)
      .then(r => r.ok ? r.json() : null)
      .then(ws => ws && setWorkspacePath(ws.path))
      .catch(console.error);

    // Get thread info via threads list
    fetch(`/api/workspaces/${workspaceId}/threads`)
      .then(r => r.ok ? r.json() : [])
      .then((threads: Thread[]) => {
        const t = threads.find(t => t.id === threadId);
        if (t) setThread(t);
      })
      .catch(console.error);
  }, [threadId, workspaceId, setConfirmed]);

  // SSE: Thread logs
  useEffect(() => {
    if (threadSseRef.current) { threadSseRef.current.close(); threadSseRef.current = null; }
    if (!threadId) return;
    const es = new EventSource(`/api/threads/${threadId}/logs`);
    threadSseRef.current = es;
    es.onmessage = (event) => {
      try { setThreadLogs(prev => [JSON.parse(event.data), ...prev]); } catch {}
    };
    return () => { es.close(); threadSseRef.current = null; };
  }, [threadId]);

  const handleSendMessage = () => {
    if (!inputText.trim() || !threadId) return;
    const text = inputText;
    setInputText("");
    const clientMsgId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    addOptimistic(threadId, text, clientMsgId);
    wsSendMessage(threadId, text, clientMsgId);
  };

  const handlePermissionResponse = (optionId: string, toolCommand?: string, toolName?: string) => {
    if (threadId) wsRespond(threadId, optionId, toolCommand, toolName);
  };

  const handleCancelAgent = () => { if (threadId) wsCancel(threadId); };

  const handleDeploy = () => {
    setIsDeploying(true);
    setTimeout(() => setIsDeploying(false), 2500);
  };

  return (
    <div
      className="w-screen bg-[#0B0B0C] text-[#e4e2e4] font-sans antialiased flex flex-col"
      style={{ height: '100dvh', position: 'fixed', inset: 0 }}
    >
      {/* IDE Panels — fills space above bottom nav */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {idePanel === "chat" && (
          <MobileChatCanvas
            activeThread={thread}
            messages={messages}
            inputText={inputText}
            onChangeInput={setInputText}
            onSendMessage={handleSendMessage}
            onCancelAgent={handleCancelAgent}
            onPermissionResponse={handlePermissionResponse}
            onDeploy={handleDeploy}
            isDeploying={isDeploying}
            threadLogs={threadLogs}
            workspacePath={workspacePath}
            onBack={() => navigate(`/messages/${workspaceId}`)}
          />
        )}
        {(idePanel === "files" || idePanel === "editor") && (
          <MobileIdeView
            panel={idePanel}
            workspaceId={workspaceId || ""}
            threadTitle={thread?.title}
            threadLogs={threadLogs}
            onBack={() => setIdePanel("chat")}
          />
        )}
      </div>

      {/* Bottom nav */}
      <MobileBottomNav
        active={idePanel}
        onChange={setIdePanel}
        hasActiveThread={!!thread}
      />
    </div>
  );
}
