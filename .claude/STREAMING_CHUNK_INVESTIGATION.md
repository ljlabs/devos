# Streaming Chunk Rendering Issue - Investigation Guide

## Problem Statement

**During live chat**: Plain text agent responses (markdown) don't render in the UI until page refresh.
**After refresh**: The same message appears correctly.

This indicates:
- ✅ Server IS correctly accumulating chunks into the database
- ✅ Server IS storing the complete message
- ❌ WebSocket streaming might not be broadcasting accumulated chunks correctly
- ❌ Client might not be rendering them properly on live arrival

## How Streaming Chunks Should Work

### Server Side

1. **First chunk arrives** → No existing message yet
   - Creates NEW message with fresh ID: `msg-xyz-1`
   - Stores in DB
   - Broadcasts to WebSocket

2. **Subsequent chunks arrive** → Server looks for existing
   - Queries: `getMessageByThreadAndMessageId(threadId, messageId)`
   - Should FIND the message from chunk 1
   - **Accumulates** text in-place
   - **Updates** the same message in DB
   - **Broadcasts** the updated message with the SAME ID

### Client Side

1. **First chunk received** via WebSocket
   - `appendMessage(msg-xyz-1)` is called
   - Added to `confirmed` state
   - Rendered as `AgentChunkBubble`

2. **Second chunk received** via WebSocket
   - Same message ID: `msg-xyz-1`
   - `appendMessage` finds it in `confirmedIdsRef`
   - **Updates in-place** via `setConfirmed` map
   - React re-renders with new content

## Diagnostic Steps

### 1. Check Server Logs

When you reproduce the issue, look for these patterns in server logs:

```
[CHUNK FOUND] Accumulating chunk into existing message msg-xyz-1
[CHUNK NEW] First chunk - creating new message for messageId=gen-...
```

**What this tells you**:
- If you see only `[CHUNK NEW]` → Each chunk creates a new message (BAD)
- If you see `[CHUNK FOUND]` multiple times → Accumulation is working (GOOD)

### 2. Check WebSocket Messages

In browser DevTools Network tab, look at the WebSocket messages:

- Filter for `type: "message"` frames
- Look for the same message ID appearing multiple times
- Check if the content is growing (accumulated)

### 3. Check Browser Console

- Look for any errors in rendering
- Check if `AgentChunkBubble` is being called
- Verify `getMessageContent` is returning `type: "agent_chunk"`

### 4. React DevTools

- Inspect the `messages` array in `useOptimisticMessages`
- Verify that updating messages creates a new array (not mutating old one)
- Check if `confirmedIdsRef` is being updated

## Possible Causes

### Cause 1: Chunks Not Being Accumulated
**Symptom**: Every chunk creates a new message bubble
**Root cause**: `getMessageByThreadAndMessageId` might return `undefined`
**Fix location**: `server_src/server.ts` line 277

### Cause 2: Chunks Broadcast But Not Received
**Symptom**: Server logs show `[CHUNK FOUND]` but UI doesn't update
**Root cause**: WebSocket connection issue or message not reaching client
**Fix location**: `server_src/wsServer.ts` broadcastToThread

### Cause 3: Client Not Merging Updates
**Symptom**: Server broadcasts are received but not merged into state
**Root cause**: `appendMessage` not properly updating existing messages
**Fix location**: `src/hooks/useOptimisticMessages.ts` appendMessage

### Cause 4: Rendering Gate
**Symptom**: Messages in state but not rendering
**Root cause**: `getMessageContent` not parsing accumulated chunk format OR React key issue
**Fix location**: `src/components/ChatCanvas.tsx` getMessageContent or render loop

## Testing Checklist

- [ ] Recreate issue with any long text response
- [ ] Note the exact message ID and content
- [ ] Check server logs for `[CHUNK FOUND]` or `[CHUNK NEW]`
- [ ] Verify message appears after refresh
- [ ] Note timing: how long until refresh shows it?
- [ ] Check if other messages (tool calls) render correctly during same session

## Log Output Format

When logging is enabled, you should see output like:

```
09:46:15 [server] ACP message received: session/update
09:46:15 [server] [CHUNK NEW] First chunk - creating new message for messageId=gen-1783327571-DmtYYsZooKQzTrgg2MCp
09:46:16 [server] [CHUNK FOUND] Accumulating chunk into existing message msg-1783327575516-egjkihvfxy
09:46:17 [server] [CHUNK FOUND] Accumulating chunk into existing message msg-1783327575516-egjkihvfxy
09:46:18 [server] [CHUNK FOUND] Accumulating chunk into existing message msg-1783327575516-egjkihvfxy
```

This pattern shows **accumulation is working correctly**.

If you see:

```
09:46:15 [server] [CHUNK NEW] First chunk - creating new message for messageId=gen-1783327571-1
09:46:15 [server] [CHUNK NEW] First chunk - creating new message for messageId=gen-1783327571-2
09:46:15 [server] [CHUNK NEW] First chunk - creating new message for messageId=gen-1783327571-3
```

That means **chunks are NOT being accumulated** and each is creating a new message.

## Next Steps

1. Run the updated code with logging
2. Reproduce the issue
3. Collect the logs and WebSocket frame data
4. Share with analysis of which diagnostic step reveals the issue
5. Narrow down the cause based on the patterns above
