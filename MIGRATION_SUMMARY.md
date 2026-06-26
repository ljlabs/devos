# ACP Architecture Migration Summary

## What Changed

DevOS has been refactored from a **local state-driven system** to an **ACP-driven system** where the Agent Client Protocol is the source of truth for all conversation state.

## Files Modified

### 1. `src/types.ts` — Simplified Data Model
**Before:**
- `Thread`: Had `targetFile`, `activeSymbols`, `dependencies`
- `Message`: Had typed fields like `toolName`, `logs`, `codeBlock`, `pendingAction`, `sender`
- `SecurityRule`: Tracked permission rules
- Database had `rules` array

**After:**
- `Thread`: Minimal with only `id`, `workspaceId`, `title`, `sessionId`, `status`
- `Thread`: Now tracks `pendingPermissionId` and `pendingPermissionOptions` from ACP
- `Message`: Raw ACP message structure (`raw` field) + convenience `type` field
- `SecurityRule`: Removed entirely
- Database removed `rules` array

### 2. `server.ts` — Router Layer Only
**Before:**
- Created/managed message objects with typed fields
- Had approval/deny logic
- Managed rules
- Interpreted tool calls

**After:**
- Stores raw ACP messages verbatim
- Routes permission responses back to ACP via JSON-RPC
- `wireAgent()` only:
  - Listens to agent "message" events
  - Stores raw messages
  - Updates `thread.pendingPermissionId` and `thread.pendingPermissionOptions`
  - Updates thread status based on message method

**Removed Routes:**
- `/api/threads/{threadId}/approve` 
- `/api/threads/{threadId}/deny`
- `/api/rules` (GET/POST/DELETE)

**New/Modified Routes:**
- `POST /api/threads/{threadId}/respond` — responds to permission requests with raw JSON-RPC

### 3. `src/components/ChatCanvas.tsx` — ACP-Aware Rendering
**Before:**
- Rendered typed message fields (`toolName`, `logs`, `codeBlock`, etc.)
- Had local state for rule management
- Separate security permission UI

**After:**
- New `getMessageContent()` helper parses raw ACP messages
- Renders four message types from ACP:
  1. User messages (`{role: "user", content: "..."`)
  2. Agent text (`session/update` with `content` array)
  3. Tool events (`session/update` with `status`, `title`, `kind`, `rawInput`, `rawOutput`)
  4. Permission requests (`session/request_permission` with `options` array)
- Dynamic permission buttons come from `raw.params.options`
- New prop: `onPermissionResponse(optionId)` instead of `onApproveAction` / `onDenyAction` / `onAddRule`
- Removed props: `onApproveAction`, `onDenyAction`, `onAddRule`, `rules`

### 4. `src/App.tsx` — Simplified Event Handling
**Before:**
- `handleApproveAction()`, `handleDenyAction()`, `handleAddRule()`, `handleClearRules()`
- Fetched `/api/rules`
- Passed rules and handlers to ChatCanvas and ContextExplorer
- Rendered ContextExplorer column

**After:**
- Single new handler: `handlePermissionResponse(optionId)`
- Removed all rule-related code
- Removed ContextExplorer column and imports
- Removed SecurityRule import
- Simplified security tab to show "Managed by ACP" message

## New Concepts

### Raw Messages
All messages stored in `db.messages` are raw ACP JSON-RPC structures. Examples:

```typescript
// User message
{
  id: "msg-user-1234",
  threadId: "thread-abc",
  timestamp: "2026-06-26T19:37:00Z",
  raw: {role: "user", content: "..."},
  type: "user_message"
}

// Tool call
{
  id: "msg-1234",
  threadId: "thread-abc",
  timestamp: "2026-06-26T19:37:05Z",
  raw: {
    method: "session/update",
    params: {
      sessionId: "...",
      update: {
        status: "pending",
        kind: "read",
        title: "...",
        rawInput: {...},
        toolCallId: "..."
      }
    }
  },
  type: "session/update"
}

// Permission request
{
  id: "msg-1234",
  threadId: "thread-abc",
  timestamp: "2026-06-26T19:37:10Z",
  raw: {
    jsonrpc: "2.0",
    id: 1,
    method: "session/request_permission",
    params: {
      sessionId: "...",
      options: [...],
      toolCall: {...}
    }
  },
  type: "session/request_permission"
}
```

