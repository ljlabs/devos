import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import os from "os";

const TEST_DB = path.join(os.tmpdir(), `devos-test-wireagent-${Date.now()}.json`);

/**
 * Mock implementation of wireAgent state machine for testing.
 * This replicates the core logic from server.ts wireAgent() function.
 */
function createWireAgentStateMachine() {
  const stateChanges: any[] = [];

  function wireAgent(agent: EventEmitter, threadId: string, db: any) {
    if (agent.listenerCount("message") > 0) return; // already wired

    agent.on("message", (raw: any) => {
      stateChanges.push({ event: "message", raw, threadId, timestamp: new Date().toISOString() });

      const thread = db.threads.find((t: any) => t.id === threadId);
      if (!thread) return;

      // Keep thread.sessionId updated if ACP tells us
      const sessionId =
        raw.params?.sessionId ??
        raw.result?.sessionId ??
        raw.params?.update?.sessionId;
      if (sessionId) thread.sessionId = sessionId;

      // --- State transitions ---

      // JSON-RPC response with stopReason → agent turn is done
      if ("id" in raw && raw.result?.stopReason) {
        const reason = raw.result.stopReason;
        thread.status = "idle";
        // Store error if not end_turn so the UI can surface it
        if (reason !== "end_turn") {
          thread.lastError = reason;
        } else {
          thread.lastError = undefined;
        }
        stateChanges.push({
          event: "state_change",
          action: "stopReason",
          stopReason: reason,
          newStatus: "idle",
          threadId,
        });
        return;
      }

      // JSON-RPC error response → agent turn failed
      if ("id" in raw && raw.error) {
        thread.status = "idle";
        thread.lastError = raw.error.message ?? "Unknown error";
        stateChanges.push({
          event: "state_change",
          action: "error",
          error: raw.error.message,
          newStatus: "idle",
          threadId,
        });
        return;
      }

      // Agent requests permission → awaiting_permission
      if (raw.method === "session/request_permission") {
        thread.status = "awaiting_permission";
        thread.pendingPermissionId = raw.id;
        thread.pendingPermissionOptions = raw.params?.options ?? [];
        stateChanges.push({
          event: "state_change",
          action: "request_permission",
          newStatus: "awaiting_permission",
          threadId,
        });
        return;
      }

      // Agent sends a session/update → it's still working, just notify progress.
      if (raw.method === "session/update") {
        const update = raw.params?.update;
        if (update?.sessionUpdate === "session_info_update" && update?.title) {
          thread.title = update.title;
          stateChanges.push({
            event: "state_change",
            action: "title_update",
            title: update.title,
            threadId,
          });
        }
        return;
      }
    });

    agent.on("close", () => {
      const thread = db.threads.find((t: any) => t.id === threadId);
      if (thread) {
        thread.status = "idle";
        thread.pendingPermissionId = undefined;
        thread.pendingPermissionOptions = undefined;
      }
      stateChanges.push({
        event: "state_change",
        action: "agent_close",
        newStatus: "idle",
        threadId,
      });
    });
  }

  return { wireAgent, stateChanges };
}

