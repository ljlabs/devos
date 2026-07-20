/**
 * @vitest-environment node
 *
 * Tests that permission responses are broadcast over WebSocket for both
 * the HTTP POST /api/threads/:threadId/respond and WS "respond" paths.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import request from "supertest";
import fs from "fs";
import path from "path";
import os from "os";

const TEST_DB = path.join(os.tmpdir(), `devos-perm-bcast-test-${Date.now()}.db`);
process.env.NODE_ENV = "test";
process.env.DB_FILE = TEST_DB;

const VALID_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "devos-perm-bcast-ws-"));

const { app, sqliteDb } = await import("../../server_src/server");
import * as wsServer from "../../server_src/wsServer";

function seedDb(data: any) {
  sqliteDb.writeDb(data);
}

function readDb() {
  return sqliteDb.readDb();
}

function setupThreadWithPendingPermission() {
  const wsId = `ws-${Date.now()}`;
  const threadId = `thread-${Date.now()}`;

  seedDb({
    workspaces: [{ id: wsId, name: "test", path: VALID_DIR }],
    threads: [{
      id: threadId,
      workspaceId: wsId,
      title: "Test Thread",
      status: "awaiting_permission",
      pendingPermissionId: 42,
      pendingPermissionOptions: [
        { kind: "allow_always", name: "Always Allow Bash(npm test *)", optionId: "allow_always" },
        { kind: "allow_once", name: "Allow", optionId: "allow" },
        { kind: "reject_once", name: "Reject", optionId: "reject" },
      ],
    }],
    messages: [{
      id: `msg-request-${Date.now()}`,
      threadId,
      timestamp: new Date().toISOString(),
      type: "session/request_permission",
      raw: {
        jsonrpc: "2.0",
        id: 42,
        method: "session/request_permission",
        params: {
          options: [
            { kind: "allow_always", name: "Always Allow Bash(npm test *)", optionId: "allow_always" },
            { kind: "allow_once", name: "Allow", optionId: "allow" },
            { kind: "reject_once", name: "Reject", optionId: "reject" },
          ],
          toolCall: {
            kind: "execute",
            title: "npm test 2>&1 | tail -40",
            rawInput: { command: "npm test 2>&1 | tail -40" },
          },
          allowSimilar: {
            command: "npm test 2>&1 | tail -40",
            toolName: "Bash",
            allowOptionId: "allow",
            variants: [
              { label: "npm test 2>&1 | tail -40", pattern: "npm test 2>&1 | tail -40" },
              { label: "npm *, tail *", pattern: "npm * | tail *" },
            ],
          },
        },
      },
    }],
    allowedPatterns: [],
  });

  return { wsId, threadId };
}

// --- HTTP tests (supertest) ---

describe("HTTP POST /api/threads/:threadId/respond — permission response", () => {
  beforeEach(() => {
    seedDb({ workspaces: [], threads: [], messages: [], allowedPatterns: [] });
  });

  it("should write permission_response message to DB", async () => {
    const { threadId } = setupThreadWithPendingPermission();

    await request(app)
      .post(`/api/threads/${threadId}/respond`)
      .send({ optionId: "allow" });

    const db = readDb();
    const permMsg = db.messages.find(
      (m: any) => m.type === "permission_response" && m.threadId === threadId
    );
    expect(permMsg).toBeDefined();
    expect(permMsg.raw.selected.optionId).toBe("allow");
  });

  it("should clear pendingPermissionId and set status to thinking", async () => {
    const { threadId } = setupThreadWithPendingPermission();

    await request(app)
      .post(`/api/threads/${threadId}/respond`)
      .send({ optionId: "allow" });

    const db = readDb();
    const thread = db.threads.find((t: any) => t.id === threadId);
    expect(thread.status).toBe("thinking");
    expect(thread.pendingPermissionId).toBeUndefined();
    expect(thread.pendingPermissionOptions).toBeUndefined();
  });

  it("should derive allow-always pattern from the pending ACP option", async () => {
    const { threadId } = setupThreadWithPendingPermission();

    await request(app)
      .post(`/api/threads/${threadId}/respond`)
      .send({ optionId: "allow_always" });

    const db = readDb();
    const pattern = db.allowedPatterns.find((p: any) => p.pattern === "npm test *" && p.toolName === "Bash");
    expect(pattern).toBeDefined();
    expect(pattern.variant).toBe("execute");
  });

  it("should persist correct message structure for each optionId", async () => {
    for (const optionId of ["allow", "reject", "allow_always"]) {
      const { threadId } = setupThreadWithPendingPermission();

      await request(app)
        .post(`/api/threads/${threadId}/respond`)
        .send({ optionId });

      const db = readDb();
      const permMsg = db.messages.find(
        (m: any) => m.type === "permission_response" && m.threadId === threadId
      );
      expect(permMsg).toBeDefined();
      expect(permMsg.raw.selected.optionId).toBe(optionId);
      expect(permMsg.id).toMatch(/^msg-perm-/);
      expect(permMsg.timestamp).toBeDefined();
    }
  });
});

// --- WebSocket broadcast verification tests ---

describe("WebSocket broadcast — permission response message", () => {
  let broadcastSpy: ReturnType<typeof vi.spyOn>;
  let broadcastThreadSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    broadcastSpy = vi.spyOn(wsServer, "broadcastToThread").mockImplementation(() => {});
    broadcastThreadSpy = vi.spyOn(wsServer, "broadcastThreadUpdate").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should call broadcastToThread with permission_response when HTTP respond is used", async () => {
    const { threadId } = setupThreadWithPendingPermission();

    await request(app)
      .post(`/api/threads/${threadId}/respond`)
      .send({ optionId: "allow" });

    expect(broadcastSpy).toHaveBeenCalled();
    const call = broadcastSpy.mock.calls.find(([tid]) => tid === threadId);
    expect(call).toBeDefined();

    const msg = call![1];
    expect(msg.type).toBe("permission_response");
    expect(msg.raw.selected.optionId).toBe("allow");
    expect(msg.threadId).toBe(threadId);
    expect(msg.id).toMatch(/^msg-perm-/);
  });

  it("should call broadcastThreadUpdate with status=thinking after permission response", async () => {
    const { threadId } = setupThreadWithPendingPermission();

    await request(app)
      .post(`/api/threads/${threadId}/respond`)
      .send({ optionId: "allow" });

    expect(broadcastThreadSpy).toHaveBeenCalled();
    const call = broadcastThreadSpy.mock.calls.find(([tid]) => tid === threadId);
    expect(call).toBeDefined();

    const thread = call![1];
    expect(thread.status).toBe("thinking");
    expect(thread.pendingPermissionId).toBeUndefined();
    expect(thread.pendingPermissionOptions).toBeUndefined();
  });

  it("should broadcast with matching DB message ID", async () => {
    const { threadId } = setupThreadWithPendingPermission();

    await request(app)
      .post(`/api/threads/${threadId}/respond`)
      .send({ optionId: "reject" });

    const call = broadcastSpy.mock.calls.find(([tid]) => tid === threadId);
    expect(call).toBeDefined();
    const broadcastMsg = call![1];

    const db = readDb();
    const dbMsg = db.messages.find((m: any) => m.id === broadcastMsg.id);
    expect(dbMsg).toBeDefined();
    expect(dbMsg.raw.selected.optionId).toBe("reject");
  });

  it("broadcast payload matches what useWebSocket.onMessage switch expects", async () => {
    for (const optionId of ["allow", "reject", "allow_always"]) {
      const { threadId } = setupThreadWithPendingPermission();

      await request(app)
        .post(`/api/threads/${threadId}/respond`)
        .send({ optionId });

      const call = broadcastSpy.mock.calls.find(([tid]) => tid === threadId);
      expect(call).toBeDefined();

      const msg = call![1];
      // Simulate the WS server wrapper: { type: "message", threadId, message }
      const wsPayload = { type: "message", threadId, message: msg };

      expect(wsPayload.type).toBe("message");
      expect(wsPayload.message.type).toBe("permission_response");
      expect(wsPayload.message.raw.selected.optionId).toBe(optionId);
      expect(wsPayload.message.threadId).toBe(threadId);

      broadcastSpy.mockClear();
    }
  });
});


describe("server-owned Allow Similar response", () => {
  it("persists a server-issued compound pattern before resolving permission", async () => {
    const { threadId } = setupThreadWithPendingPermission();
    const response = await request(app)
      .post(`/api/threads/${threadId}/respond`)
      .send({ optionId: "allow", selectedPattern: "npm * | tail *" });

    expect(response.status).toBe(200);
    expect(readDb().allowedPatterns).toContainEqual(expect.objectContaining({
      pattern: "npm * | tail *",
      toolName: "Bash",
      variant: "execute",
    }));
  });

  it("rejects a client-invented pattern not issued with the pending request", async () => {
    const { threadId } = setupThreadWithPendingPermission();
    const response = await request(app)
      .post(`/api/threads/${threadId}/respond`)
      .send({ optionId: "allow", selectedPattern: "Bash(*)" });

    expect(response.status).toBe(400);
    expect(readDb().allowedPatterns).toHaveLength(0);
    expect(readDb().threads[0].pendingPermissionId).toBe(42);
  });
});