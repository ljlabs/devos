/**
 * @vitest-environment node
 *
 * db.sqlite.mock-real.test.ts
 *
 * Tests pagination against real mock database (devos_mock.db).
 * Verifies that:
 * 1. Messages are retrieved without repetition
 * 2. Cursor-based pagination returns different content at each step
 * 3. Real message diversity is preserved across pages
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { SqliteDb } from "./db.sqlite";

describe("Real Mock Database Pagination Tests", () => {
  let db: SqliteDb;
  let mockDbPath: string;
  const mockDbSource = path.join(process.cwd(), "devos_mock.db");

  beforeAll(() => {
    // Check if mock database exists
    if (!fs.existsSync(mockDbSource)) {
      throw new Error(
        `Mock database not found at ${mockDbSource}. Please ensure devos_mock.db exists in the project root.`
      );
    }

    // Copy mock database to temp location for testing (avoid modifying original)
    mockDbPath = path.join(
      os.tmpdir(),
      `test-mock-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    );

    fs.copyFileSync(mockDbSource, mockDbPath);
    db = new SqliteDb(mockDbPath);
  });

  afterAll(() => {
    db.close();
    // Cleanup temp database
    if (fs.existsSync(mockDbPath)) fs.unlinkSync(mockDbPath);
    if (fs.existsSync(mockDbPath + "-shm")) fs.unlinkSync(mockDbPath + "-shm");
    if (fs.existsSync(mockDbPath + "-wal")) fs.unlinkSync(mockDbPath + "-wal");
  });

  describe("Database structure validation", () => {
    it("has workspaces in mock database", () => {
      const workspaces = db.getAllWorkspaces();
      expect(workspaces.length).toBeGreaterThan(0);
      console.log(`Found ${workspaces.length} workspace(s)`);
      workspaces.forEach((ws) => {
        console.log(`  - ${ws.name} (id: ${ws.id})`);
      });
    });

    it("has threads in mock database", () => {
      const workspaces = db.getAllWorkspaces();
      expect(workspaces.length).toBeGreaterThan(0);

      const threads = db.getThreadsByWorkspace(workspaces[0].id);
      expect(threads.length).toBeGreaterThan(0);
      console.log(`Found ${threads.length} thread(s) in first workspace`);
      threads.forEach((t) => {
        const msgCount = db.getMessageCount(t.id);
        console.log(`  - ${t.title} (id: ${t.id}, messages: ${msgCount})`);
      });
    });

    it("has messages in at least one thread", () => {
      const workspaces = db.getAllWorkspaces();
      let foundMessages = false;

      for (const ws of workspaces) {
        const threads = db.getThreadsByWorkspace(ws.id);
        for (const thread of threads) {
          const count = db.getMessageCount(thread.id);
          if (count > 0) {
            foundMessages = true;
            console.log(`Thread "${thread.title}" has ${count} message(s)`);
            break;
          }
        }
        if (foundMessages) break;
      }

      expect(foundMessages).toBe(true);
    });
  });

  describe("Pagination with real messages", () => {
    let targetThreadId: string;
    let totalMessages: number;

    beforeAll(() => {
      // Find a thread with messages
      const workspaces = db.getAllWorkspaces();
      expect(workspaces.length).toBeGreaterThan(0);

      for (const ws of workspaces) {
        const threads = db.getThreadsByWorkspace(ws.id);
        for (const thread of threads) {
          const count = db.getMessageCount(thread.id);
          if (count > 0) {
            targetThreadId = thread.id;
            totalMessages = count;
            console.log(`Using thread "${thread.title}" with ${totalMessages} messages`);
            break;
          }
        }
        if (targetThreadId) break;
      }

      expect(targetThreadId).toBeDefined();
      expect(totalMessages).toBeGreaterThan(0);
    });

    it("loads latest messages successfully", () => {
      const messages = db.getMessagesBefore(targetThreadId, null, 10);

      expect(messages.length).toBeGreaterThan(0);
      expect(messages.length).toBeLessThanOrEqual(10);

      console.log(`Loaded ${messages.length} latest messages`);

      // Verify messages are in newest-first order
      for (let i = 0; i < messages.length - 1; i++) {
        const current = new Date(messages[i].timestamp).getTime();
        const next = new Date(messages[i + 1].timestamp).getTime();
        expect(current).toBeGreaterThanOrEqual(next);
      }

      // Log first and last message info
      console.log(`  - Newest: ${messages[0].id} (${messages[0].timestamp})`);
      console.log(
        `  - Oldest: ${messages[messages.length - 1].id} (${messages[messages.length - 1].timestamp})`
      );
    });

    it("different pages contain different messages", () => {
      if (totalMessages < 20) {
        console.log("Skipping: insufficient messages for multi-page test");
        return;
      }

      // Page 1
      const page1 = db.getMessagesBefore(targetThreadId, null, 10);
      expect(page1.length).toBeGreaterThan(0);

      const page1Ids = new Set(page1.map((m) => m.id));
      const page1Contents = page1.map((m) => JSON.stringify(m.raw));

      // Page 2
      const cursor1 = page1[page1.length - 1].id;
      const hasMoreMessages = db.hasMessagesBefore(targetThreadId, cursor1);

      if (!hasMoreMessages) {
        console.log("Thread has fewer messages than pagination threshold");
        return;
      }

      const page2 = db.getMessagesBefore(targetThreadId, cursor1, 10);
      expect(page2.length).toBeGreaterThan(0);

      const page2Ids = new Set(page2.map((m) => m.id));
      const page2Contents = page2.map((m) => JSON.stringify(m.raw));

      // Verify no overlapping IDs
      const overlapIds = [...page1Ids].filter((id) => page2Ids.has(id));
      expect(overlapIds).toHaveLength(0);

      // Verify no identical content
      const commonContent = page1Contents.filter((c) => page2Contents.includes(c));
      expect(commonContent).toHaveLength(0);

      console.log(
        `Page 1: ${page1.length} unique messages, Page 2: ${page2.length} unique messages`
      );
      console.log(`No overlap between pages (verified)`);
    });

    it(
      "complete pagination traversal without duplicates",
      async () => {
        const PAGE_SIZE = 10;
        const allMessageIds = new Set<string>();
        let pageCount = 0;
        let cursor: string | null = null;

        while (true) {
          const page = db.getMessagesBefore(targetThreadId, cursor, PAGE_SIZE);

          if (page.length === 0) break;

          // Verify no duplicates within page
          const pageIds = page.map((m) => m.id);
          const uniquePageIds = new Set(pageIds);
          expect(uniquePageIds.size).toBe(pageIds.length);

          // Verify no cross-page duplicates
          pageIds.forEach((id) => {
            expect(allMessageIds.has(id)).toBe(false);
            allMessageIds.add(id);
          });

          cursor = page[page.length - 1].id;
          pageCount++;

          // Safety: prevent infinite loop
          if (pageCount > 1000) {
            console.error("Pagination loop limit exceeded");
            break;
          }
        }

        console.log(
          `Retrieved ${allMessageIds.size} total unique messages across ${pageCount} pages`
        );
        expect(allMessageIds.size).toBe(totalMessages);
        expect(pageCount).toBeGreaterThan(0);
      },
      30000 // 30 second timeout for large dataset traversal
    );

    it("verifies hasMessagesBefore correctly indicates pagination", () => {
      if (totalMessages < 20) {
        console.log("Skipping: insufficient messages");
        return;
      }

      const page1 = db.getMessagesBefore(targetThreadId, null, 10);
      const cursor1 = page1[page1.length - 1].id;

      // Should have more messages
      const has2 = db.hasMessagesBefore(targetThreadId, cursor1);
      expect(has2).toBe(true);

      // Sample check: after several pages, hasMessagesBefore should indicate status
      let cursor = cursor1;
      let pageCount = 1;
      let reachedEnd = false;

      // Use larger page sizes and reasonable limit for large datasets
      while (pageCount < 5) {
        const page = db.getMessagesBefore(targetThreadId, cursor, 100);
        if (page.length === 0) {
          reachedEnd = true;
          break;
        }

        // If this is our last iteration, check if more exist
        if (pageCount === 4) {
          const hasMoreAtEnd = db.hasMessagesBefore(targetThreadId, page[page.length - 1].id);
          console.log(
            `After ${pageCount} pages: ${page.length} messages retrieved, hasMore=${hasMoreAtEnd}`
          );
          if (!hasMoreAtEnd) {
            reachedEnd = true;
          }
        }

        cursor = page[page.length - 1].id;
        pageCount++;
      }

      console.log(
        `Pagination check: traversed ${pageCount} pages, ${reachedEnd ? "reached end" : "more messages available"}`
      );

      // For very large datasets, we just verify the logic works correctly for sampling
      expect(pageCount).toBeGreaterThan(1);
    });

    it("message content varies across pages (spot-check)", () => {
      if (totalMessages < 30) {
        console.log("Skipping: insufficient messages");
        return;
      }

      const samples = [];

      // Sample from page 1
      const page1 = db.getMessagesBefore(targetThreadId, null, 5);
      if (page1.length > 0) {
        samples.push({
          page: 1,
          message: page1[0],
          raw: JSON.stringify(page1[0].raw).substring(0, 100),
        });
      }

      // Sample from page 2
      if (page1.length > 0) {
        const cursor1 = page1[page1.length - 1].id;
        if (db.hasMessagesBefore(targetThreadId, cursor1)) {
          const page2 = db.getMessagesBefore(targetThreadId, cursor1, 5);
          if (page2.length > 0) {
            samples.push({
              page: 2,
              message: page2[0],
              raw: JSON.stringify(page2[0].raw).substring(0, 100),
            });
          }
        }
      }

      // Sample from page 3
      if (samples.length >= 2) {
        const cursor2 = samples[1].message.id;
        if (db.hasMessagesBefore(targetThreadId, cursor2)) {
          const page3 = db.getMessagesBefore(targetThreadId, cursor2, 5);
          if (page3.length > 0) {
            samples.push({
              page: 3,
              message: page3[0],
              raw: JSON.stringify(page3[0].raw).substring(0, 100),
            });
          }
        }
      }

      // Verify all samples are different
      const uniqueIds = new Set(samples.map((s) => s.message.id));
      expect(uniqueIds.size).toBe(samples.length);

      console.log("Sample messages from different pages:");
      samples.forEach((s) => {
        console.log(`  Page ${s.page}: ${s.message.id}`);
        console.log(`    Content: ${s.raw}...`);
      });
    });
  });

  describe("API endpoint behavior simulation", () => {
    let targetThreadId: string;
    let totalMessages: number;

    beforeAll(() => {
      const workspaces = db.getAllWorkspaces();
      for (const ws of workspaces) {
        const threads = db.getThreadsByWorkspace(ws.id);
        for (const thread of threads) {
          const count = db.getMessageCount(thread.id);
          if (count > 20) {
            targetThreadId = thread.id;
            totalMessages = count;
            break;
          }
        }
        if (targetThreadId) break;
      }

      if (!targetThreadId) {
        console.log("Skipping: no thread with 20+ messages found");
      }
    });

    it("simulates GET /api/threads/:id/messages/paginated behavior", () => {
      if (!targetThreadId) {
        console.log("Skipping test");
        return;
      }

      // Simulate: GET /api/threads/xxx/messages/paginated?limit=10
      const messages = db.getMessagesBefore(targetThreadId, null, 10);

      const oldestMessageId = messages.length > 0 ? messages[messages.length - 1].id : null;
      const hasMore = oldestMessageId ? db.hasMessagesBefore(targetThreadId, oldestMessageId) : false;
      const nextCursor = hasMore ? oldestMessageId : null;
      const total = db.getMessageCount(targetThreadId);

      // Build response object like server does
      const response = {
        messages,
        hasMore,
        nextCursor,
        total,
      };

      console.log("API Response (page 1):");
      console.log(`  - messages: ${response.messages.length}`);
      console.log(`  - hasMore: ${response.hasMore}`);
      console.log(`  - nextCursor: ${response.nextCursor}`);
      console.log(`  - total: ${response.total}`);

      expect(response.messages.length).toBeGreaterThan(0);
      expect(response.total).toBe(totalMessages);

      if (totalMessages > 10) {
        expect(response.hasMore).toBe(true);
        expect(response.nextCursor).not.toBeNull();
      }

      // Simulate: GET /api/threads/xxx/messages/paginated?cursor=xxx&limit=10
      if (response.nextCursor) {
        const page2 = db.getMessagesBefore(targetThreadId, response.nextCursor, 10);

        const oldest2 = page2.length > 0 ? page2[page2.length - 1].id : null;
        const hasMore2 = oldest2 ? db.hasMessagesBefore(targetThreadId, oldest2) : false;
        const nextCursor2 = hasMore2 ? oldest2 : null;

        const response2 = {
          messages: page2,
          hasMore: hasMore2,
          nextCursor: nextCursor2,
          total,
        };

        console.log("API Response (page 2):");
        console.log(`  - messages: ${response2.messages.length}`);
        console.log(`  - hasMore: ${response2.hasMore}`);
        console.log(`  - nextCursor: ${response2.nextCursor}`);

        // Verify no overlap with page 1
        const ids1 = new Set(response.messages.map((m) => m.id));
        const ids2 = new Set(response2.messages.map((m) => m.id));
        const overlap = [...ids1].filter((id) => ids2.has(id));

        expect(overlap).toHaveLength(0);
      }
    });
  });
});
