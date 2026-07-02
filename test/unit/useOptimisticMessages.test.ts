import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOptimisticMessages } from "../../src/hooks/useOptimisticMessages";
import type { Message } from "../../src/types";

function makeMsg(id: string, text: string, threadId = "t-1"): Message {
  return {
    id,
    threadId,
    timestamp: "2024-01-01T00:00:00Z",
    raw: {
      params: {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
          messageId: "gen-123",
        },
      },
    },
    type: "session/update",
  };
}

describe("useOptimisticMessages", () => {
  describe("appendMessage", () => {
    it("appends a new message", () => {
      const { result } = renderHook(() => useOptimisticMessages());
      const msg = makeMsg("msg-1", "Hello");

      act(() => result.current.appendMessage(msg));

      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0].id).toBe("msg-1");
    });

    it("updates an existing message in place when ID matches (streaming accumulation)", () => {
      const { result } = renderHook(() => useOptimisticMessages());

      act(() => result.current.appendMessage(makeMsg("msg-1", "Hey")));
      expect(result.current.messages[0].raw.params.update.content.text).toBe("Hey");

      act(() => result.current.appendMessage(makeMsg("msg-1", "Hey! How")));
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0].raw.params.update.content.text).toBe("Hey! How");
    });

    it("handles multiple streaming accumulation rounds", () => {
      const { result } = renderHook(() => useOptimisticMessages());

      act(() => result.current.appendMessage(makeMsg("msg-1", "")));
      act(() => result.current.appendMessage(makeMsg("msg-1", "Hey")));
      act(() => result.current.appendMessage(makeMsg("msg-1", "Hey! How")));
      act(() => result.current.appendMessage(makeMsg("msg-1", "Hey! How can I help")));

      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0].raw.params.update.content.text).toBe(
        "Hey! How can I help"
      );
    });

    it("keeps separate messages with different IDs", () => {
      const { result } = renderHook(() => useOptimisticMessages());

      act(() => result.current.appendMessage(makeMsg("msg-1", "First")));
      act(() => result.current.appendMessage(makeMsg("msg-2", "Second")));

      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[0].id).toBe("msg-1");
      expect(result.current.messages[1].id).toBe("msg-2");
    });

    it("does not duplicate messages with the same ID", () => {
      const { result } = renderHook(() => useOptimisticMessages());

      act(() => result.current.appendMessage(makeMsg("msg-1", "Hello")));
      act(() => result.current.appendMessage(makeMsg("msg-1", "Hello")));

      expect(result.current.messages).toHaveLength(1);
    });
  });
});
