# DevOS ACP (Agent Client Protocol) Architecture

## Overview

DevOS has been refactored into a **thin HTTP router** that wraps the Agent Client Protocol (ACP) subprocess. The system is now **ACP-driven**, meaning all conversation state, tool calls, permissions, and results flow through the ACP protocol, not through local state management.

## Key Principles

### 1. Minimal Database State
`db.json` stores **only**:
- **Workspaces**: folder/project references
- **Threads**: conversation sessions with their workspace, title, and associated sessionId
- **Messages**: raw ACP messages (unmodified, as-is)

The database does **not** interpret or transform ACP messages.

### 2. ACP as Source of Truth
All conversation state (tool calls, results, permissions, text responses) comes from the ACP agent via raw JSON-RPC messages. These are stored verbatim in the database.

### 3. No Local Interpretation
- The server does not translate, interpret, or reformat ACP messages
- The UI renders raw ACP structures directly
- Permissions are not managed by the server—they're driven by `session/request_permission` messages from ACP

## Message Flow

### User Sends a Prompt

```
[User Types] → POST /api/threads/{threadId}/messages
    ↓
[Server stores raw message: {role: "user", content: "..."}]
    ↓
[Server initializes/resumes ACP subprocess with sessionId]
    ↓
[Server calls agent.send({method: "session/prompt", params: {sessionId, prompt}})
    ↓
[ACP subprocess processes the prompt and emits notifications]
```

### ACP Sends Notifications (async)

```
[ACP subprocess emits "message" event]
    ↓
[ClaudeAgent.on("message") bubbles raw JSON-RPC to server]
    ↓
[wireAgent() stores raw message in db.messages]
    ↓
[Thread status updates based on message type]
    ↓
[UI polls /api/threads/{threadId}/messages and re-renders]
```

### Permission Flow

```
[ACP sends: {method: "session/request_permission", params: {options: [...], toolCall: {...}}}]
    ↓
[Server stores raw message, sets thread.pendingPermissionId and thread.pendingPermissionOptions]
    ↓
[UI renders dynamic permission buttons from thread.pendingPermissionOptions]
    ↓
[User clicks button]
    ↓
[Client POST /api/threads/{threadId}/respond with {optionId}]
    ↓
[Server sends: {jsonrpc: "2.0", id: thread.pendingPermissionId, result: {selected: {optionId}}}]
    ↓
[ACP resumes execution]
```

## Data Types

### Thread
```typescript
interface Thread {
  id: string;
  workspaceId: string;
  title: string;
  sessionId?: string;
  status: 'thinking' | 'running' | 'awaiting_permission' | 'idle';
  
  // Current permission request (from ACP)
  pendingPermissionId?: number;
  pendingPermissionOptions?: Array<{
    kind: string;
    name: string;
    optionId: string;
  }>;
}
```

### Message
```typescript
interface Message {
  id: string;
  threadId: string;
  timestamp: string;
  
  // The raw, unmodified ACP message (JSON-RPC request/response/notification)
  raw: any;
  
  // Convenience field: the ACP method or message type
  type?: string;
}
```

## Server Routes

### Workspaces
- `GET /api/workspaces` — list all workspaces
- `POST /api/workspaces` — create a new workspace

### Threads
- `GET /api/workspaces/{workspaceId}/threads` — list threads in a workspace
- `POST /api/workspaces/{workspaceId}/threads` — create a new thread
- `GET /api/threads/{threadId}` — get thread details

### Messages
- `GET /api/threads/{threadId}/messages` — get all messages for a thread
- `POST /api/threads/{threadId}/messages` — send a user prompt (fires ACP session/prompt)

### Permissions
- `POST /api/threads/{threadId}/respond` — respond to a permission request
  - Body: `{optionId: string}`
  - Sends JSON-RPC response back to ACP

## UI Components

### ChatCanvas
Renders raw ACP messages as interactive speech bubbles:

- **User messages** (`{role: "user", content: "..."}`): Right-aligned bubble
- **Agent text** (`session/update` with `content` array): Left-aligned bot bubble
- **Tool events** (`session/update` with `status`, `title`, `kind`, `rawInput`, `rawOutput`):
  - Input shown immediately (pending state)
  - Output shown after execution
- **Permission requests** (`session/request_permission`):
  - Dynamic buttons from `options` array
  - Each button calls `onPermissionResponse(optionId)`

### Thread Management
- Threads display in ThreadList
- UI polls messages every 1-4 seconds (faster when `awaiting_permission` or `thinking`)
- Active thread shows in ChatCanvas header

## How to Use

### Start a Conversation
1. Select a workspace from the sidebar
2. Click "+ New Thread" to create a thread
3. Double-click the thread to activate it
4. Type a prompt in the input box at the bottom
5. Messages flow through ACP and appear as bubbles

### Respond to Permissions
When ACP requests permission:
1. A permission bubble appears with option buttons
2. Click the desired option (e.g., "Allow", "Allow Always", "Reject")
3. The server sends the response back to ACP
4. ACP resumes execution

## Advantages of This Architecture

- **Zero interpretation**: Server never translates or reformats ACP protocol
- **Faithful rendering**: UI shows exactly what ACP sends, no filtering
- **Minimal state**: Only workspace/thread/message relationships in DB
- **Scalable**: Easy to add new ACP message types without server changes
- **Dynamic permissions**: Button labels and options come from ACP, not hardcoded

## ACP Message Examples

### User Message (stored as-is)
```json
{
  "role": "user",
  "content": "edit tmp.md and write hello world"
}
```

### Tool Call Pending
```json
{
  "method": "session/update",
  "params": {
    "sessionId": "57080fd4-...",
    "update": {
      "toolCallId": "call_29ef7fd415b6468a8b76ebd7",
      "sessionUpdate": "tool_call",
      "status": "pending",
      "title": "Read C:\\Users\\jorda\\Documents\\workspace\\devos\\tmp.md",
      "kind": "read",
      "rawInput": {"file_path": "C:\\Users\\jorda\\Documents\\workspace\\devos\\tmp.md"}
    }
  }
}
```

### Permission Request
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "session/request_permission",
  "params": {
    "sessionId": "57080fd4-...",
    "options": [
      {"kind": "allow_always", "name": "Always Allow", "optionId": "allow_always"},
      {"kind": "allow_once", "name": "Allow", "optionId": "allow"},
      {"kind": "reject_once", "name": "Reject", "optionId": "reject"}
    ],
    "toolCall": {...}
  }
}
```

### Permission Response (sent back to ACP)
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {"outcome": {"outcome": "selected", "optionId": "allow"}}
}
```

## Integration with ClaudeAgent

The `ClaudeAgent` class is a thin wrapper that:
1. Spawns the ACP subprocess (`npx @agentclientprotocol/claude-agent-acp`)
2. Sends raw JSON-RPC messages to stdin
3. Emits "message" events for every inbound JSON-RPC line
4. Handles RPC await/response matching for initialization

The server's `wireAgent()` function:
1. Listens to agent "message" events
2. Stores each raw message in the database
3. Updates thread status based on message type
4. Tracks pending permission state

---

**Status**: Architecture refactored and ready for ACP-driven operation.
