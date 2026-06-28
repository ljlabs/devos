/**
 * scenarios.ts
 *
 * Predefined ACP response sequences for testing.
 * Each scenario defines how the mock should respond to each method.
 */

export interface ScenarioStep {
  method: string;
  response?: any;
  notifications?: any[];
  error?: { code: number; message: string };
}

export interface Scenario {
  name: string;
  steps: ScenarioStep[];
}

export const scenarios: Record<string, Scenario> = {
  /**
   * Simple text response — initialize → session/new → session/prompt → text chunk → done
   */
  simpleResponse: {
    name: "simple-response",
    steps: [
      {
        method: "initialize",
        response: {
          protocolVersion: 1,
          agentCapabilities: {},
          agentInfo: { name: "mock-acp-server", version: "1.0.0" },
        },
      },
      {
        method: "session/new",
        response: { sessionId: "mock-session-simple" },
      },
      {
        method: "session/prompt",
        notifications: [
          {
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "mock-session-simple",
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "Hello from mock!" },
              },
            },
          },
        ],
        response: { stopReason: "end_turn" },
      },
    ],
  },

  /**
   * Tool call with auto-approve — tool_call → tool_call_update (completed) → response
   */
  toolCallAutoApprove: {
    name: "tool-call-auto-approve",
    steps: [
      {
        method: "initialize",
        response: {
          protocolVersion: 1,
          agentCapabilities: {},
          agentInfo: { name: "mock-acp-server", version: "1.0.0" },
        },
      },
      {
        method: "session/new",
        response: { sessionId: "mock-session-tool" },
      },
      {
        method: "session/prompt",
        notifications: [
          {
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "mock-session-tool",
              update: {
                sessionUpdate: "tool_call",
                toolCallId: "toolu_001",
                kind: "execute",
                status: "pending",
                title: "npm run lint",
                content: [{ type: "content", content: { type: "text", text: "Running linter..." } }],
                rawInput: { command: "npm run lint" },
                _meta: { claudeCode: { toolName: "Bash" } },
              },
            },
          },
          {
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "mock-session-tool",
              update: {
                sessionUpdate: "tool_call_update",
                toolCallId: "toolu_001",
                status: "completed",
                content: [{ type: "content", content: { type: "text", text: "0 errors found" } }],
                rawInput: { command: "npm run lint" },
                rawOutput: "0 errors found",
              },
            },
          },
        ],
        response: { stopReason: "end_turn" },
      },
    ],
  },

  /**
   * Tool call requiring permission — emits session/request_permission, waits for response
   */
  toolCallPermissionGate: {
    name: "tool-call-permission-gate",
    steps: [
      {
        method: "initialize",
        response: {
          protocolVersion: 1,
          agentCapabilities: {},
          agentInfo: { name: "mock-acp-server", version: "1.0.0" },
        },
      },
      {
        method: "session/new",
        response: { sessionId: "mock-session-perm" },
      },
      {
        method: "session/prompt",
        notifications: [
          {
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "mock-session-perm",
              update: {
                sessionUpdate: "tool_call",
                toolCallId: "toolu_002",
                kind: "execute",
                status: "pending",
                title: "rm -rf dist",
                content: [{ type: "content", content: { type: "text", text: "Remove dist directory" } }],
                rawInput: { command: "rm -rf dist" },
                _meta: { claudeCode: { toolName: "Bash" } },
              },
            },
          },
          // The mock emits session/request_permission as a request (with id).
          // The real ACP server does this — the client must respond.
          // We handle this as a special "permission" step in the server.
        ],
        response: { stopReason: "end_turn" },
      },
    ],
  },

  /**
   * Session rename — emits session_info_update to set thread title
   */
  sessionRename: {
    name: "session-rename",
    steps: [
      {
        method: "initialize",
        response: {
          protocolVersion: 1,
          agentCapabilities: {},
          agentInfo: { name: "mock-acp-server", version: "1.0.0" },
        },
      },
      {
        method: "session/new",
        response: { sessionId: "mock-session-rename" },
      },
      {
        method: "session/prompt",
        notifications: [
          {
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "mock-session-rename",
              update: {
                sessionUpdate: "session_info_update",
                title: "Refactor Auth Router",
              },
            },
          },
          {
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "mock-session-rename",
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "Done!" },
              },
            },
          },
        ],
        response: { stopReason: "end_turn" },
      },
    ],
  },

  /**
   * Error response — returns JSON-RPC error on session/prompt
   */
  errorResponse: {
    name: "error-response",
    steps: [
      {
        method: "initialize",
        response: {
          protocolVersion: 1,
          agentCapabilities: {},
          agentInfo: { name: "mock-acp-server", version: "1.0.0" },
        },
      },
      {
        method: "session/new",
        response: { sessionId: "mock-session-err" },
      },
      {
        method: "session/prompt",
        error: { code: -32603, message: "Internal error: agent crashed" },
      },
    ],
  },
};
