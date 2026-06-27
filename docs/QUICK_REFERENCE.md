# ACP Architecture Quick Reference

## The Core Principle
**DevOS is now a thin HTTP router around the ACP subprocess. All state flows through ACP.**

## What Lives Where

| Data | Location |
|------|----------|
| Workspaces, threads, session IDs | `db.json` + Thread state |
| **All conversation state** | **Raw ACP messages** (stored in `db.messages`) |
| Tool calls, results, permissions | **ACP messages** (not local files) |
| User prompts | **ACP messages** (not separate) |

## Message Flow Diagram

```
User Types Prompt
    ↓
POST /api/threads/{threadId}/messages
    ↓
Server stores user message + sends session/prompt to ACP
    ↓
ACP subprocess processes (async)
    ↓
ACP emits "message" events (raw JSON-RPC)
    ↓
wireAgent() stores each raw message in db.messages
    ↓
UI polls /api/threads/{threadId}/messages every 1-4s
    ↓
ChatCanvas renders raw ACP messages as bubbles
    ↓
[If permission needed]
    ↓
Permission bubble shows with dynamic buttons
    ↓
User clicks button
    ↓
POST /api/threads/{threadId}/respond {optionId}
    ↓
Server sends JSON-RPC response to ACP
    ↓
ACP resumes execution
```

## Thread State Object

```typescript
interface Thread {
  id: string;                           // "thread-1234567890"
  workspaceId: string;                  // "ws-auth"
  title: string;                        // "Refactor API"
  sessionId?: string;                   // ACP session ID
  status: 'idle' | 'thinking' | 'awaiting_permission' | 'running';
  
  // When ACP sends session/request_permission:
  pendingPermissionId?: number;         // ACP message.id
  pendingPermissionOptions?: Array<{
    kind: string;                       // "allow_always" | "allow_once" | "reject_once"
    name: string;                       // Button label
    optionId: string;                   // Sent back when clicked
  }>;
}
```

## Message Object

```typescript
interface Message {
  id: string;                 // "msg-1234567890"
  threadId: string;           // "thread-1234567890"
  timestamp: string;          // ISO 8601
  raw: any;                   // ← ENTIRE RAW ACP MESSAGE (untransformed)
  type?: string;              // Convenience: method name or type
}
```

## Raw Message Examples

### User Message
```json
{"role": "user", "content": "edit tmp.md"}
```

### Tool Pending
```json
{
  "method": "session/update",
  "params": {
    "update": {
      "status": "pending",
      "kind": "read",
      "title": "Read tmp.md",
      "rawInput": {"file_path": "/tmp.md"}
    }
  }
}
```

### Tool Result
```json
{
  "method": "session/update",
  "params": {
    "update": {
      "status": "succeeded",
      "kind": "read",
      "rawOutput": "file contents here"
    }
  }
}
```

### Permission Request
```json
{
  "method": "session/request_permission",
  "params": {
    "options": [
      {"kind": "allow_always", "name": "Always Allow", "optionId": "always"},
      {"kind": "allow_once", "name": "Allow", "optionId": "once"},
      {"kind": "reject_once", "name": "Reject", "optionId": "reject"}
    ],
    "toolCall": {
      "title": "Read /tmp.md",
      "kind": "read",
      "locations": [{"path": "/tmp.md"}]
    }
  }
}
```

### Permission Response (sent back)
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {"selected": {"optionId": "once"}}
}
```

## API Routes

### Messages
- `POST /api/threads/{threadId}/messages`  
  Body: `{text: "..."}` → Sends to ACP

- `GET /api/threads/{threadId}/messages`  
  Returns all raw messages for thread (from db.messages)

### Permissions
- `POST /api/threads/{threadId}/respond`  
  Body: `{optionId: "..."}` → Routes to ACP

### Threads
- `POST /api/workspaces/{workspaceId}/threads`  
  Body: `{title: "..."}` → Creates thread

- `GET /api/workspaces/{workspaceId}/threads`  
  Returns all threads in workspace

### Workspaces
- `GET /api/workspaces`
- `POST /api/workspaces`

## UI Rendering (ChatCanvas)

The `getMessageContent()` function parses raw messages and returns:

```typescript
{
  type: "user",
  content: "text"
} | {
  type: "agent_text",
  content: [array of content blocks]
} | {
  type: "tool_event",
  content: {status, title, kind, rawInput, rawOutput}
} | {
  type: "permission",
  content: {toolCall, options, permissionId}
}
```

Then renders:
- **user**: Right bubble
- **agent_text**: Left bot bubble
- **tool_event**: Left terminal bubble (pending or result)
- **permission**: Amber permission bubble with dynamic buttons

## Key Handler

```typescript
// In App.tsx
const handlePermissionResponse = async (optionId: string) => {
  await fetch(`/api/threads/{threadId}/respond`, {
    method: "POST",
    body: JSON.stringify({optionId})
  });
};

// In ChatCanvas props
onPermissionResponse={handlePermissionResponse}

// Used in permission button click
<button onClick={() => onPermissionResponse("always")}>
  Always Allow
</button>
```

## Debugging Tips

1. **Check db.json** for raw messages:
   ```bash
   cat db.json | jq '.messages | last'
   ```

2. **Watch thread status**:
   ```bash
   cat db.json | jq '.threads[] | {id, status, pendingPermissionId}'
   ```

3. **Verify ACP subprocess running**:
   - Check console for `[acp:threadId]` logs
   - ClaudeAgent stderr should show ACP output

4. **Test permission flow**:
   - Trigger file operation
   - Check for `session/request_permission` in db.messages
   - Check thread.pendingPermissionId is set
   - Click button → should send `session/respond` via HTTP
   - ACP should resume

## Performance Polling

UI polling frequency depends on thread status:
- **idle**: 4 seconds (slow)
- **thinking**: 1 second (fast)
- **awaiting_permission**: 1 second (fast)

Set in `src/App.tsx`:
```typescript
const interval = setInterval(
  () => {
    if (activeThreadId) fetchMessages(activeThreadId);
  },
  activeThreadStatus === 'awaiting_permission' || activeThreadStatus === 'thinking' 
    ? 1000 
    : 4000
);
```

## Summary

- **Store raw ACP messages** — don't interpret
- **Render raw ACP structures** — don't transform
- **Route responses back to ACP** — clean pass-through
- **Track minimal state** — only workspace/thread relationships
- **Dynamic UI** — buttons and options come from ACP

That's it. Everything else flows through the ACP protocol.
