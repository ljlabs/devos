/**
 * @vitest-environment node
 * 
 * db.sqlite.pagination.test.ts
 * 
 * Comprehensive pagination tests with mock messages to verify that:
 * 1. Different messages are returned at each cursor position
 * 2. Message content varies (not repeated)
 * 3. Cursor-based pagination correctly traverses the thread history
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { SqliteDb } from "./db.sqlite";
import { Message, Thread, Workspace } from "../src/types";

// ─────────────────────────────────────────────────────────────────────────
// Mock Message Builders
// ─────────────────────────────────────────────────────────────────────────

/**
 * Create a mock ACP message with distinct content
 */
function createMockMessage(
  id: string,
  threadId: string,
  index: number,
  timestamp: Date,
  content: string
): Message {
  return {
    id,
    threadId,
    timestamp: timestamp.toISOString(),
    raw: {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: `session-${threadId}`,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: `msg-chunk-${id}`,
          content: {
            type: "text",
            text: content,
          },
        },
      },
    },
    type: "session/update",
  };
}

/**
 * Create a tool call message
 */
function createToolCallMessage(
  id: string,
  threadId: string,
  index: number,
  timestamp: Date,
  toolName: string,
  command: string
): Message {
  return {
    id,
    threadId,
    timestamp: timestamp.toISOString(),
    raw: {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: `session-${threadId}`,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: `tool-${id}`,
          toolName,
          rawInput: { command },
        },
      },
    },
    type: "session/update",
  };
}

/**
 * Create a tool result message
 */
function createToolResultMessage(
  id: string,
  threadId: string,
  index: number,
  timestamp: Date,
  toolName: string,
  output: string
): Message {
  return {
    id,
    threadId,
    timestamp: timestamp.toISOString(),
    raw: {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: `session-${threadId}`,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: `tool-${id}`,
          status: "completed",
          rawOutput: output,
        },
      },
    },
    type: "session/update",
  };
}

/**
 * Seed a thread with diverse mock messages
 * Creates a realistic conversation with agent responses, tool calls, and results
 */
function seedThreadWithMessages(db: SqliteDb, threadId: string, messageCount: number) {
  const baseTime = new Date("2026-07-01T00:00:00Z");

  const messages: Message[] = [];

  for (let i = 0; i < messageCount; i++) {
    const timestamp = new Date(baseTime.getTime() + i * 60000); // 1 min apart
    const msgId = `msg-${i}`;

    // Vary message types: agent responses, tool calls, results
    const messageType = i % 3;

    if (messageType === 0) {
      // Agent message
      messages.push(
        createMockMessage(
          msgId,
          threadId,
          i,
          timestamp,
          `Agent response #${i}: Let me analyze the code in directory /src. This is a unique message with index ${i}.`
        )
      );
    } else if (messageType === 1) {
      // Tool call
      messages.push(
        createToolCallMessage(
          msgId,
          threadId,
          i,
          timestamp,
          "execute_command",
          `ls -la /src/components | head -20 (call #${i})`
        )
      );
    } else {
      // Tool result
      messages.push(
        createToolResultMessage(
          msgId,
          threadId,
          i,
          timestamp,
          "execute_command",
          `total 128\ndrwxr-xr-x 2 user group 4096 Jul  1 10:00 .\ndrwxr-xr-x 3 user group 4096 Jul  1 09:00 ..\n-rw-r--r-- 1 user group 2048 Jul  1 10:00 Button.tsx\nOutput ${i}: unique result content\n`
        )
      );
    }
  }

  // Insert all messages
  messages.forEach((msg) => db.insertMessage(msg));

  return messages;
}

// ─────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────

