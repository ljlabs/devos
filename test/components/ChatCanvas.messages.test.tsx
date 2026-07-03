import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import ChatCanvas from "../../src/components/ChatCanvas";
import { Thread, Message } from "../../src/types";
import mockedMessages from "../static/mocked_messages_input.json";

const mockOnChangeInput = vi.fn();
const mockOnSendMessage = vi.fn();
const mockOnCancelAgent = vi.fn();
const mockOnPermissionResponse = vi.fn();
const mockOnDeploy = vi.fn();
const mockOnClearThreadLogs = vi.fn();

const sampleThread: Thread = {
  id: "thread-1783053124173",
  workspaceId: "ws-1",
  title: "Issue #50 Test Coverage",
  status: "idle",
};

const baseProps = {
  activeThread: sampleThread,
  messages: mockedMessages as Message[],
  inputText: "",
  onChangeInput: mockOnChangeInput,
  onSendMessage: mockOnSendMessage,
  onCancelAgent: mockOnCancelAgent,
  onPermissionResponse: mockOnPermissionResponse,
  onDeploy: mockOnDeploy,
  isDeploying: false,
  threadLogs: [],
  onClearThreadLogs: mockOnClearThreadLogs,
};

/**
 * Classify which tool calls should have visible badges and which should not.
 * Only tools with a matching session/request_permission should show a badge.
 */
function classifyTools(messages: Message[]) {
  const toolCalls = messages.filter(
    (m) => m.raw?.params?.update?.sessionUpdate === "tool_call" && m.raw?.params?.update?.toolCallId
  );

  const toolCallIdsWithPermission = new Set<string>();
  const permissionRequests = messages.filter(
    (m) => m.type === "session/request_permission"
  );
  for (const perm of permissionRequests) {
    const tcId = perm.raw?.params?.toolCall?.toolCallId;
    if (tcId) toolCallIdsWithPermission.add(tcId);
  }

  const result: Array<{
    toolCallId: string;
    kind: string;
    title: string;
    hasPermissionRequest: boolean;
    completed: boolean;
    hasRawOutput: boolean;
  }> = [];

  for (const tc of toolCalls) {
    const update = tc.raw.params.update;
    const tcId = update.toolCallId;

    const completedUpdate = messages.find((m) => {
      const u = m.raw?.params?.update;
      return (
        u?.toolCallId === tcId &&
        u?.sessionUpdate === "tool_call_update" &&
        u?.status === "completed"
      );
    });

    result.push({
      toolCallId: tcId,
      kind: update.kind || "unknown",
      title: update.title || "pending…",
      hasPermissionRequest: toolCallIdsWithPermission.has(tcId),
      completed: !!completedUpdate,
      hasRawOutput: !!completedUpdate?.raw?.params?.update?.rawOutput,
    });
  }

  return result;
}