describe("wireAgent() State Machine", () => {
  let stateMachine: ReturnType<typeof createWireAgentStateMachine>;
  let mockDb: any;

  beforeEach(() => {
    stateMachine = createWireAgentStateMachine();
    mockDb = { threads: [] };
  });

  describe("stopReason: 'end_turn'", () => {
    it("transitions to idle and clears lastError", () => {
      const agent = new EventEmitter();
      const threadId = "thread-1";
      mockDb.threads = [{ id: threadId, status: "thinking", lastError: "previous error" }];

      stateMachine.wireAgent(agent, threadId, mockDb);

      // Emit a stopReason end_turn response
      agent.emit("message", {
        id: 1,
        result: { stopReason: "end_turn" },
      });

      const thread = mockDb.threads[0];
      expect(thread.status).toBe("idle");
      expect(thread.lastError).toBeUndefined();

      // Verify state change was recorded
      const stateChange = stateMachine.stateChanges.find((s) => s.action === "stopReason");
      expect(stateChange).toBeDefined();
      expect(stateChange.stopReason).toBe("end_turn");
    });
  });

  describe("stopReason: 'error'", () => {
    it("transitions to idle and stores the stopReason as lastError", () => {
      const agent = new EventEmitter();
      const threadId = "thread-2";
      mockDb.threads = [{ id: threadId, status: "thinking" }];

      stateMachine.wireAgent(agent, threadId, mockDb);

      // Emit a stopReason error response
      agent.emit("message", {
        id: 2,
        result: { stopReason: "max_tokens_exceeded" },
      });

      const thread = mockDb.threads[0];
      expect(thread.status).toBe("idle");
      expect(thread.lastError).toBe("max_tokens_exceeded");

      // Verify state change
      const stateChange = stateMachine.stateChanges.find((s) => s.action === "stopReason");
      expect(stateChange.stopReason).toBe("max_tokens_exceeded");
    });
  });

  describe("JSON-RPC error response", () => {
    it("transitions to idle and sets lastError from error message", () => {
      const agent = new EventEmitter();
      const threadId = "thread-3";
      mockDb.threads = [{ id: threadId, status: "thinking" }];

      stateMachine.wireAgent(agent, threadId, mockDb);

      // Emit a JSON-RPC error
      agent.emit("message", {
        id: 3,
        error: { code: -32600, message: "Invalid Request" },
      });

      const thread = mockDb.threads[0];
      expect(thread.status).toBe("idle");
      expect(thread.lastError).toBe("Invalid Request");

      // Verify state change
      const stateChange = stateMachine.stateChanges.find((s) => s.action === "error");
      expect(stateChange.error).toBe("Invalid Request");
    });

    it("handles error with undefined message gracefully", () => {
      const agent = new EventEmitter();
      const threadId = "thread-4";
      mockDb.threads = [{ id: threadId, status: "thinking" }];

      stateMachine.wireAgent(agent, threadId, mockDb);

      // Emit error without message
      agent.emit("message", {
        id: 4,
        error: { code: -32600 },
      });

      const thread = mockDb.threads[0];
      expect(thread.lastError).toBe("Unknown error");
    });
  });

  describe("session/request_permission message", () => {
    it("transitions to awaiting_permission and stores pending fields", () => {
      const agent = new EventEmitter();
      const threadId = "thread-5";
      mockDb.threads = [{ id: threadId, status: "thinking" }];

      stateMachine.wireAgent(agent, threadId, mockDb);

      // Emit permission request
      agent.emit("message", {
        method: "session/request_permission",
        id: 42,
        params: {
          options: [
            { optionId: "allow_once", description: "Allow once" },
            { optionId: "deny", description: "Deny" },
          ],
        },
      });

      const thread = mockDb.threads[0];
      expect(thread.status).toBe("awaiting_permission");
      expect(thread.pendingPermissionId).toBe(42);
      expect(thread.pendingPermissionOptions).toEqual([
        { optionId: "allow_once", description: "Allow once" },
        { optionId: "deny", description: "Deny" },
      ]);

      // Verify state change
      const stateChange = stateMachine.stateChanges.find((s) => s.action === "request_permission");
      expect(stateChange).toBeDefined();
      expect(stateChange.newStatus).toBe("awaiting_permission");
    });

    it("handles empty options gracefully", () => {
      const agent = new EventEmitter();
      const threadId = "thread-6";
      mockDb.threads = [{ id: threadId, status: "thinking" }];

      stateMachine.wireAgent(agent, threadId, mockDb);

      // Emit permission request with no options
      agent.emit("message", {
        method: "session/request_permission",
        id: 43,
        params: {},
      });

      const thread = mockDb.threads[0];
      expect(thread.pendingPermissionOptions).toEqual([]);
    });
  });

  describe("session/update message", () => {
    it("with session_info_update + title updates thread.title", () => {
      const agent = new EventEmitter();
      const threadId = "thread-7";
      mockDb.threads = [{ id: threadId, status: "thinking", title: "Old Title" }];

      stateMachine.wireAgent(agent, threadId, mockDb);

      // Emit session update with title
      agent.emit("message", {
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "session_info_update",
            title: "New Title from ACP",
          },
        },
      });

      const thread = mockDb.threads[0];
      expect(thread.title).toBe("New Title from ACP");

      // Verify state change recorded
      const stateChange = stateMachine.stateChanges.find((s) => s.action === "title_update");
      expect(stateChange).toBeDefined();
      expect(stateChange.title).toBe("New Title from ACP");
    });

    it("without title does not change thread.title", () => {
      const agent = new EventEmitter();
      const threadId = "thread-8";
      mockDb.threads = [{ id: threadId, status: "thinking", title: "Original Title" }];

      stateMachine.wireAgent(agent, threadId, mockDb);

      // Emit session update without title
      agent.emit("message", {
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "session_info_update",
          },
        },
      });

      const thread = mockDb.threads[0];
      expect(thread.title).toBe("Original Title");

      // No title_update state change should be recorded
      const titleChanges = stateMachine.stateChanges.filter((s) => s.action === "title_update");
      expect(titleChanges).toHaveLength(0);
    });

    it("handles generic session/update (non-session_info_update)", () => {
      const agent = new EventEmitter();
      const threadId = "thread-9";
      mockDb.threads = [{ id: threadId, status: "thinking", title: "Title" }];

      stateMachine.wireAgent(agent, threadId, mockDb);

      // Emit generic session update
      agent.emit("message", {
        method: "session/update",
        params: {
          update: {
            someOtherUpdate: "data",
          },
        },
      });

      const thread = mockDb.threads[0];
      // Title should not change
      expect(thread.title).toBe("Title");
    });
  });

  describe("Agent close event", () => {
    it("clears pending permission and sets idle", () => {
      const agent = new EventEmitter();
      const threadId = "thread-10";
      mockDb.threads = [
        {
          id: threadId,
          status: "awaiting_permission",
          pendingPermissionId: 99,
          pendingPermissionOptions: [{ optionId: "allow" }],
        },
      ];

      stateMachine.wireAgent(agent, threadId, mockDb);

      // Emit close
      agent.emit("close");

      const thread = mockDb.threads[0];
      expect(thread.status).toBe("idle");
      expect(thread.pendingPermissionId).toBeUndefined();
      expect(thread.pendingPermissionOptions).toBeUndefined();

      // Verify state change
      const stateChange = stateMachine.stateChanges.find((s) => s.action === "agent_close");
      expect(stateChange).toBeDefined();
      expect(stateChange.newStatus).toBe("idle");
    });
  });

  describe("Double-wire guard — listenerCount", () => {
    it("does not re-wire if already wired (listenerCount > 0)", () => {
      const agent = new EventEmitter();
      const threadId = "thread-11";
      mockDb.threads = [{ id: threadId, status: "idle" }];

      // Wire once
      stateMachine.wireAgent(agent, threadId, mockDb);
      const firstWireListenerCount = agent.listenerCount("message");
      expect(firstWireListenerCount).toBe(1);

      // Wire again — should be no-op
      stateMachine.wireAgent(agent, threadId, mockDb);
      const secondWireListenerCount = agent.listenerCount("message");

      // Listener count should not increase
      expect(secondWireListenerCount).toBe(firstWireListenerCount);

      // Clear old state changes to only see what happens on second wire attempt
      const beforeSecondWire = stateMachine.stateChanges.length;
      agent.emit("message", { id: 1, result: { stopReason: "end_turn" } });
      const afterSecondWire = stateMachine.stateChanges.length;

      // Each message produces 2 stateChanges entries: one "message" event + one "state_change".
      // The key assertion: only ONE handler fires (not two from duplicate wiring),
      // so we get exactly 2 entries, not 4.
      expect(afterSecondWire - beforeSecondWire).toBe(2);
    });
  });

  describe("sessionId extraction and updates", () => {
    it("extracts sessionId from params.sessionId", () => {
      const agent = new EventEmitter();
      const threadId = "thread-12";
      mockDb.threads = [{ id: threadId, sessionId: undefined }];

      stateMachine.wireAgent(agent, threadId, mockDb);

      agent.emit("message", {
        method: "session/new",
        params: { sessionId: "session-abc-123" },
      });

      expect(mockDb.threads[0].sessionId).toBe("session-abc-123");
    });

    it("extracts sessionId from result.sessionId", () => {
      const agent = new EventEmitter();
      const threadId = "thread-13";
      mockDb.threads = [{ id: threadId, sessionId: undefined }];

      stateMachine.wireAgent(agent, threadId, mockDb);

      agent.emit("message", {
        id: 1,
        result: { sessionId: "session-def-456" },
      });

      expect(mockDb.threads[0].sessionId).toBe("session-def-456");
    });

    it("extracts sessionId from params.update.sessionId", () => {
      const agent = new EventEmitter();
      const threadId = "thread-14";
      mockDb.threads = [{ id: threadId, sessionId: undefined }];

      stateMachine.wireAgent(agent, threadId, mockDb);

      agent.emit("message", {
        method: "session/update",
        params: {
          update: { sessionId: "session-ghi-789" },
        },
      });

      expect(mockDb.threads[0].sessionId).toBe("session-ghi-789");
    });
  });

  describe("Complex state transitions", () => {
    it("handles sequence: request_permission → close", () => {
      const agent = new EventEmitter();
      const threadId = "thread-15";
      mockDb.threads = [{ id: threadId, status: "thinking" }];

      stateMachine.wireAgent(agent, threadId, mockDb);

      // Request permission
      agent.emit("message", {
        method: "session/request_permission",
        id: 50,
        params: { options: [{ optionId: "approve" }] },
      });

      let thread = mockDb.threads[0];
      expect(thread.status).toBe("awaiting_permission");
      expect(thread.pendingPermissionId).toBe(50);

      // Then agent closes
      agent.emit("close");

      thread = mockDb.threads[0];
      expect(thread.status).toBe("idle");
      expect(thread.pendingPermissionId).toBeUndefined();
    });

    it("handles sequence: title update → stopReason", () => {
      const agent = new EventEmitter();
      const threadId = "thread-16";
      mockDb.threads = [{ id: threadId, status: "thinking", title: "Initial" }];

      stateMachine.wireAgent(agent, threadId, mockDb);

      // Update title
      agent.emit("message", {
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "session_info_update",
            title: "Updated Title",
          },
        },
      });

      let thread = mockDb.threads[0];
      expect(thread.title).toBe("Updated Title");
      expect(thread.status).toBe("thinking"); // Still thinking

      // Then finish
      agent.emit("message", {
        id: 1,
        result: { stopReason: "end_turn" },
      });

      thread = mockDb.threads[0];
      expect(thread.status).toBe("idle");
      expect(thread.title).toBe("Updated Title"); // Title preserved
      expect(thread.lastError).toBeUndefined();
    });
  });
});
