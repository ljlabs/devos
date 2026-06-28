import { describe, it, expect } from "vitest";
import { Message } from "../../src/types";

/**
 * Parse raw ACP message to extract user-facing content
 * Extracted from ChatCanvas.tsx for isolated testing
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

describe("getMessageContent", () => {
  describe("User messages", () => {
    it("should parse user message with role and content", () => {
      const msg: Message = {
        id: "msg-1",
        threadId: "t-1",
        timestamp: "2024-01-01T00:00:00Z",
        raw: { role: "user", content: "hello" },
        type: undefined,
      };
      const result = getMessageContent(msg);
      expect(result).toEqual({ type: "user", content: "hello" });
    });

    it("should return null for user message without content", () => {
      const msg: Message = {
        id: "msg-1",
        threadId: "t-1",
        timestamp: "2024-01-01T00:00:00Z",
        raw: { role: "user" },
        type: undefined,
      };
      const result = getMessageContent(msg);
      expect(result).toBeNull();
    });
  });

  describe("Agent message chunks", () => {
    it("should parse agent_message_chunk with delta.text", () => {
      const msg: Message = {
        id: "msg-1",
        threadId: "t-1",
        timestamp: "2024-01-01T00:00:00Z",
        raw: { delta: { text: "hi there" } },
        type: "agent_message_chunk",
      };
      const result = getMessageContent(msg);
      expect(result).toEqual({ type: "agent_chunk", content: "hi there" });
    });

    it("should parse agent_message_chunk with text field", () => {
      const msg: Message = {
        id: "msg-1",
        threadId: "t-1",
        timestamp: "2024-01-01T00:00:00Z",
        raw: { text: "hello" },
        type: "agent_message_chunk",
      };
      const result = getMessageContent(msg);
      expect(result).toEqual({ type: "agent_chunk", content: "hello" });
    });

    it("should parse agent_message_chunk with content field", () => {
      const msg: Message = {
        id: "msg-1",
        threadId: "t-1",
        timestamp: "2024-01-01T00:00:00Z",
        raw: { content: "chunk content" },
        type: "agent_message_chunk",
      };
      const result = getMessageContent(msg);
      expect(result).toEqual({ type: "agent_chunk", content: "chunk content" });
    });

    it("should return empty string for agent_message_chunk without text", () => {
      const msg: Message = {
        id: "msg-1",
        threadId: "t-1",
        timestamp: "2024-01-01T00:00:00Z",
        raw: {},
        type: "agent_message_chunk",
      };
      const result = getMessageContent(msg);
      expect(result).toEqual({ type: "agent_chunk", content: "" });
    });
  });

  describe("Session updates - Agent text", () => {
    it("should parse session/update with agent_text content array", () => {
      const msg: Message = {
        id: "msg-1",
        threadId: "t-1",
        timestamp: "2024-01-01T00:00:00Z",
        raw: {
          params: {
            update: {
              content: [
                { type: "text", text: "response text" },
              ],
            },
          },
        },
        type: "session/update",
      };
      const result = getMessageContent(msg);
      expect(result).toEqual({ type: "agent_text", content: "response text" });
    });

    it("should parse content array with nested content.text", () => {
      const msg: Message = {
        id: "msg-1",
        threadId: "t-1",
        timestamp: "2024-01-01T00:00:00Z",
        raw: {
          params: {
            update: {
              content: [
                { type: "text", content: { text: "nested text" } },
              ],
            },
          },
        },
        type: "session/update",
      };
      const result = getMessageContent(msg);
      expect(result).toEqual({ type: "agent_text", content: "nested text" });
    });

    it("should skip non-text content in array", () => {
      const msg: Message = {
        id: "msg-1",
        threadId: "t-1",
        timestamp: "2024-01-01T00:00:00Z",
        raw: {
          params: {
            update: {
              content: [
                { type: "image" },
                { type: "text", text: "found it" },
              ],
            },
          },
        },
        type: "session/update",
      };
      const result = getMessageContent(msg);
      expect(result).toEqual({ type: "agent_text", content: "found it" });
    });
  });

  describe("Session updates - Agent message chunk", () => {
    it("should parse session/update with agent_message_chunk", () => {
      const msg: Message = {
        id: "msg-1",
        threadId: "t-1",
        timestamp: "2024-01-01T00:00:00Z",
        raw: {
          params: {
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { text: "streaming chunk" },
            },
          },
        },
        type: "session/update",
      };
      const result = getMessageContent(msg);
      expect(result).toEqual({ type: "agent_chunk", content: "streaming chunk" });
    });

    it("should parse agent_message_chunk with direct content field", () => {
      const msg: Message = {
        id: "msg-1",
        threadId: "t-1",
        timestamp: "2024-01-01T00:00:00Z",
        raw: {
          params: {
            update: {
              sessionUpdate: "agent_message_chunk",
              content: "direct content",
            },
          },
        },
        type: "session/update",
      };
      const result = getMessageContent(msg);
      expect(result).toEqual({ type: "agent_chunk", content: "direct content" });
    });
  });

  describe("Session updates - Tool calls", () => {
    it("should parse tool_call pending status", () => {
      const msg: Message = {
        id: "msg-1",
        threadId: "t-1",
        timestamp: "2024-01-01T00:00:00Z",
        raw: {
          params: {
            update: {
              toolCallId: "tool-1",
              sessionUpdate: "tool_call",
              title: "Run Command",
              kind: "shell",
              status: "pending",
            },
          },
        },
        type: "session/update",
      };
      const result = getMessageContent(msg);
      expect(result?.type).toBe("tool_pending");
      expect(result?.content).toMatchObject({
        toolCallId: "tool-1",
        title: "Run Command",
        kind: "shell",
      });
    });

    it("should parse tool_call_update result", () => {
      const msg: Message = {
        id: "msg-1",
        threadId: "t-1",
        timestamp: "2024-01-01T00:00:00Z",
        raw: {
          params: {
            update: {
              toolCallId: "tool-1",
              sessionUpdate: "tool_call_update",
              status: "completed",
              rawOutput: "success output",
            },
          },
        },
        type: "session/update",
      };
      const result = getMessageContent(msg);
      expect(result?.type).toBe("tool_result");
      expect(result?.content).toMatchObject({
        toolCallId: "tool-1",
        status: "completed",
        rawOutput: "success output",
      });
    });
  });

  describe("Session updates - Usage", () => {
    it("should parse usage_update", () => {
      const msg: Message = {
        id: "msg-1",
        threadId: "t-1",
        timestamp: "2024-01-01T00:00:00Z",
        raw: {
          params: {
            update: {
              sessionUpdate: "usage_update",
              used: 100,
              size: 1000,
              cost: 0.001,
            },
          },
        },
        type: "session/update",
      };
      const result = getMessageContent(msg);
      expect(result).toEqual({
        type: "usage_update",
        content: { used: 100, size: 1000, cost: 0.001 },
      });
    });
  });

  describe("Session updates - Session info", () => {
    it("should parse session_info_update", () => {
      const msg: Message = {
        id: "msg-1",
        threadId: "t-1",
        timestamp: "2024-01-01T00:00:00Z",
        raw: {
          params: {
            update: {
              sessionUpdate: "session_info_update",
              title: "New Title",
              updatedAt: "2024-01-01T12:00:00Z",
            },
          },
        },
        type: "session/update",
      };
      const result = getMessageContent(msg);
      expect(result).toEqual({
        type: "session_info",
        content: {
          title: "New Title",
          updatedAt: "2024-01-01T12:00:00Z",
        },
      });
    });
  });

  describe("Session updates - Available commands", () => {
    it("should parse available_commands_update", () => {
      const msg: Message = {
        id: "msg-1",
        threadId: "t-1",
        timestamp: "2024-01-01T00:00:00Z",
        raw: {
          params: {
            update: {
              sessionUpdate: "available_commands_update",
              availableCommands: ["list", "create", "delete"],
            },
          },
        },
        type: "session/update",
      };
      const result = getMessageContent(msg);
      expect(result).toEqual({
        type: "available_commands",
        content: {
          availableCommands: ["list", "create", "delete"],
        },
      });
    });
  });

  describe("Permission requests", () => {
    it("should parse session/request_permission", () => {
      const msg: Message = {
        id: "msg-1",
        threadId: "t-1",
        timestamp: "2024-01-01T00:00:00Z",
        raw: {
          id: "perm-1",
          params: {
            toolCall: { title: "Deploy App" },
            options: [
              { optionId: "allow_once", name: "Allow Once" },
              { optionId: "deny", name: "Deny" },
            ],
            sessionId: "session-1",
          },
        },
        type: "session/request_permission",
      };
      const result = getMessageContent(msg);
      expect(result?.type).toBe("permission");
      expect(result?.content).toMatchObject({
        permissionId: "perm-1",
        sessionId: "session-1",
      });
      expect(result?.content.toolCall).toEqual({ title: "Deploy App" });
      expect(result?.content.options).toEqual([
        { optionId: "allow_once", name: "Allow Once" },
        { optionId: "deny", name: "Deny" },
      ]);
    });

    it("should parse permission_response", () => {
      const msg: Message = {
        id: "msg-1",
        threadId: "t-1",
        timestamp: "2024-01-01T00:00:00Z",
        raw: {
          selected: { optionId: "allow_once" },
        },
        type: "permission_response",
      };
      const result = getMessageContent(msg);
      expect(result).toEqual({
        type: "permission_response",
        content: "allow_once",
      });
    });

    it("should default to 'unknown' for permission_response without optionId", () => {
      const msg: Message = {
        id: "msg-1",
        threadId: "t-1",
        timestamp: "2024-01-01T00:00:00Z",
        raw: { selected: {} },
        type: "permission_response",
      };
      const result = getMessageContent(msg);
      expect(result).toEqual({
        type: "permission_response",
        content: "unknown",
      });
    });
  });

  describe("JSON-RPC responses", () => {
    it("should parse response with result", () => {
      const msg: Message = {
        id: "msg-1",
        threadId: "t-1",
        timestamp: "2024-01-01T00:00:00Z",
        raw: {
          result: { success: true, data: "result data" },
        },
        type: "response",
      };
      const result = getMessageContent(msg);
      expect(result).toEqual({
        type: "rpc_response",
        content: {
          result: { success: true, data: "result data" },
          error: undefined,
        },
      });
    });

    it("should parse response with error", () => {
      const msg: Message = {
        id: "msg-1",
        threadId: "t-1",
        timestamp: "2024-01-01T00:00:00Z",
        raw: {
          error: { code: -32600, message: "Invalid Request" },
        },
        type: "response",
      };
      const result = getMessageContent(msg);
      expect(result).toEqual({
        type: "rpc_response",
        content: {
          result: undefined,
          error: { code: -32600, message: "Invalid Request" },
        },
      });
    });
  });

  describe("Edge cases", () => {
    it("should return null when raw is null", () => {
      const msg: Message = {
        id: "msg-1",
        threadId: "t-1",
        timestamp: "2024-01-01T00:00:00Z",
        raw: null,
        type: undefined,
      };
      const result = getMessageContent(msg);
      expect(result).toBeNull();
    });

    it("should return null when raw is undefined", () => {
      const msg: Message = {
        id: "msg-1",
        threadId: "t-1",
        timestamp: "2024-01-01T00:00:00Z",
        raw: undefined,
        type: undefined,
      };
      const result = getMessageContent(msg);
      expect(result).toBeNull();
    });

    it("should return null for unknown message type", () => {
      const msg: Message = {
        id: "msg-1",
        threadId: "t-1",
        timestamp: "2024-01-01T00:00:00Z",
        raw: { someField: "value" },
        type: "unknown",
      };
      const result = getMessageContent(msg);
      expect(result).toBeNull();
    });

    it("should return null for session/update without params.update", () => {
      const msg: Message = {
        id: "msg-1",
        threadId: "t-1",
        timestamp: "2024-01-01T00:00:00Z",
        raw: { params: {} },
        type: "session/update",
      };
      const result = getMessageContent(msg);
      expect(result).toBeNull();
    });

    it("should return null for session/update with empty content array", () => {
      const msg: Message = {
        id: "msg-1",
        threadId: "t-1",
        timestamp: "2024-01-01T00:00:00Z",
        raw: {
          params: {
            update: { content: [] },
          },
        },
        type: "session/update",
      };
      const result = getMessageContent(msg);
      expect(result).toBeNull();
    });
  });
});
