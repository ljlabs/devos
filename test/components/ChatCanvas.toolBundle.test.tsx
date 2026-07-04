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

const thread: Thread = {
  id: "thread-1",
  workspaceId: "ws-1",
  title: "Tool bundle test",
  status: "idle",
};

function buildToolCallBundle(toolCallId: string, command: string, output: string): Message[] {
  const threadId = thread.id;
  return [
    {
      id: toolCallId + "-call",
      threadId,
      timestamp: "2026-01-01T00:00:00Z",
      raw: {
        params: {
          update: {
            sessionUpdate: "tool_call",
            toolCallId,
            status: "pending",
            kind: "execute",
            title: "Terminal",
            rawInput: {},
            content: [],
          },
        },
      },
      type: "session/update",
    },
    {
      id: toolCallId + "-update-input",
      threadId,
      timestamp: "2026-01-01T00:00:01Z",
      raw: {
        params: {
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId,
            rawInput: { command: command, description: "Run " + command },
            title: "Bash",
            content: [],
          },
        },
      },
      type: "session/update",
    },
    {
      id: toolCallId + "-perm-req",
      threadId,
      timestamp: "2026-01-01T00:00:02Z",
      raw: {
        id: "perm-123",
        params: {
          toolCall: { toolCallId: toolCallId, name: "Bash", input: { command: command } },
          options: [
            { optionId: "approve", label: "Allow" },
            { optionId: "reject", label: "Deny" },
          ],
        },
      },
      type: "session/request_permission",
    },
    {
      id: toolCallId + "-perm-resp",
      threadId,
      timestamp: "2026-01-01T00:00:03Z",
      raw: { selected: { optionId: "approve" } },
      type: "permission_response",
    },
    {
      id: toolCallId + "-result",
      threadId,
      timestamp: "2026-01-01T00:00:04Z",
      raw: {
        params: {
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId,
            status: "completed",
            rawOutput: output,
            content: [],
          },
        },
      },
      type: "session/update",
    },
  ];
}

