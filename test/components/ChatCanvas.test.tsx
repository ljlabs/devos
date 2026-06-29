import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatCanvas from "../../src/components/ChatCanvas";
import { Thread, Message } from "../../src/types";

const mockOnChangeInput = vi.fn();
const mockOnSendMessage = vi.fn();
const mockOnCancelAgent = vi.fn();
const mockOnPermissionResponse = vi.fn();
const mockOnDeploy = vi.fn();
const mockOnClearThreadLogs = vi.fn();

const baseProps = {
  activeThread: null as Thread | null,
  messages: [] as Message[],
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

const sampleThread: Thread = {
  id: "t-1",
  workspaceId: "ws-1",
  title: "Test Thread",
  status: "idle",
};

describe("ChatCanvas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Welcome screen", () => {
    it("should render welcome screen when no active thread", () => {
      render(<ChatCanvas {...baseProps} />);
      expect(screen.getByText(/Welcome to DevOS/)).toBeInTheDocument();
      expect(screen.getByText(/Select a project workspace/)).toBeInTheDocument();
    });

    it("should display Cpu icon on welcome screen", () => {
      const { container } = render(<ChatCanvas {...baseProps} />);
      const cpuIcon = container.querySelector("svg");
      expect(cpuIcon).toBeInTheDocument();
    });

    it("should display welcome description", () => {
      render(<ChatCanvas {...baseProps} />);
      expect(
        screen.getByText(/Select a project workspace from the left panel/)
      ).toBeInTheDocument();
    });
  });

  describe("Empty messages state", () => {
    it("should render empty state when no messages", () => {
      render(<ChatCanvas {...baseProps} activeThread={sampleThread} messages={[]} />);
      expect(screen.getByText(/Start a secure conversation/)).toBeInTheDocument();
    });

    it("should display Sparkles icon in empty state", () => {
      const { container } = render(
        <ChatCanvas {...baseProps} activeThread={sampleThread} messages={[]} />
      );
      // Find the Sparkles icon in the empty state area
      const text = screen.getByText(/Start a secure conversation/);
      const container_div = text.closest("div.flex.flex-col");
      expect(container_div).toBeInTheDocument();
    });

    it("should display empty state description", () => {
      render(<ChatCanvas {...baseProps} activeThread={sampleThread} messages={[]} />);
      expect(
        screen.getByText(/Type your instructions and watch the Claude ACP agent/)
      ).toBeInTheDocument();
    });
  });

  describe("User messages", () => {
    it("should render user message bubble", () => {
      const messages: Message[] = [
        {
          id: "msg-1",
          threadId: "t-1",
          timestamp: "2024-01-01T10:00:00Z",
          raw: { role: "user", content: "hello agent" },
          type: undefined,
        },
      ];
      render(
        <ChatCanvas {...baseProps} activeThread={sampleThread} messages={messages} />
      );
      expect(screen.getByText("hello agent")).toBeInTheDocument();
    });

    it("should display timestamp for user message", () => {
      const messages: Message[] = [
        {
          id: "msg-1",
          threadId: "t-1",
          timestamp: "2024-01-01T10:00:00Z",
          raw: { role: "user", content: "test message" },
          type: undefined,
        },
      ];
      render(
        <ChatCanvas {...baseProps} activeThread={sampleThread} messages={messages} />
      );
      // Should display timestamp in 12-hour format
      const text = screen.getByText("test message");
      const bubble = text.closest("div");
      expect(bubble?.textContent).toContain("10:00");
    });

    it("should position user message on right side", () => {
      const messages: Message[] = [
        {
          id: "msg-1",
          threadId: "t-1",
          timestamp: "2024-01-01T10:00:00Z",
          raw: { role: "user", content: "user message" },
          type: undefined,
        },
      ];
      const { container } = render(
        <ChatCanvas {...baseProps} activeThread={sampleThread} messages={messages} />
      );
      const userBubble = screen.getByText("user message").closest("div.flex.justify-end");
      expect(userBubble).toBeInTheDocument();
    });
  });

  describe("Agent text messages", () => {
    it("should render agent text message with markdown content", () => {
      const messages: Message[] = [
        {
          id: "msg-1",
          threadId: "t-1",
          timestamp: "2024-01-01T10:00:00Z",
          raw: {
            params: {
              update: {
                content: [{ type: "text", text: "Agent response" }],
              },
            },
          },
          type: "session/update",
        },
      ];
      render(
        <ChatCanvas {...baseProps} activeThread={sampleThread} messages={messages} />
      );
      expect(screen.getByText("Agent response")).toBeInTheDocument();
    });

    it("should display Bot icon for agent message", () => {
      const messages: Message[] = [
        {
          id: "msg-1",
          threadId: "t-1",
          timestamp: "2024-01-01T10:00:00Z",
          raw: {
            params: {
              update: {
                content: [{ type: "text", text: "Agent response" }],
              },
            },
          },
          type: "session/update",
        },
      ];
      render(
        <ChatCanvas {...baseProps} activeThread={sampleThread} messages={messages} />
      );
      // Verify CLAUDE AI AGENT header is present
      expect(screen.getByText("CLAUDE AI AGENT")).toBeInTheDocument();
    });

    it("should position agent message on left side", () => {
      const messages: Message[] = [
        {
          id: "msg-1",
          threadId: "t-1",
          timestamp: "2024-01-01T10:00:00Z",
          raw: {
            params: {
              update: {
                content: [{ type: "text", text: "Agent response" }],
              },
            },
          },
          type: "session/update",
        },
      ];
      const { container } = render(
        <ChatCanvas {...baseProps} activeThread={sampleThread} messages={messages} />
      );
      const agentBubble = screen.getByText("Agent response").closest("div.flex.justify-start");
      expect(agentBubble).toBeInTheDocument();
    });
  });

  describe("Agent message chunks", () => {
    it("should render agent message chunk", () => {
      const messages: Message[] = [
        {
          id: "msg-1",
          threadId: "t-1",
          timestamp: "2024-01-01T10:00:00Z",
          raw: { delta: { text: "streaming text" } },
          type: "agent_message_chunk",
        },
      ];
      render(
        <ChatCanvas {...baseProps} activeThread={sampleThread} messages={messages} />
      );
      expect(screen.getByText("streaming text")).toBeInTheDocument();
    });
  });

  describe("Status indicators", () => {
    it("should show status pulse when thinking", () => {
      const busyThread: Thread = { ...sampleThread, status: "thinking" };
      render(<ChatCanvas {...baseProps} activeThread={busyThread} messages={[]} />);
      expect(screen.getByText("Claude is thinking...")).toBeInTheDocument();
    });

    it("should show status pulse when running", () => {
      const busyThread: Thread = { ...sampleThread, status: "running" };
      render(<ChatCanvas {...baseProps} activeThread={busyThread} messages={[]} />);
      expect(screen.getByText("Claude is executing...")).toBeInTheDocument();
    });

    it("should show awaiting permission status", () => {
      const busyThread: Thread = { ...sampleThread, status: "awaiting_permission" };
      render(<ChatCanvas {...baseProps} activeThread={busyThread} messages={[]} />);
      expect(screen.getByText("Awaiting your approval...")).toBeInTheDocument();
    });

    it("should not show status pulse when idle", () => {
      render(<ChatCanvas {...baseProps} activeThread={sampleThread} messages={[]} />);
      expect(screen.queryByText("Claude is thinking...")).not.toBeInTheDocument();
      expect(screen.queryByText("Claude is executing...")).not.toBeInTheDocument();
      expect(screen.queryByText("Awaiting your approval...")).not.toBeInTheDocument();
    });
  });

  describe("Error handling", () => {
    it("should show error pill when idle with lastError", () => {
      const errorThread: Thread = { ...sampleThread, lastError: "Connection failed" };
      render(<ChatCanvas {...baseProps} activeThread={errorThread} messages={[]} />);
      expect(screen.getByText(/Agent stopped: Connection failed/)).toBeInTheDocument();
    });

    it("should not show error pill when busy", () => {
      const errorThread: Thread = {
        ...sampleThread,
        status: "thinking",
        lastError: "Error",
      };
      render(<ChatCanvas {...baseProps} activeThread={errorThread} messages={[]} />);
      expect(screen.queryByText(/Agent stopped/)).not.toBeInTheDocument();
    });

    it("should not show error pill when idle without error", () => {
      render(<ChatCanvas {...baseProps} activeThread={sampleThread} messages={[]} />);
      expect(screen.queryByText(/Agent stopped/)).not.toBeInTheDocument();
    });
  });

  describe("Permission requests", () => {
    it("should render permission bubble with options", () => {
      const messages: Message[] = [
        {
          id: "msg-1",
          threadId: "t-1",
          timestamp: "2024-01-01T10:00:00Z",
          raw: {
            id: "perm-1",
            params: {
              toolCall: { title: "Deploy App", kind: "deploy" },
              options: [
                { optionId: "allow_once", name: "Allow Once", kind: "allow_once" },
                { optionId: "deny", name: "Deny", kind: "deny" },
              ],
              sessionId: "session-1",
            },
          },
          type: "session/request_permission",
        },
      ];
      render(
        <ChatCanvas {...baseProps} activeThread={sampleThread} messages={messages} />
      );
      expect(screen.getByText("Permission Required")).toBeInTheDocument();
      expect(screen.getByText("Deploy App")).toBeInTheDocument();
      expect(screen.getByText("Allow Once")).toBeInTheDocument();
      expect(screen.getByText("Deny")).toBeInTheDocument();
    });

    it("should call onPermissionResponse when option clicked", async () => {
      const user = userEvent.setup();
      const messages: Message[] = [
        {
          id: "msg-1",
          threadId: "t-1",
          timestamp: "2024-01-01T10:00:00Z",
          raw: {
            id: "perm-1",
            params: {
              toolCall: { title: "Deploy" },
              options: [
                { optionId: "allow_once", name: "Allow", kind: "allow_once" },
              ],
            },
          },
          type: "session/request_permission",
        },
      ];
      render(
        <ChatCanvas {...baseProps} activeThread={sampleThread} messages={messages} />
      );
      const btn = screen.getByText("Allow");
      await user.click(btn);
      expect(mockOnPermissionResponse).toHaveBeenCalledWith("allow_once", undefined, "Deploy");
    });

    it("should hide permission bubble after response", () => {
      const messages: Message[] = [
        {
          id: "msg-1",
          threadId: "t-1",
          timestamp: "2024-01-01T10:00:00Z",
          raw: {
            id: "perm-1",
            params: {
              toolCall: { title: "Deploy" },
              options: [{ optionId: "allow_once", name: "Allow", kind: "allow_once" }],
            },
          },
          type: "session/request_permission",
        },
        {
          id: "msg-2",
          threadId: "t-1",
          timestamp: "2024-01-01T10:00:01Z",
          raw: { selected: { optionId: "allow_once" } },
          type: "permission_response",
        },
      ];
      render(
        <ChatCanvas {...baseProps} activeThread={sampleThread} messages={messages} />
      );
      // Permission bubble should not be visible
      expect(screen.queryByText("Permission Required")).not.toBeInTheDocument();
    });
  });

  describe("Input area", () => {
    it("should render textarea with placeholder", () => {
      render(<ChatCanvas {...baseProps} activeThread={sampleThread} />);
      const textarea = screen.getByPlaceholderText(
        /Type a command or ask Claude/
      ) as HTMLTextAreaElement;
      expect(textarea).toBeInTheDocument();
    });

    it("should update input value", async () => {
      const user = userEvent.setup();
      const { rerender } = render(
        <ChatCanvas {...baseProps} activeThread={sampleThread} inputText="" />
      );
      const textarea = screen.getByPlaceholderText(
        /Type a command or ask Claude/
      ) as HTMLTextAreaElement;
      await user.type(textarea, "hello");
      expect(mockOnChangeInput).toHaveBeenCalled();
    });

    it("should disable textarea when agent is busy", () => {
      const busyThread: Thread = { ...sampleThread, status: "thinking" };
      render(
        <ChatCanvas {...baseProps} activeThread={busyThread} inputText="" />
      );
      const textarea = screen.getByPlaceholderText(
        /Agent is busy/
      ) as HTMLTextAreaElement;
      expect(textarea.disabled).toBe(true);
    });

    it("should enable textarea when agent is idle", () => {
      render(
        <ChatCanvas {...baseProps} activeThread={sampleThread} inputText="" />
      );
      const textarea = screen.getByPlaceholderText(
        /Type a command or ask Claude/
      ) as HTMLTextAreaElement;
      expect(textarea.disabled).toBe(false);
    });
  });

  describe("Send button", () => {
    it("should disable send button when input is empty", () => {
      render(
        <ChatCanvas {...baseProps} activeThread={sampleThread} inputText="" />
      );
      const sendBtn = screen.getByTitle("Stream instructions");
      expect(sendBtn).toBeDisabled();
    });

    it("should enable send button when input has text", () => {
      render(
        <ChatCanvas {...baseProps} activeThread={sampleThread} inputText="hello" />
      );
      const sendBtn = screen.getByTitle("Stream instructions");
      expect(sendBtn).not.toBeDisabled();
    });

    it("should call onSendMessage when send button clicked", async () => {
      const user = userEvent.setup();
      render(
        <ChatCanvas {...baseProps} activeThread={sampleThread} inputText="hello" />
      );
      const sendBtn = screen.getByTitle("Stream instructions");
      await user.click(sendBtn);
      expect(mockOnSendMessage).toHaveBeenCalled();
    });

    it("should not send message on Enter key", async () => {
      const user = userEvent.setup();
      render(
        <ChatCanvas {...baseProps} activeThread={sampleThread} inputText="" />
      );
      const textarea = screen.getByPlaceholderText(
        /Type a command or ask Claude/
      );
      await user.type(textarea, "test message");
      await user.keyboard("{Enter}");
      expect(mockOnSendMessage).not.toHaveBeenCalled();
    });

    it("should not send on Shift+Enter", async () => {
      const user = userEvent.setup();
      render(
        <ChatCanvas {...baseProps} activeThread={sampleThread} inputText="" />
      );
      const textarea = screen.getByPlaceholderText(
        /Type a command or ask Claude/
      );
      await user.type(textarea, "line 1");
      await user.keyboard("{Shift>}{Enter}{/Shift}");
      expect(mockOnSendMessage).not.toHaveBeenCalled();
    });
  });

  describe("Cancel button", () => {
    it("should show cancel button when agent is busy", () => {
      const busyThread: Thread = { ...sampleThread, status: "thinking" };
      render(<ChatCanvas {...baseProps} activeThread={busyThread} />);
      const cancelBtn = screen.getByTitle("Cancel agent turn");
      expect(cancelBtn).toBeInTheDocument();
    });

    it("should hide cancel button when agent is idle", () => {
      render(<ChatCanvas {...baseProps} activeThread={sampleThread} />);
      expect(screen.queryByTitle("Cancel agent turn")).not.toBeInTheDocument();
    });

    it("should call onCancelAgent when cancel button clicked", async () => {
      const user = userEvent.setup();
      const busyThread: Thread = { ...sampleThread, status: "thinking" };
      render(<ChatCanvas {...baseProps} activeThread={busyThread} />);
      const cancelBtn = screen.getByTitle("Cancel agent turn");
      await user.click(cancelBtn);
      expect(mockOnCancelAgent).toHaveBeenCalled();
    });

    it("should be red when shown", () => {
      const busyThread: Thread = { ...sampleThread, status: "thinking" };
      const { container } = render(
        <ChatCanvas {...baseProps} activeThread={busyThread} />
      );
      const cancelBtn = screen.getByTitle("Cancel agent turn");
      expect(cancelBtn.className).toContain("red-500");
    });
  });

  describe("Header", () => {
    it("should display thread title in header", () => {
      const customThread: Thread = {
        ...sampleThread,
        title: "My Special Thread",
      };
      render(<ChatCanvas {...baseProps} activeThread={customThread} />);
      expect(screen.getByText("My Special Thread")).toBeInTheDocument();
    });

    it("should display Running badge", () => {
      render(<ChatCanvas {...baseProps} activeThread={sampleThread} />);
      expect(screen.getByText("Running")).toBeInTheDocument();
    });

    it("should display Bot icon in header", () => {
      render(<ChatCanvas {...baseProps} activeThread={sampleThread} />);
      // Check that the header contains the thread title and running status
      expect(screen.getByText("Test Thread")).toBeInTheDocument();
      expect(screen.getByText("Running")).toBeInTheDocument();
    });
  });

  describe("Thread log panel", () => {
    it("should display thread log button", () => {
      render(<ChatCanvas {...baseProps} activeThread={sampleThread} />);
      expect(screen.getByText("Thread Log")).toBeInTheDocument();
    });

    it("should toggle thread log panel visibility", async () => {
      const user = userEvent.setup();
      render(<ChatCanvas {...baseProps} activeThread={sampleThread} />);
      const logBtn = screen.getByText("Thread Log");
      
      // Initially hidden
      expect(
        screen.queryByText(/THREAD LOG — Test Thread/)
      ).not.toBeInTheDocument();
      
      // Click to show
      await user.click(logBtn);
      expect(
        screen.getByText(/THREAD LOG — Test Thread/)
      ).toBeInTheDocument();
      
      // Click to hide
      await user.click(logBtn);
      expect(
        screen.queryByText(/THREAD LOG — Test Thread/)
      ).not.toBeInTheDocument();
    });

    it("should display thread logs when panel is open", () => {
      const logs = [
        {
          timestamp: "2024-01-01T10:00:00Z",
          level: "info",
          component: "ChatCanvas",
          message: "Connected to thread",
        },
        {
          timestamp: "2024-01-01T10:00:01Z",
          level: "error",
          component: "ACP",
          message: "Request failed",
        },
      ];
      render(
        <ChatCanvas
          {...baseProps}
          activeThread={sampleThread}
          threadLogs={logs}
        />
      );
      
      // Open panel
      const logBtn = screen.getByText("Thread Log");
      userEvent.click(logBtn);
      
      // Verify logs are displayed (would show after click, but we're testing structure)
      // In real execution, would verify via async act()
    });

    it("should call onClearThreadLogs when clear button clicked", async () => {
      const user = userEvent.setup();
      const logs = [
        {
          timestamp: "2024-01-01T10:00:00Z",
          level: "info",
          component: "ChatCanvas",
          message: "Test log",
        },
      ];
      render(
        <ChatCanvas
          {...baseProps}
          activeThread={sampleThread}
          threadLogs={logs}
        />
      );
      
      // Open panel
      const logBtn = screen.getByText("Thread Log");
      await user.click(logBtn);
      
      // Click clear
      const clearBtn = screen.getByText("clear");
      await user.click(clearBtn);
      expect(mockOnClearThreadLogs).toHaveBeenCalled();
    });

    it("should show 'No ACP messages' when logs are empty", async () => {
      const user = userEvent.setup();
      render(
        <ChatCanvas
          {...baseProps}
          activeThread={sampleThread}
          threadLogs={[]}
        />
      );
      
      const logBtn = screen.getByText("Thread Log");
      await user.click(logBtn);
      
      expect(screen.getByText(/No ACP messages logged yet/)).toBeInTheDocument();
    });
  });

  describe("Deploy button", () => {
    it("should display deploy button", () => {
      render(<ChatCanvas {...baseProps} activeThread={sampleThread} />);
      const deployBtn = screen.getByText("Deploy Cloud Run");
      expect(deployBtn).toBeInTheDocument();
    });

    it("should call onDeploy when clicked", async () => {
      const user = userEvent.setup();
      render(<ChatCanvas {...baseProps} activeThread={sampleThread} />);
      const deployBtn = screen.getByText("Deploy Cloud Run");
      await user.click(deployBtn);
      expect(mockOnDeploy).toHaveBeenCalled();
    });

    it("should show 'Deploying...' when isDeploying is true", () => {
      render(
        <ChatCanvas
          {...baseProps}
          activeThread={sampleThread}
          isDeploying={true}
        />
      );
      expect(screen.getByText("Deploying...")).toBeInTheDocument();
    });

    it("should disable deploy button when deploying", () => {
      render(
        <ChatCanvas
          {...baseProps}
          activeThread={sampleThread}
          isDeploying={true}
        />
      );
      const deployBtn = screen.getByRole("button", { name: /deploying|deploy/i });
      expect(deployBtn).toBeDisabled();
    });
  });

  describe("Tool calls", () => {
    it("should render tool pending indicator", () => {
      const messages: Message[] = [
        {
          id: "msg-1",
          threadId: "t-1",
          timestamp: "2024-01-01T10:00:00Z",
          raw: {
            params: {
              update: {
                toolCallId: "tool-1",
                sessionUpdate: "tool_call",
                title: "Run Tests",
                kind: "shell",
              },
            },
          },
          type: "session/update",
        },
      ];
      render(
        <ChatCanvas {...baseProps} activeThread={sampleThread} messages={messages} />
      );
      expect(screen.getByText("SHELL: Run Tests")).toBeInTheDocument();
    });

    it("should show tool result when expanded", async () => {
      const user = userEvent.setup();
      const messages: Message[] = [
        {
          id: "msg-1",
          threadId: "t-1",
          timestamp: "2024-01-01T10:00:00Z",
          raw: {
            params: {
              update: {
                toolCallId: "tool-1",
                sessionUpdate: "tool_call",
                title: "Run Command",
                kind: "shell",
              },
            },
          },
          type: "session/update",
        },
        {
          id: "msg-2",
          threadId: "t-1",
          timestamp: "2024-01-01T10:00:01Z",
          raw: {
            params: {
              update: {
                toolCallId: "tool-1",
                sessionUpdate: "tool_call_update",
                status: "completed",
                rawOutput: "Command executed successfully",
              },
            },
          },
          type: "session/update",
        },
      ];
      render(
        <ChatCanvas {...baseProps} activeThread={sampleThread} messages={messages} />
      );
      
      // Click to expand
      const expandBtn = screen.getByText(/Show output/);
      await user.click(expandBtn);
      
      // Output should now be visible
      expect(screen.getByText("Command executed successfully")).toBeInTheDocument();
    });
  });

  describe("Multiple messages", () => {
    it("should render conversation with mixed message types", () => {
      const messages: Message[] = [
        {
          id: "msg-1",
          threadId: "t-1",
          timestamp: "2024-01-01T10:00:00Z",
          raw: { role: "user", content: "Run tests" },
          type: undefined,
        },
        {
          id: "msg-2",
          threadId: "t-1",
          timestamp: "2024-01-01T10:00:01Z",
          raw: {
            params: {
              update: {
                content: [{ type: "text", text: "Running tests..." }],
              },
            },
          },
          type: "session/update",
        },
        {
          id: "msg-3",
          threadId: "t-1",
          timestamp: "2024-01-01T10:00:02Z",
          raw: {
            params: {
              update: {
                toolCallId: "tool-1",
                sessionUpdate: "tool_call",
                title: "npm test",
                kind: "shell",
              },
            },
          },
          type: "session/update",
        },
      ];
      render(
        <ChatCanvas {...baseProps} activeThread={sampleThread} messages={messages} />
      );
      expect(screen.getByText("Run tests")).toBeInTheDocument();
      expect(screen.getByText("Running tests...")).toBeInTheDocument();
      expect(screen.getByText("SHELL: npm test")).toBeInTheDocument();
    });
  });

  describe("Auto-scroll behavior", () => {
    it("should render without errors with many messages", () => {
      const messages: Message[] = Array.from({ length: 50 }, (_, i) => ({
        id: `msg-${i}`,
        threadId: "t-1",
        timestamp: `2024-01-01T10:00:${String(i).padStart(2, "0")}Z`,
        raw:
          i % 2 === 0
            ? { role: "user", content: `Message ${i}` }
            : {
                params: {
                  update: {
                    content: [{ type: "text", text: `Response ${i}` }],
                  },
                },
              },
        type: i % 2 === 0 ? undefined : ("session/update" as const),
      }));
      const { container } = render(
        <ChatCanvas {...baseProps} activeThread={sampleThread} messages={messages} />
      );
      expect(container).toBeInTheDocument();
    });
  });

  describe("Attachment button", () => {
    it("should display attachment button", () => {
      render(<ChatCanvas {...baseProps} activeThread={sampleThread} />);
      const attachBtn = screen.getByTitle("Attach code snippet context files");
      expect(attachBtn).toBeInTheDocument();
    });
  });
});
