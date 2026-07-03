import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatCanvas from "../../src/components/ChatCanvas";
import { Thread, Message } from "../../src/types";

const mockOnChangeInput = vi.fn();
const mockOnSendMessage = vi.fn();
const mockOnCancelAgent = vi.fn();
const mockOnPermissionResponse = vi.fn();
const mockOnDeploy = vi.fn();
const mockOnClearThreadLogs = vi.fn();

// Stage 1: tool_call arrives (initial, empty rawInput)
const msgToolCall: Message = {
  id: "msg-1783059709426-hqztyu4s2i",
  threadId: "thread-1783053124173",
  timestamp: "2026-07-03T06:21:49.426Z",
  raw: {
    jsonrpc: "2.0", method: "session/update",
    params: {
      sessionId: "95513f8d",
      update: {
        _meta: { claudeCode: { toolName: "Bash" } },
        toolCallId: "toolu_a98b81e9296d4ed5",
        sessionUpdate: "tool_call",
        rawInput: {}, status: "pending",
        title: "Terminal", kind: "execute", content: [],
      },
    },
  },
  type: "session/update",
};

// Stage 2: tool_call_update with real rawInput arrives
const msgToolCallUpdate: Message = {
  id: "msg-1783059709925-fy3c3kl5yi",
  threadId: "thread-1783053124173",
  timestamp: "2026-07-03T06:21:49.925Z",
  raw: {
    jsonrpc: "2.0", method: "session/update",
    params: {
      sessionId: "95513f8d",
      update: {
        _meta: { claudeCode: { toolName: "Bash" } },
        toolCallId: "toolu_a98b81e9296d4ed5",
        sessionUpdate: "tool_call_update",
        rawInput: {
          command: "npm test 2>&1 | tail -40",
          description: "Run full test suite from functions dir",
          timeout: 300000,
        },
        title: "npm test 2>&1 | tail -40",
        kind: "execute",
        content: [{ type: "content", content: { type: "text", text: "Run full test suite from functions dir" } }],
      },
    },
  },
  type: "session/update",
};

// Stage 3: session/request_permission arrives
const msgPermissionRequest: Message = {
  id: "msg-1783059710188-o73k1cib2c",
  threadId: "thread-1783053124173",
  timestamp: "2026-07-03T06:21:50.188Z",
  raw: {
    jsonrpc: "2.0", id: 1,
    method: "session/request_permission",
    params: {
      options: [
        { kind: "allow_always", name: "Always Allow Bash(npm test *)", optionId: "allow_always" },
        { kind: "allow_once", name: "Allow", optionId: "allow" },
        { kind: "reject_once", name: "Reject", optionId: "reject" },
      ],
      sessionId: "95513f8d",
      toolCall: {
        toolCallId: "toolu_a98b81e9296d4ed5",
        rawInput: { command: "npm test 2>&1 | tail -40", timeout: 300000, description: "Run full test suite from functions dir" },
        title: "npm test 2>&1 | tail -40",
        kind: "execute",
        content: [{ type: "content", content: { type: "text", text: "Run full test suite from functions dir" } }],
      },
    },
  },
  type: "session/request_permission",
};

// Stage 4: permission response (what the server SHOULD broadcast back)
const msgPermissionResponse: Message = {
  id: "msg-perm-1783059710500",
  threadId: "thread-1783053124173",
  timestamp: "2026-07-03T06:21:50.500Z",
  raw: { selected: { optionId: "allow" } },
  type: "permission_response",
};

// Stage 5: tool_call_update with toolResponse (intermediate, no status)
const msgToolResponse: Message = {
  id: "msg-1783059710599-abc123",
  threadId: "thread-1783053124173",
  timestamp: "2026-07-03T06:22:30.599Z",
  raw: {
    jsonrpc: "2.0", method: "session/update",
    params: {
      sessionId: "95513f8d",
      update: {
        _meta: {
          claudeCode: {
            toolResponse: {
              stdout: "", stderr: "", interrupted: false,
              isImage: false, noOutputExpected: false,
            },
            toolName: "Bash",
          },
        },
        toolCallId: "toolu_a98b81e9296d4ed5",
        sessionUpdate: "tool_call_update",
      },
    },
  },
  type: "session/update",
};

// Stage 6: tool_call_update completed with rawOutput
const msgToolCompleted: Message = {
  id: "msg-1783059705399-hxzdmyhugq",
  threadId: "thread-1783053124173",
  timestamp: "2026-07-03T06:21:45.399Z",
  raw: {
    jsonrpc: "2.0", method: "session/update",
    params: {
      sessionId: "95513f8d",
      update: {
        _meta: { claudeCode: { toolName: "Bash" } },
        toolCallId: "toolu_a98b81e9296d4ed5",
        sessionUpdate: "tool_call_update",
        status: "completed",
        rawOutput: 'npm error Missing script: "test"\nnpm error\nnpm error To see a list of scripts, run:\nnpm error   npm run\nnpm error A complete log of this run can be found in: /home/kyle/.npm/_logs/2026-07-03T06_21_44_896Z-debug-0.log',
        content: [{ type: "content", content: { type: "text", text: '```console\nnpm error Missing script: "test"\n```' } }],
      },
    },
  },
  type: "session/update",
};