function renderWith(messages: Message[]) {
  return render(
    <ChatCanvas
      activeThread={thread}
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

describe("ChatCanvas tool bundle integrity with pagination", () => {
  describe("complete bundle all 5 messages present", () => {
    const bundle = buildToolCallBundle("tc-1", "npm test", "All 42 tests passed");

    it("renders resolved command from tool_call_update rawInput in the header", () => {
      renderWith(bundle);
      expect(screen.getByText(/npm test/)).toBeInTheDocument();
    });

    it("renders the Approved badge from permission_response", () => {
      renderWith(bundle);
      expect(screen.getByText(/Approved/)).toBeInTheDocument();
      expect(screen.queryByText(/Rejected/)).not.toBeInTheDocument();
    });

    it("shows the result toggle button when result exists", () => {
      renderWith(bundle);
      expect(screen.getByText(/Show output/)).toBeInTheDocument();
    });

    it("hides permission bubble when already answered", () => {
      renderWith(bundle);
      expect(screen.queryByText("Permission Required")).not.toBeInTheDocument();
    });

    it("expands to show tool output when clicked", async () => {
      const user = userEvent.setup();
      renderWith(bundle);
      const toggleBtn = screen.getByText(/Show output/);
      await user.click(toggleBtn);
      expect(screen.getByText(/All 42 tests passed/)).toBeInTheDocument();
      expect(screen.getByText(/Hide output/)).toBeInTheDocument();
    });
  });

  describe("truncated bundle missing permission and result messages", () => {
    const bundle = buildToolCallBundle("tc-2", "rm -rf dist", "deleted");
    const truncated = bundle.slice(0, 2);

    it("still resolves command from tool_call_update via look-ahead", () => {
      renderWith(truncated);
      expect(screen.getByText(/rm -rf dist/)).toBeInTheDocument();
    });

    it("does NOT show Approved or Rejected badge", () => {
      renderWith(truncated);
      expect(screen.queryByText(/Approved/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Rejected/)).not.toBeInTheDocument();
    });

    it("does NOT show Show output button", () => {
      renderWith(truncated);
      expect(screen.queryByText(/Show output/)).not.toBeInTheDocument();
    });

    it("does NOT show permission bubble", () => {
      renderWith(truncated);
      expect(screen.queryByText("Permission Required")).not.toBeInTheDocument();
    });
  });

  describe("pending permission request without response", () => {
    it("shows permission bubble when request has no response yet", () => {
      const permRequest: Message = {
        id: "perm-req-1",
        threadId: thread.id,
        timestamp: "2026-01-01T00:00:00Z",
        raw: {
          id: "perm-789",
          params: {
            toolCall: { toolCallId: "tc-pending", name: "Edit", input: { file_path: "/src/main.ts" } },
            options: [
              { optionId: "approve", label: "Allow" },
              { optionId: "reject", label: "Deny" },
            ],
          },
        },
        type: "session/request_permission",
      };
      renderWith([permRequest]);
      expect(screen.getByText("Permission Required")).toBeInTheDocument();
    });

    it("does NOT show permission bubble when response already exists", () => {
      const permRequest: Message = {
        id: "perm-req-2",
        threadId: thread.id,
        timestamp: "2026-01-01T00:00:00Z",
        raw: {
          id: "perm-800",
          params: {
            toolCall: { toolCallId: "tc-answered", name: "Edit", input: { file_path: "/src/main.ts" } },
            options: [
              { optionId: "approve", label: "Allow" },
              { optionId: "reject", label: "Deny" },
            ],
          },
        },
        type: "session/request_permission",
      };
      const permResponse: Message = {
        id: "perm-resp-1",
        threadId: thread.id,
        timestamp: "2026-01-01T00:00:01Z",
        raw: { selected: { optionId: "approve" } },
        type: "permission_response",
      };
      renderWith([permRequest, permResponse]);
      expect(screen.queryByText("Permission Required")).not.toBeInTheDocument();
    });
  });

  describe("orphaned tool_call_update with no preceding tool_call", () => {
    it("renders as standalone bubble with rawOutput when no tool_call exists", () => {
      const orphan: Message = {
        id: "orphan-1",
        threadId: thread.id,
        timestamp: "2026-01-01T00:00:00Z",
        raw: {
          params: {
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: "tc-orphan-1",
              status: "completed",
              kind: "read",
              title: "Read File",
              rawOutput: "file contents here",
              content: [],
            },
          },
        },
        type: "session/update",
      };
      renderWith([orphan]);
      expect(screen.getByText(/file contents here/)).toBeInTheDocument();
    });

    it("renders empty output for orphaned completed tool_call_update", () => {
      const orphan: Message = {
        id: "orphan-2",
        threadId: thread.id,
        timestamp: "2026-01-01T00:00:00Z",
        raw: {
          params: {
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: "tc-orphan-2",
              status: "completed",
              kind: "execute",
              title: "Terminal",
              rawOutput: "",
              content: [],
            },
          },
        },
        type: "session/update",
      };
      renderWith([orphan]);
      expect(screen.getByText(/Complete/)).toBeInTheDocument();
    });
  });

  describe("out-of-order messages", () => {
    it("tool_call_update arrives before its tool_call - both still render", () => {
      const result: Message = {
        id: "oor-result",
        threadId: thread.id,
        timestamp: "2026-01-01T00:00:00Z",
        raw: {
          params: {
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: "tc-oor-1",
              status: "completed",
              kind: "read",
              title: "Read File",
              rawOutput: "file contents",
              content: [],
            },
          },
        },
        type: "session/update",
      };
      const toolCall: Message = {
        id: "oor-call",
        threadId: thread.id,
        timestamp: "2026-01-01T00:00:01Z",
        raw: {
          params: {
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "tc-oor-1",
              status: "pending",
              kind: "read",
              title: "Read File",
              rawInput: { file_path: "/src/main.ts" },
              content: [],
            },
          },
        },
        type: "session/update",
      };
      renderWith([result, toolCall]);
      expect(screen.getByText(/file contents/)).toBeInTheDocument();
      expect(screen.getByText(/\/src\/main\.ts/)).toBeInTheDocument();
    });

    it("permission_response arrives before its permission_request", () => {
      const permResponse: Message = {
        id: "oor-perm-resp",
        threadId: thread.id,
        timestamp: "2026-01-01T00:00:00Z",
        raw: { selected: { optionId: "approve" } },
        type: "permission_response",
      };
      const permRequest: Message = {
        id: "oor-perm-req",
        threadId: thread.id,
        timestamp: "2026-01-01T00:00:01Z",
        raw: {
          id: "perm-oor-1",
          params: {
            toolCall: { toolCallId: "tc-oor-2", name: "Write", input: { file_path: "/out.ts" } },
            options: [
              { optionId: "approve", label: "Allow" },
            ],
          },
        },
        type: "session/request_permission",
      };
      renderWith([permResponse, permRequest]);
      expect(screen.getByText("Permission Required")).toBeInTheDocument();
    });
  });

  describe("skipping intermediate tool_call_update with no status and no rawOutput", () => {
    it("skips tool_call_update that only has rawInput enrichment", () => {
      const intermediate: Message = {
        id: "intermediate-1",
        threadId: thread.id,
        timestamp: "2026-01-01T00:00:00Z",
        raw: {
          params: {
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: "tc-inter-1",
              rawInput: { command: "ls" },
              content: [],
            },
          },
        },
        type: "session/update",
      };
      renderWith([intermediate]);
      expect(screen.queryByText(/Complete/)).not.toBeInTheDocument();
    });
  });

  describe("multiple tool calls interleaved", () => {
    it("each bundle resolves independently when all messages present", () => {
      const bundle1 = buildToolCallBundle("tc-a", "npm install", "added 0 packages");
      const bundle2 = buildToolCallBundle("tc-b", "npm run build", "Build complete");
      renderWith([...bundle1, ...bundle2]);
      expect(screen.getByText(/npm install/)).toBeInTheDocument();
      expect(screen.getByText(/npm run build/)).toBeInTheDocument();
      const approvedBadges = screen.getAllByText(/Approved/);
      expect(approvedBadges).toHaveLength(2);
      const expandButtons = screen.getAllByText(/Show output/);
      expect(expandButtons).toHaveLength(2);
    });

    it("second bundle degrades gracefully when first bundle is truncated", () => {
      const bundle1 = buildToolCallBundle("tc-c", "pytest", "5 passed");
      const bundle2 = buildToolCallBundle("tc-d", "cargo test", "2 passed");
      const truncatedBundle1 = bundle1.slice(0, 2);
      renderWith([...truncatedBundle1, ...bundle2]);
      expect(screen.getByText(/pytest/)).toBeInTheDocument();
      expect(screen.getByText(/cargo test/)).toBeInTheDocument();
      expect(screen.getByText(/Approved/)).toBeInTheDocument();
      expect(screen.getByText(/Show output/)).toBeInTheDocument();
    });
  });

  describe("three tools complete orphaned and pending simultaneously", () => {
    it("renders each in its correct state", () => {
      const complete = buildToolCallBundle("tc-full", "npm test", "10 pass");
      const orphan: Message = {
        id: "orphan-mix",
        threadId: thread.id,
        timestamp: "2026-01-01T00:00:10Z",
        raw: {
          params: {
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: "tc-orphan-mix",
              status: "completed",
              kind: "read",
              title: "Read",
              rawOutput: "orphan content",
              content: [],
            },
          },
        },
        type: "session/update",
      };
      const pending: Message = {
        id: "pending-mix",
        threadId: thread.id,
        timestamp: "2026-01-01T00:00:11Z",
        raw: {
          params: {
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "tc-pending-mix",
              status: "pending",
              kind: "execute",
              title: "Terminal",
              rawInput: { command: "docker build" },
              content: [],
            },
          },
        },
        type: "session/update",
      };
      renderWith([...complete, orphan, pending]);
      expect(screen.getByText(/npm test/)).toBeInTheDocument();
      expect(screen.getByText(/Approved/)).toBeInTheDocument();
      expect(screen.getByText(/Show output/)).toBeInTheDocument();
      expect(screen.getByText(/orphan content/)).toBeInTheDocument();
      expect(screen.getByText(/docker build/)).toBeInTheDocument();
    });
  });
});