describe("Pagination with Diverse Mock Messages", () => {
  let testDbPath: string;
  let db: SqliteDb;
  let workspace: Workspace;
  let thread: Thread;

  beforeEach(() => {
    testDbPath = path.join(
      os.tmpdir(),
      `test-pagination-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    );
    db = new SqliteDb(testDbPath);

    // Create workspace and thread
    workspace = {
      id: "ws-1",
      name: "Test Workspace",
      path: "/path/to/workspace",
    };
    db.insertWorkspace(workspace);

    thread = {
      id: "thread-1",
      workspaceId: "ws-1",
      title: "Test Thread",
      sessionId: "session-123",
      status: "idle",
    };
    db.insertThread(thread);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(testDbPath + "-shm")) fs.unlinkSync(testDbPath + "-shm");
    if (fs.existsSync(testDbPath + "-wal")) fs.unlinkSync(testDbPath + "-wal");
  });

  describe("Message diversity verification", () => {
    it("seeds 50 diverse messages successfully", () => {
      const messages = seedThreadWithMessages(db, "thread-1", 50);

      expect(messages).toHaveLength(50);

      // Verify messages are stored
      const storedMessages = db.getMessagesByThread("thread-1");
      expect(storedMessages).toHaveLength(50);

      // Verify message count
      const count = db.getMessageCount("thread-1");
      expect(count).toBe(50);
    });

    it("verifies messages have unique content", () => {
      seedThreadWithMessages(db, "thread-1", 30);

      const messages = db.getMessagesByThread("thread-1");
      const contents = messages.map((m) => JSON.stringify(m.raw));

      // All messages should be unique
      const uniqueContents = new Set(contents);
      expect(uniqueContents.size).toBe(messages.length);
    });
  });

  describe("Cursor pagination returns different messages at each step", () => {
    it("loads different batches using cursor progression", () => {
      seedThreadWithMessages(db, "thread-1", 50);

      // Load page 1 (latest 10)
      const page1 = db.getMessagesBefore("thread-1", null, 10);
      expect(page1).toHaveLength(10);

      // Extract IDs from page 1
      const page1Ids = new Set(page1.map((m) => m.id));

      // Get oldest message ID from page 1 as cursor
      const cursor1 = page1[page1.length - 1].id;

      // Load page 2 (10 older messages)
      const page2 = db.getMessagesBefore("thread-1", cursor1, 10);
      expect(page2).toHaveLength(10);

      // Extract IDs from page 2
      const page2Ids = new Set(page2.map((m) => m.id));

      // Pages should NOT have overlapping IDs
      const overlap = [...page1Ids].filter((id) => page2Ids.has(id));
      expect(overlap).toHaveLength(0);

      // Get cursor for page 3
      const cursor2 = page2[page2.length - 1].id;

      // Load page 3
      const page3 = db.getMessagesBefore("thread-1", cursor2, 10);
      expect(page3).toHaveLength(10);

      const page3Ids = new Set(page3.map((m) => m.id));

      // Page 3 should not overlap with page 1 or 2
      const overlap3 = [...page1Ids, ...page2Ids].filter((id) => page3Ids.has(id));
      expect(overlap3).toHaveLength(0);
    });

    it("verifies content differs between pages", () => {
      seedThreadWithMessages(db, "thread-1", 60);

      // Page 1
      const page1 = db.getMessagesBefore("thread-1", null, 15);
      const page1Content = page1.map((m) => JSON.stringify(m.raw));

      // Page 2
      const cursor1 = page1[page1.length - 1].id;
      const page2 = db.getMessagesBefore("thread-1", cursor1, 15);
      const page2Content = page2.map((m) => JSON.stringify(m.raw));

      // Page 3
      const cursor2 = page2[page2.length - 1].id;
      const page3 = db.getMessagesBefore("thread-1", cursor2, 15);
      const page3Content = page3.map((m) => JSON.stringify(m.raw));

      // Create combined set of all unique contents
      const allContents = new Set([...page1Content, ...page2Content, ...page3Content]);

      // All content should be unique across pages
      expect(allContents.size).toBe(page1Content.length + page2Content.length + page3Content.length);
    });

    it("complete pagination workflow: all messages retrieved without duplicates", () => {
      const totalMessages = 100;
      seedThreadWithMessages(db, "thread-1", totalMessages);

      const retrievedIds = new Set<string>();
      let cursor: string | null = null;
      let pageCount = 0;

      // Paginate through all messages
      while (true) {
        const page = db.getMessagesBefore("thread-1", cursor, 10);

        if (page.length === 0) break;

        // Verify no duplicates within this page
        const pageIds = page.map((m) => m.id);
        const uniqueInPage = new Set(pageIds);
        expect(uniqueInPage.size).toBe(pageIds.length);

        // Verify no duplicates across pages
        pageIds.forEach((id) => {
          expect(retrievedIds.has(id)).toBe(false);
          retrievedIds.add(id);
        });

        cursor = page[page.length - 1].id;
        pageCount++;

        // Safety: prevent infinite loop
        if (pageCount > 20) break;
      }

      // Should have retrieved all messages
      expect(retrievedIds.size).toBe(totalMessages);
    });
  });

  describe("hasMessagesBefore integrates correctly with pagination", () => {
    it("indicates more messages available during pagination", () => {
      seedThreadWithMessages(db, "thread-1", 50);

      const page1 = db.getMessagesBefore("thread-1", null, 10);
      const cursor1 = page1[page1.length - 1].id;

      // Should have more messages before cursor1
      expect(db.hasMessagesBefore("thread-1", cursor1)).toBe(true);

      const page2 = db.getMessagesBefore("thread-1", cursor1, 10);
      const cursor2 = page2[page2.length - 1].id;

      // Should have more messages before cursor2
      expect(db.hasMessagesBefore("thread-1", cursor2)).toBe(true);

      // Load remaining messages
      let cursor = cursor2;
      let count = 20;
      while (db.hasMessagesBefore("thread-1", cursor)) {
        const page = db.getMessagesBefore("thread-1", cursor, 100);
        if (page.length === 0) break;
        cursor = page[page.length - 1].id;
        count += page.length;
      }

      // Eventually should reach a point where no more messages exist
      expect(db.hasMessagesBefore("thread-1", cursor)).toBe(false);
    });
  });

  describe("API endpoint simulation", () => {
    it("simulates server pagination response format", () => {
      seedThreadWithMessages(db, "thread-1", 50);

      // Simulate API call 1: initial load (no cursor)
      const messages1 = db.getMessagesBefore("thread-1", null, 10);
      const total1 = db.getMessageCount("thread-1");

      expect(messages1).toHaveLength(10);
      expect(total1).toBe(50);

      const nextCursor1 = messages1.length > 0 ? messages1[messages1.length - 1].id : null;
      const hasMore1 = nextCursor1 ? db.hasMessagesBefore("thread-1", nextCursor1) : false;

      expect(nextCursor1).not.toBeNull();
      expect(hasMore1).toBe(true);

      // Simulate API call 2: load older (with cursor)
      const messages2 = db.getMessagesBefore("thread-1", nextCursor1, 10);
      const hasMore2 = messages2.length > 0 ? db.hasMessagesBefore("thread-1", messages2[messages2.length - 1].id) : false;

      expect(messages2).toHaveLength(10);

      // Verify no overlap
      const ids1 = new Set(messages1.map((m) => m.id));
      const ids2 = new Set(messages2.map((m) => m.id));
      const overlap = [...ids1].filter((id) => ids2.has(id));
      expect(overlap).toHaveLength(0);

      expect(hasMore2).toBe(true);
    });
  });

  describe("Edge cases with varying message counts", () => {
    it("handles exactly PAGE_SIZE messages (10)", () => {
      seedThreadWithMessages(db, "thread-1", 10);

      const page1 = db.getMessagesBefore("thread-1", null, 10);
      expect(page1).toHaveLength(10);

      const cursor = page1[page1.length - 1].id;
      expect(db.hasMessagesBefore("thread-1", cursor)).toBe(false);
    });

    it("handles less than PAGE_SIZE messages", () => {
      seedThreadWithMessages(db, "thread-1", 5);

      const page1 = db.getMessagesBefore("thread-1", null, 10);
      expect(page1).toHaveLength(5);

      const cursor = page1[page1.length - 1].id;
      expect(db.hasMessagesBefore("thread-1", cursor)).toBe(false);
    });

    it("handles large message count (500)", () => {
      seedThreadWithMessages(db, "thread-1", 500);

      const total = db.getMessageCount("thread-1");
      expect(total).toBe(500);

      // Paginate in chunks of 50
      let cursor: string | null = null;
      let retrieved = 0;

      for (let i = 0; i < 11; i++) {
        const page = db.getMessagesBefore("thread-1", cursor, 50);

        if (page.length === 0) break;

        retrieved += page.length;
        cursor = page[page.length - 1].id;
      }

      expect(retrieved).toBe(500);
    });
  });
});