describe("ChatCanvas — full mocked conversation", () => {
  const toolClassification = classifyTools(mockedMessages as Message[]);

  it("should render the chat canvas without crashing", () => {
    const { container } = render(<ChatCanvas {...baseProps} />);
    expect(container).toBeInTheDocument();
  });

  it("should render all user messages", () => {
    const userMessages = (mockedMessages as Message[]).filter(
      (m) => m.raw?.role === "user"
    );
    expect(userMessages.length).toBeGreaterThan(0);

    const { container } = render(<ChatCanvas {...baseProps} />);

    for (const msg of userMessages) {
      const content = (msg.raw.content as string).trim();
      // User content may be split across elements by markdown/link rendering,
      // so just verify the container contains the text (ignoring element boundaries)
      expect(container.textContent).toContain(content);
    }
  });

  it("should render tool call bubbles for every tool call in the log", () => {
    render(<ChatCanvas {...baseProps} />);

    for (const tool of toolClassification) {
      const kindLabel = tool.kind.toUpperCase();

      // Every tool should have its kind rendered somewhere in a tool bubble header
      const headers = screen.getAllByText(new RegExp(`^${kindLabel}:`));
      expect(headers.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("should show Completed badge for every completed tool call", () => {
    render(<ChatCanvas {...baseProps} />);

    const completedTools = toolClassification.filter((t) => t.completed);
    expect(completedTools.length).toBeGreaterThan(0);

    // Completed tools without failures show the terminal icon (no ✗ Failed badge)
    // and have a "Show output" button — verify that completed tools are expandable
    const showOutputButtons = screen.getAllByText(/Show output/);
    // Completed tools that have rawOutput should have expand buttons
    const toolsWithOutput = completedTools.filter((t) => t.hasRawOutput);
    expect(showOutputButtons.length).toBeGreaterThanOrEqual(toolsWithOutput.length);
  });

  it("should NOT show Approved/Rejected badges on tools without permission requests", () => {
    render(<ChatCanvas {...baseProps} />);

    const toolsWithoutPermission = toolClassification.filter(
      (t) => !t.hasPermissionRequest
    );
    expect(toolsWithoutPermission.length).toBeGreaterThan(0);

    // None of these should have an approval/rejection badge
    const approvedBadges = screen.queryAllByText(/✓ Approved/);
    const rejectedBadges = screen.queryAllByText(/✗ Rejected/);

    // At most the 3 permission-requested tools should have badges
    const toolsWithPermission = toolClassification.filter(
      (t) => t.hasPermissionRequest
    );
    expect(approvedBadges.length + rejectedBadges.length).toBeLessThanOrEqual(
      toolsWithPermission.length
    );
  });

  it("should not show 'Rejected' for any tool that actually completed successfully", () => {
    render(<ChatCanvas {...baseProps} />);

    const rejectedBadges = screen.queryAllByText(/✗ Rejected/);

    // Find which toolCallIds have permission requests
    const permRequestedIds = new Set(
      toolClassification.filter((t) => t.hasPermissionRequest).map((t) => t.toolCallId)
    );

    // Every completed tool that had a permission request should be Approved,
    // not Rejected (the permission responses in this log are all approvals)
    for (const badge of rejectedBadges) {
      // Find which tool bubble this badge is inside
      const toolBubble = badge.closest("div.flex");
      expect(toolBubble).toBeInTheDocument();
      // It should not be inside a completed tool's bubble
      // (badges only appear on permission-requested tools, which were all approved)
    }

    // Since all 3 permission responses in this log are approvals (allow_always, allow_always, acceptEdits),
    // there should be ZERO rejected badges
    expect(rejectedBadges.length).toBe(0);
  });

  it("should hide permission request bubbles that have already been responded to", () => {
    render(<ChatCanvas {...baseProps} />);

    const permissionRequests = (mockedMessages as Message[]).filter(
      (m) => m.type === "session/request_permission"
    );
    expect(permissionRequests.length).toBe(3);

    // All 3 permission requests in this log have a matching permission_response
    // after them, so the "Permission Required" heading should not appear
    expect(screen.queryByText("Permission Required")).not.toBeInTheDocument();
  });
});

describe("ChatCanvas — WebSocket permission approval flow", () => {
  const wsMessages: Message[] = [
    {
      id: "msg-1",
      threadId: "thread-1",
      timestamp: "2026-07-03T05:14:11.777Z",
      raw: { jsonrpc: "2.0", method: "session/update", params: { sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Let me check if the file compiles correctly now." }, messageId: "gen-1" } } },
      type: "session/update",
    },
    {
      id: "msg-2",
      threadId: "thread-1",
      timestamp: "2026-07-03T05:14:12.043Z",
      raw: { jsonrpc: "2.0", method: "session/update", params: { sessionId: "s1", update: { _meta: { claudeCode: { toolName: "Bash" } }, toolCallId: "toolu_4832a351ad37d1c5", sessionUpdate: "tool_call", rawInput: {}, status: "pending", title: "Terminal", kind: "execute", content: [] } } },
      type: "session/update",
    },
    {
      id: "msg-3",
      threadId: "thread-1",
      timestamp: "2026-07-03T05:14:12.194Z",
      raw: { jsonrpc: "2.0", method: "session/update", params: { sessionId: "s1", update: { _meta: { claudeCode: { toolName: "Bash" } }, toolCallId: "toolu_4832a351ad37d1c5", sessionUpdate: "tool_call_update", rawInput: { command: 'npx tsc --noEmit 2>&1 | grep "getCustomerProgramData.test" | head -5', description: "Check TypeScript errors in the test file", timeout: 30000 }, title: 'npx tsc --noEmit 2>&1 | grep "getCustomerProgramData.test" | head -5', kind: "execute", content: [{ type: "content", content: { type: "text", text: "Check TypeScript errors in the test file" } }] } } },
      type: "session/update",
    },
    {
      id: "msg-4",
      threadId: "thread-1",
      timestamp: "2026-07-03T05:14:12.467Z",
      raw: { jsonrpc: "2.0", id: 3, method: "session/request_permission", params: { options: [{ kind: "allow_always", name: 'Always Allow Bash(npx tsc *)', optionId: "allow_always" }, { kind: "allow_once", name: "Allow", optionId: "allow" }, { kind: "reject_once", name: "Reject", optionId: "reject" }], sessionId: "s1", toolCall: { toolCallId: "toolu_4832a351ad37d1c5", rawInput: { command: 'npx tsc --noEmit 2>&1 | grep "getCustomerProgramData.test" | head -5', timeout: 30000, description: "Check TypeScript errors in the test file" }, title: 'npx tsc --noEmit 2>&1 | grep "getCustomerProgramData.test" | head -5', kind: "execute", content: [{ type: "content", content: { type: "text", text: "Check TypeScript errors in the test file" } }] } } },
      type: "session/request_permission",
    },
  ];

  const wsPermissionResponse: Message = {
    id: "msg-perm-1",
    threadId: "thread-1",
    timestamp: "2026-07-03T05:17:53.491Z",
    raw: { selected: { optionId: "allow_always" } },
    type: "permission_response",
  };

  const wsToolCompleted: Message = {
    id: "msg-5",
    threadId: "thread-1",
    timestamp: "2026-07-03T05:18:24.206Z",
    raw: { jsonrpc: "2.0", method: "session/update", params: { sessionId: "s1", update: { _meta: { claudeCode: { toolName: "Bash" } }, toolCallId: "toolu_4832a351ad37d1c5", sessionUpdate: "tool_call_update", status: "completed", rawOutput: "Command running in background with ID: bp6grs3uq." } } },
    type: "session/update",
  };

  function renderWithMessages(messages: Message[]) {
    let currentMessages = [...messages];
    let rerenderFn: ReturnType<typeof render>["rerender"];

    const thread: Thread = { id: "thread-1", workspaceId: "ws-1", title: "Test Thread", status: "idle" };
    const result = render(
      <ChatCanvas
        activeThread={thread}
        messages={currentMessages}
        inputText=""
        onChangeInput={mockOnChangeInput}
        onSendMessage={mockOnSendMessage}
        onCancelAgent={mockOnCancelAgent}
        onPermissionResponse={mockOnPermissionResponse}
        onDeploy={mockOnDeploy}
        isDeploying={false}
        threadLogs={[]}
        onClearThreadLogs={mockOnClearThreadLogs}
      />
    );
    rerenderFn = result.rerender;

    function appendMessage(msg: Message) {
      currentMessages = [...currentMessages, msg];
      rerenderFn(
        <ChatCanvas
          activeThread={{ ...thread, status: "awaiting_permission" }}
          messages={currentMessages}
          inputText=""
          onChangeInput={mockOnChangeInput}
          onSendMessage={mockOnSendMessage}
          onCancelAgent={mockOnCancelAgent}
          onPermissionResponse={mockOnPermissionResponse}
          onDeploy={mockOnDeploy}
          isDeploying={false}
          threadLogs={[]}
          onClearThreadLogs={mockOnClearThreadLogs}
        />
      );
    }

    function setStatus(status: Thread["status"]) {
      rerenderFn(
        <ChatCanvas
          activeThread={{ ...thread, status }}
          messages={currentMessages}
          inputText=""
          onChangeInput={mockOnChangeInput}
          onSendMessage={mockOnSendMessage}
          onCancelAgent={mockOnCancelAgent}
          onPermissionResponse={mockOnPermissionResponse}
          onDeploy={mockOnDeploy}
          isDeploying={false}
          threadLogs={[]}
          onClearThreadLogs={mockOnClearThreadLogs}
        />
      );
    }

    return { ...result, appendMessage, setStatus, getMessages: () => currentMessages };
  }

  it("should show permission bubble when request arrives via WebSocket", () => {
    // Start with messages 1-3 (no permission request yet)
    const { appendMessage } = renderWithMessages(wsMessages.slice(0, 3));

    // No permission bubble visible
    expect(screen.queryByText("Permission Required")).not.toBeInTheDocument();

    // The tool header should show the enriched input
    expect(screen.getByText(/EXECUTE.*npx tsc/)).toBeInTheDocument();

    // WebSocket delivers the permission request
    act(() => { appendMessage(wsMessages[3]); });

    // Permission bubble should now be visible
    expect(screen.getByText("Permission Required")).toBeInTheDocument();
    expect(screen.getByText(/Always Allow Bash/)).toBeInTheDocument();
  });

  it("should hide permission bubble when response arrives via WebSocket", () => {
    // Start with all 4 messages (permission request is pending)
    const { appendMessage, setStatus } = renderWithMessages([...wsMessages]);

    // Permission bubble is visible
    expect(screen.getByText("Permission Required")).toBeInTheDocument();

    // User clicks approve → WebSocket delivers the permission response
    act(() => {
      setStatus("thinking");
      appendMessage(wsPermissionResponse);
    });

    // Permission bubble should disappear
    expect(screen.queryByText("Permission Required")).not.toBeInTheDocument();
  });

  it("should show tool as approved after permission response arrives", () => {
    // Start with all 4 messages, permission pending
    const { appendMessage, setStatus } = renderWithMessages([...wsMessages]);

    // No approved badge yet (permission is pending, not answered)
    expect(screen.queryByText(/✓ Approved/)).not.toBeInTheDocument();
    expect(screen.queryByText(/✗ Rejected/)).not.toBeInTheDocument();

    // Permission response arrives via WebSocket
    act(() => {
      setStatus("thinking");
      appendMessage(wsPermissionResponse);
    });

    // Tool should now show Approved badge
    expect(screen.getByText("✓ Approved")).toBeInTheDocument();
    expect(screen.queryByText(/✗ Rejected/)).not.toBeInTheDocument();
  });

  it("should show tool result after completed status arrives via WebSocket", () => {
    const { appendMessage, setStatus } = renderWithMessages([...wsMessages]);

    // No "Show output" button yet (tool hasn't completed)
    expect(screen.queryByText(/Show output/)).not.toBeInTheDocument();

    // Permission response arrives
    act(() => {
      setStatus("thinking");
      appendMessage(wsPermissionResponse);
    });

    // Completed tool_update arrives
    act(() => {
      appendMessage(wsToolCompleted);
    });

    // Now "Show output" should be visible
    expect(screen.getByText(/Show output/)).toBeInTheDocument();
  });

  it("should reject tool when reject option is chosen via WebSocket", () => {
    const { appendMessage, setStatus } = renderWithMessages([...wsMessages]);

    const rejectResponse: Message = {
      id: "msg-perm-reject",
      threadId: "thread-1",
      timestamp: "2026-07-03T05:17:55.000Z",
      raw: { selected: { optionId: "reject" } },
      type: "permission_response",
    };

    act(() => {
      setStatus("thinking");
      appendMessage(rejectResponse);
    });

    // Permission bubble gone
    expect(screen.queryByText("Permission Required")).not.toBeInTheDocument();
    // Tool shows rejected badge
    expect(screen.getByText("✗ Rejected")).toBeInTheDocument();
    expect(screen.queryByText(/✓ Approved/)).not.toBeInTheDocument();
  });

  it("should not show false approval badges on other tools without permission requests", () => {
    // Add a second tool that has NO permission request
    const extraTool: Message = {
      id: "msg-extra",
      threadId: "thread-1",
      timestamp: "2026-07-03T05:14:00.000Z",
      raw: { jsonrpc: "2.0", method: "session/update", params: { sessionId: "s1", update: { _meta: { claudeCode: { toolName: "Read" } }, toolCallId: "toolu_extra_no_perm", sessionUpdate: "tool_call", rawInput: {}, status: "pending", title: "Read File", kind: "read", content: [] } } },
      type: "session/update",
    };

    const extraToolUpdate: Message = {
      id: "msg-extra-update",
      threadId: "thread-1",
      timestamp: "2026-07-03T05:14:01.000Z",
      raw: { jsonrpc: "2.0", method: "session/update", params: { sessionId: "s1", update: { _meta: { claudeCode: { toolName: "Read" } }, toolCallId: "toolu_extra_no_perm", sessionUpdate: "tool_call_update", status: "completed", rawOutput: "file contents here" } } },
      type: "session/update",
    };

    const { appendMessage, setStatus } = renderWithMessages([
      extraTool,
      extraToolUpdate,
      ...wsMessages,
    ]);

    // Approve the Bash tool
    act(() => {
      setStatus("thinking");
      appendMessage(wsPermissionResponse);
    });

    // Only the Bash tool should have Approved, not the Read tool
    const approvedBadges = screen.queryAllByText("✓ Approved");
    expect(approvedBadges.length).toBe(1);

    // No rejected badges
    expect(screen.queryAllByText("✗ Rejected").length).toBe(0);
  });
});
