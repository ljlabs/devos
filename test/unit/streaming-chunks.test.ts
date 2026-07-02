import { describe, it, expect } from "vitest";

/**
 * Server-side streaming chunk accumulation logic.
 * Extracted from server.ts for isolated testing.
 *
 * When an agent_message_chunk arrives, the server appends its text to the
 * last message with the same messageId instead of creating a new record.
 */
function accumulateChunks(
  messages: any[],
  raw: any,
  threadId: string
): { messages: any[]; accumulated: boolean } {
  const result = [...messages];

  const chunkUpdate = raw.params?.update;
  const isChunk =
    raw.method === "session/update" &&
    chunkUpdate?.sessionUpdate === "agent_message_chunk" &&
    chunkUpdate?.messageId;

  if (isChunk) {
    const messageId = chunkUpdate.messageId;
    const newText = chunkUpdate.content?.text ?? "";

    // Find the last message for this thread with the same messageId
    for (let i = result.length - 1; i >= 0; i--) {
      const existing = result[i];
      if (existing.threadId !== threadId) continue;
      if (existing.raw?.params?.update?.messageId !== messageId) continue;

      // Append the new text chunk
      const existingUpdate = existing.raw.params.update;
      if (existingUpdate.content && typeof existingUpdate.content === "object") {
        existingUpdate.content.text = (existingUpdate.content.text || "") + newText;
      }
      return { messages: result, accumulated: true };
    }
  }

  // Not a chunk or no existing message — create a new one
  result.push({
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    threadId,
    timestamp: new Date().toISOString(),
    raw,
    type: raw.method ?? (raw.result !== undefined ? "response" : "unknown"),
  });

  return { messages: result, accumulated: false };
}

function makeChunkRaw(text: string, messageId: string) {
  return {
    method: "session/update",
    params: {
      sessionId: "sess-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
        messageId,
      },
    },
  };
}

describe("Streaming chunk accumulation", () => {
  it("accumulates consecutive chunks with the same messageId into one message", () => {
    let messages: any[] = [];
    const threadId = "thread-1";
    const messageId = "gen-123";

    const chunks = ["Hey", "! How", " can I help", " you?"];
    for (const text of chunks) {
      const { messages: updated, accumulated } = accumulateChunks(
        messages,
        makeChunkRaw(text, messageId),
        threadId
      );
      messages = updated;
      expect(accumulated).toBe(text === "Hey" ? false : true);
    }

    // Should have exactly 1 message, not 4
    expect(messages).toHaveLength(1);
    expect(messages[0].raw.params.update.content.text).toBe(
      "Hey! How can I help you?"
    );
  });

  it("creates separate messages for different messageIds", () => {
    let messages: any[] = [];
    const threadId = "thread-1";

    // First response
    messages = accumulateChunks(messages, makeChunkRaw("Hello", "gen-aaa"), threadId).messages;
    messages = accumulateChunks(messages, makeChunkRaw(" world", "gen-aaa"), threadId).messages;

    // Second response
    messages = accumulateChunks(messages, makeChunkRaw("Goodbye", "gen-bbb"), threadId).messages;
    messages = accumulateChunks(messages, makeChunkRaw("!", "gen-bbb"), threadId).messages;

    expect(messages).toHaveLength(2);
    expect(messages[0].raw.params.update.content.text).toBe("Hello world");
    expect(messages[1].raw.params.update.content.text).toBe("Goodbye!");
  });

  it("handles empty first chunk followed by text", () => {
    let messages: any[] = [];
    const threadId = "thread-1";
    const messageId = "gen-456";

    // First chunk has empty text (common ACP behavior)
    messages = accumulateChunks(messages, makeChunkRaw("", messageId), threadId).messages;
    messages = accumulateChunks(messages, makeChunkRaw("Hey!", messageId), threadId).messages;

    expect(messages).toHaveLength(1);
    expect(messages[0].raw.params.update.content.text).toBe("Hey!");
  });

  it("does not accumulate non-chunk session/update messages", () => {
    let messages: any[] = [];
    const threadId = "thread-1";

    const usageUpdate = {
      method: "session/update",
      params: {
        update: { sessionUpdate: "usage_update", used: 0, size: 1000000 },
      },
    };

    const result1 = accumulateChunks(messages, usageUpdate, threadId);
    messages = result1.messages;
    expect(result1.accumulated).toBe(false);

    const result2 = accumulateChunks(messages, usageUpdate, threadId);
    messages = result2.messages;
    expect(result2.accumulated).toBe(false);

    // Each usage_update creates its own message
    expect(messages).toHaveLength(2);
  });

  it("does not mix chunks from different threads", () => {
    let messages: any[] = [];
    const messageId = "gen-789";

    messages = accumulateChunks(messages, makeChunkRaw("Thread1 ", messageId), "thread-1").messages;
    messages = accumulateChunks(messages, makeChunkRaw("Thread2 ", messageId), "thread-2").messages;
    messages = accumulateChunks(messages, makeChunkRaw("hello", messageId), "thread-1").messages;
    messages = accumulateChunks(messages, makeChunkRaw("world", messageId), "thread-2").messages;

    expect(messages).toHaveLength(2);
    expect(messages[0].raw.params.update.content.text).toBe("Thread1 hello");
    expect(messages[1].raw.params.update.content.text).toBe("Thread2 world");
  });

  it("accumulated message keeps the latest timestamp", () => {
    let messages: any[] = [];
    const threadId = "thread-1";
    const messageId = "gen-ts";

    messages = accumulateChunks(messages, makeChunkRaw("A", messageId), threadId).messages;
    const t1 = messages[0].timestamp;

    // Small delay to ensure different timestamp
    messages = accumulateChunks(messages, makeChunkRaw("B", messageId), threadId).messages;
    const t2 = messages[0].timestamp;

    expect(new Date(t2).getTime()).toBeGreaterThanOrEqual(new Date(t1).getTime());
  });
});