### Dynamic Permissions
Permission buttons now come from ACP's `session/request_permission.params.options` array. Each option has:
- `kind`: "allow_always" | "allow_once" | "reject_once" (determines button style)
- `name`: Button label text
- `optionId`: Sent back when clicked

### Minimal Thread State
Threads only track:
- What workspace they belong to
- Their session ID with the ACP agent
- Their current status (idle/thinking/awaiting_permission)
- The pending permission request (if any)

Everything else comes from reading `db.messages` for that thread.

## Database Before and After

### Before
```json
{
  "workspaces": [...],
  "threads": [{
    "id": "thread-1",
    "workspaceId": "ws-1",
    "title": "Refactor API",
    "targetFile": "/src/routes.js",
    "status": "awaiting_permission",
    "activeSymbols": [...],
    "dependencies": [...],
    "sessionId": "session-123"
  }],
  "messages": [{
    "id": "msg-1",
    "threadId": "thread-1",
    "type": "tool_call",
    "sender": "agent",
    "timestamp": "...",
    "text": "",
    "toolName": "Read",
    "toolCommand": "{...}",
    "trusted": false,
    "logs": null,
    "pendingAction": null
  }],
  "rules": [...]
}
```

### After
```json
{
  "workspaces": [...],
  "threads": [{
    "id": "thread-1",
    "workspaceId": "ws-1",
    "title": "Refactor API",
    "status": "awaiting_permission",
    "sessionId": "session-123",
    "pendingPermissionId": 1,
    "pendingPermissionOptions": [...]
  }],
  "messages": [{
    "id": "msg-1",
    "threadId": "thread-1",
    "timestamp": "...",
    "raw": {
      "method": "session/update",
      "params": {...}
    },
    "type": "session/update"
  }]
}
```

## Key Advantages

1. **Zero Interpretation**: Server never translates ACP protocol
2. **Faithful Rendering**: UI shows exactly what ACP sends
3. **Minimal State**: Only workspace/thread relationships in DB
4. **Scalable**: Add new ACP message types without server changes
5. **Dynamic UI**: Permission buttons, options, and styling come from ACP
6. **Single Source of Truth**: All state flows through ACP

## API Endpoint Changes

### Removed
- `POST /api/threads/{threadId}/approve`
- `POST /api/threads/{threadId}/deny`
- `GET /api/rules`
- `POST /api/rules`
- `DELETE /api/rules/{id}`

### Added
- `POST /api/threads/{threadId}/respond` — responds to permission requests

### Modified
- `POST /api/threads/{threadId}/messages` — still sends prompts, but response flow is async through ACP

## Testing the New System

1. **Start a thread**: Create a new thread in a workspace
2. **Send a prompt**: Type a message that triggers file operations
3. **Watch ACP messages arrive**: Messages will flow in as raw ACP updates
4. **UI will render**:
   - User message bubble
   - Agent thinking/response bubbles
   - Tool call pending bubbles
   - Permission request with dynamic buttons
5. **Click a permission button**: Sends the response back to ACP
6. **Watch execution continue**: Tool result bubble appears, agent responds

## Migration Checklist

- [x] Updated `src/types.ts` — simplified Thread and Message
- [x] Updated `server.ts` — raw message storage and ACP routing
- [x] Updated `src/components/ChatCanvas.tsx` — ACP-aware rendering
- [x] Updated `src/App.tsx` — single permission response handler
- [x] Removed unused imports and handlers
- [x] All TypeScript diagnostics passing
- [x] Documentation created (this file + guides)

## Next Steps

1. **Test locally**: Run the server and test message flow
2. **Verify ACP integration**: Ensure subprocess spawns correctly
3. **Test permissions**: Trigger a tool that requires permission
4. **Monitor message flow**: Check db.json to verify raw messages are stored
5. **UI rendering**: Verify buttons and bubbles render correctly
6. **Error handling**: Test failed tools and permission denials

---

**Status**: ✅ Migration complete and ready for testing.