describe("ChatCanvas — WebSocket permission flow (staged)", () => {
  const thread: Thread = {
    id: "thread-1783053124173",
    workspaceId: "ws-1",
    title: "Untitled",
    status: "idle",
  };

  function renderWith(messages: Message[], threadStatus: Thread["status"] = "idle") {
    return render(
      <ChatCanvas
        activeThread={{ ...thread, status: threadStatus }}
        messages={messages}
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

  // --- Stage 1: tool_call arrives ---
  it("Stage 1: tool_call arrives — shows pending tool bubble", () => {
    renderWith([msgToolCall]);

    // Tool header should show "EXECUTE: Terminal" (generic title, empty rawInput)
    expect(screen.getByText(/EXECUTE.*Terminal/)).toBeInTheDocument();
    // No permission badge
    expect(screen.queryByText(/Approved/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Rejected/)).not.toBeInTheDocument();
    // No permission bubble
    expect(screen.queryByText("Permission Required")).not.toBeInTheDocument();
  });

  // --- Stage 2: tool_call_update with real rawInput arrives ---
  it("Stage 2: tool_call_update arrives — shows enriched command in header", () => {
    renderWith([msgToolCall, msgToolCallUpdate]);

    // Should now show the real command, not "Terminal"
    expect(screen.getByText(/npm test 2>&1 \| tail -40/)).toBeInTheDocument();
    // Still no permission badge
    expect(screen.queryByText(/Approved/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Rejected/)).not.toBeInTheDocument();
    // Still no permission bubble
    expect(screen.queryByText("Permission Required")).not.toBeInTheDocument();
  });

  // --- Stage 3: session/request_permission arrives ---
  it("Stage 3: permission request arrives — shows permission bubble", () => {
    renderWith([msgToolCall, msgToolCallUpdate, msgPermissionRequest]);

    // Permission bubble should be visible
    expect(screen.getByText("Permission Required")).toBeInTheDocument();
    // Should show the Allow / Reject buttons
    expect(screen.getByText("Allow")).toBeInTheDocument();
    expect(screen.getByText("Reject")).toBeInTheDocument();
    expect(screen.getByText(/Always Allow Bash/)).toBeInTheDocument();
    // Tool header should still be there (appears in both tool bubble AND permission bubble)
    const cmdElements = screen.getAllByText(/npm test 2>&1 \| tail -40/);
    expect(cmdElements.length).toBeGreaterThanOrEqual(2);
  });

  // --- Stage 4: permission response arrives (server broadcasts it) ---
  it("Stage 4: permission response arrives — bubble hides, tool shows Approved", () => {
    renderWith([
      msgToolCall, msgToolCallUpdate, msgPermissionRequest,
      msgPermissionResponse,
    ], "thinking");

    // Permission bubble should be gone
    expect(screen.queryByText("Permission Required")).not.toBeInTheDocument();
    // Tool should show Approved badge
    expect(screen.getByText("✓ Approved")).toBeInTheDocument();
    // No rejected badge
    expect(screen.queryByText(/✗ Rejected/)).not.toBeInTheDocument();
  });

  // --- Stage 5-6: tool response + completed arrive ---
  it("Stage 5: tool completes — shows expand button, approved badge persists", () => {
    renderWith([
      msgToolCall, msgToolCallUpdate, msgPermissionRequest,
      msgPermissionResponse,
      msgToolResponse, msgToolCompleted,
    ], "thinking");

    // Permission bubble still gone
    expect(screen.queryByText("Permission Required")).not.toBeInTheDocument();
    // Approved badge still present
    expect(screen.getByText("✓ Approved")).toBeInTheDocument();
    // Expand button should be visible
    expect(screen.getByText(/Show output/)).toBeInTheDocument();
  });

  // --- Full flow: expand to see output ---
  it("Stage 6: expand tool — shows output content with approved badge", async () => {
    const user = userEvent.setup();

    renderWith([
      msgToolCall, msgToolCallUpdate, msgPermissionRequest,
      msgPermissionResponse,
      msgToolResponse, msgToolCompleted,
    ], "thinking");

    // Click expand
    const expandBtn = screen.getByText(/Show output/);
    await user.click(expandBtn);

    // Output should be visible
    expect(screen.getByText(/Missing script/)).toBeInTheDocument();
    // Approved badge still present
    expect(screen.getByText("✓ Approved")).toBeInTheDocument();
    // Button should now say "Hide output"
    expect(screen.getByText(/Hide output/)).toBeInTheDocument();
  });
});
