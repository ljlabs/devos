# DevOS ACP Architecture — Visual Diagrams

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Web Browser (React)                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  ChatCanvas Component                               │   │
│  │  ┌────────────────────────────────────────────────┐ │   │
│  │  │ getMessageContent(raw) → renders bubbles       │ │   │
│  │  │ ✓ User messages (right)                        │ │   │
│  │  │ ✓ Agent text (left)                            │ │   │
│  │  │ ✓ Tool pending/result (left terminal)          │ │   │
│  │  │ ✓ Permission requests (amber with buttons)     │ │   │
│  │  └────────────────────────────────────────────────┘ │   │
│  │  onSendMessage() → POST /api/threads/{id}/messages │   │
│  │  onPermissionResponse(optionId)                     │   │
│  │    → POST /api/threads/{id}/respond {optionId}      │   │
│  └──────────────────────────────────────────────────────┘   │
│                         ↕ HTTP                               │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                   Express Server (Node.js)                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ /api/threads/{id}/messages                          │   │
│  │ - Store user message in db.messages (raw)           │   │
│  │ - Initialize/resume ACP subprocess                  │   │
│  │ - Send session/prompt to ACP                        │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ /api/threads/{id}/respond                           │   │
│  │ - Extract optionId from request                     │   │
│  │ - Send JSON-RPC response to ACP                     │   │
│  │ - Update thread.pendingPermissionId = undefined     │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ wireAgent(agent, threadId)                          │   │
│  │ - Listen to agent "message" events                  │   │
│  │ - Store raw message in db.messages                  │   │
│  │ - Update thread.sessionId if provided              │   │
│  │ - Set thread.pendingPermissionId on permission     │   │
│  │ - Clear pendingPermissionId after tool execution    │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ db.json (File-based Database)                       │   │
│  │ ├─ workspaces[]                                     │   │
│  │ ├─ threads[]                                        │   │
│  │ └─ messages[] ← ALL RAW ACP MESSAGES               │   │
│  └──────────────────────────────────────────────────────┘   │
│                         ↕ stdin/stdout                       │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│         ClaudeAgent Subprocess (ACP Protocol)               │
│                                                              │
│  npx @agentclientprotocol/claude-agent-acp                 │
│  - Listens to JSON-RPC on stdin                            │
│  - Processes prompts                                        │
│  - Executes tools                                           │
│  - Requests permissions via JSON-RPC                        │
│  - Emits raw JSON-RPC messages on stdout                    │
│                                                              │
│  Examples:                                                   │
│  → {method: "session/prompt", params: {...}}               │
│  → {method: "session/respond", params: {...}}              │
│  ← {method: "session/update", params: {...}}               │
│  ← {method: "session/request_permission", params: {...}}   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Message Flow — Simple Prompt

```
User Type: "read file.txt"
       ↓
[User clicks Send]
       ↓
ChatCanvas.onSendMessage()
       ↓
POST /api/threads/thread-1/messages
Body: {text: "read file.txt"}
       ↓
Server:
  1. Create Message {id: "msg-user-123", raw: {role: "user", content: "..."}}
  2. Save to db.messages
  3. Update thread status = "thinking"
  4. Get ClaudeAgent instance
  5. Call agent.send({method: "session/prompt", ...})
       ↓
ACP Subprocess:
  1. Parse prompt
  2. Create tool call for file read
  3. Emit: {method: "session/update", params: {update: {status: "pending", ...}}}
       ↓
Server (wireAgent listening):
  1. Receive message event
  2. Store raw: {method: "session/update", ...}
  3. Update db.messages
       ↓
UI (polling /api/threads/thread-1/messages):
  1. Get message list
  2. ChatCanvas renders tool pending bubble
       ↓
ACP continues...
```

---

## Permission Request Flow

```
ACP Tool Ready for Execution
       ↓
ACP emits: {
  method: "session/request_permission",
  id: 1,
  params: {
    sessionId: "57080fd4-...",
    options: [
      {kind: "allow_always", name: "Always Allow", optionId: "always"},
      {kind: "allow_once", name: "Allow", optionId: "once"},
      {kind: "reject_once", name: "Reject", optionId: "reject"}
    ],
    toolCall: {title: "Read file.txt", kind: "read", ...}
  }
}
       ↓
Server (wireAgent listening):
  1. Receive message event
  2. Store raw message in db.messages
  3. Update thread.pendingPermissionId = 1
  4. Update thread.pendingPermissionOptions = [...options...]
       ↓
UI (polling):
  1. Get messages + thread state
  2. ChatCanvas.getMessageContent() identifies permission request
  3. Renders amber bubble with 3 buttons
       ↓
User Clicks "Allow"
       ↓
onPermissionResponse("once")
       ↓
POST /api/threads/thread-1/respond
Body: {optionId: "once"}
       ↓
Server:
  1. Get thread.pendingPermissionId (= 1)
  2. Send to ACP:
     {jsonrpc: "2.0", id: 1, result: {selected: {optionId: "once"}}}
  3. Clear thread.pendingPermissionId
  4. Update thread status = "thinking"
       ↓
ACP Subprocess:
  1. Receive JSON-RPC response
  2. Resolve pending RPC call
  3. Continue tool execution
  4. Emit: {method: "session/update", params: {update: {status: "succeeded", rawOutput: "file content"}}}
       ↓
Server stores result
       ↓
UI renders result bubble
       ↓
DONE ✓
```

---

## Data Model

### Thread Object
```typescript
{
  id: "thread-1",
  workspaceId: "ws-auth",
  title: "Refactor API",
  sessionId: "57080fd4-04c8-4bf4-bde0-e5b3bcfb2666",
  status: "awaiting_permission",
  
  // Set when ACP sends session/request_permission
  pendingPermissionId: 1,
  pendingPermissionOptions: [
    {kind: "allow_always", name: "Always Allow", optionId: "allow_always"},
    {kind: "allow_once", name: "Allow", optionId: "allow"},
    {kind: "reject_once", name: "Reject", optionId: "reject"}
  ]
}
```

### Message Object (Raw ACP)
```typescript
// User message
{
  id: "msg-user-123",
  threadId: "thread-1",
  timestamp: "2026-06-26T19:37:00Z",
  raw: {
    role: "user",
    content: "read file.txt"
  },
  type: "user_message"
}

// Tool pending
{
  id: "msg-456",
  threadId: "thread-1",
  timestamp: "2026-06-26T19:37:05Z",
  raw: {
    method: "session/update",
    params: {
      sessionId: "57080fd4-...",
      update: {
        toolCallId: "call_abc123",
        status: "pending",
        kind: "read",
        title: "Read file.txt",
        rawInput: {file_path: "file.txt"}
      }
    }
  },
  type: "session/update"
}

// Permission request
{
  id: "msg-perm-1",
  threadId: "thread-1",
  timestamp: "2026-06-26T19:37:10Z",
  raw: {
    method: "session/request_permission",
    id: 1,
    params: {
      sessionId: "57080fd4-...",
      options: [
        {kind: "allow_always", name: "Always Allow", optionId: "always"},
        ...
      ],
      toolCall: {title: "Read file.txt", kind: "read", ...}
    }
  },
  type: "session/request_permission"
}

// Tool result
{
  id: "msg-789",
  threadId: "thread-1",
  timestamp: "2026-06-26T19:37:15Z",
  raw: {
    method: "session/update",
    params: {
      sessionId: "57080fd4-...",
      update: {
        toolCallId: "call_abc123",
        status: "succeeded",
        kind: "read",
        title: "Read file.txt",
        rawOutput: "file contents here"
      }
    }
  },
  type: "session/update"
}
```

---

## UI Rendering Pipeline

```
Raw ACP Message
       ↓
ChatCanvas.messages.map(msg => {
  const parsed = getMessageContent(msg)
  
  if (parsed.type === "user") {
    return <UserBubble>{parsed.content}</UserBubble>
  }
  
  if (parsed.type === "agent_text") {
    return <AgentBubble>{parsed.content}</AgentBubble>
  }
  
  if (parsed.type === "tool_event") {
    const {status, title, rawInput, rawOutput} = parsed.content
    return status === "pending" 
      ? <ToolPendingBubble title={title} input={rawInput} />
      : <ToolResultBubble status={status} output={rawOutput} />
  }
  
  if (parsed.type === "permission") {
    const {toolCall, options, permissionId} = parsed.content
    return (
      <PermissionBubble>
        <p>{toolCall.title}</p>
        {options.map(opt => (
          <button onClick={() => onPermissionResponse(opt.optionId)}>
            {opt.name}
          </button>
        ))}
      </PermissionBubble>
    )
  }
})
```

---

## State Transitions

### Thread Status Transitions
```
┌─────┐
│idle │
└──┬──┘
   │ User sends message
   ↓
┌──────────┐
│ thinking │
└──┬──────┘
   │
   ├─ Tool execution
   │
   ├─→ ┌────────────────────┐
   │   │awaiting_permission │ ← ACP sends session/request_permission
   │   └────┬───────────────┘
   │        │ User responds
   │        ↓
   │   ┌──────────┐
   │   │ thinking │ ← ACP resumes
   │   └────┬─────┘
   │        │
   ↓        ↓
┌─────┐
│idle │ ← Tool complete or error
└─────┘
```

---

## API Flow Diagram

```
Browser                          Server                    ACP
                                                       subprocess
  │                               │                        │
  │ POST /messages {text}        │                        │
  │──────────────────────────>  │                        │
  │                               │ session/prompt      │
  │                               │───────────────────> │
  │                               │                        │
  │ (polling GET /messages)      │                        │
  │<───────────────────────────  │                        │
  │                               │ session/update      │
  │                               │<───────────────────  │
  │                               │ store raw msg      │
  │                               │                        │
  │ (UI renders tool bubble)      │                        │
  │                               │                        │
  │ (polling GET /messages)      │                        │
  │<───────────────────────────  │                        │
  │                               │                        │
  │                               │ session/request_   │
  │                               │ permission         │
  │                               │<───────────────────  │
  │                               │ set pendingPerm    │
  │                               │                        │
  │ (UI renders permission)      │                        │
  │                               │                        │
  │ POST /respond {optionId}     │                        │
  │──────────────────────────>  │ JSON-RPC resp    │
  │                               │ {id: N, result}   │
  │                               │───────────────────> │
  │                               │                        │
  │                               │ session/update    │
  │                               │<───────────────────  │
  │                               │                        │
  │ (polling GET /messages)      │                        │
  │<───────────────────────────  │                        │
  │                               │                        │
  │ (UI renders result)           │                        │
```

---

## Comparison: Before vs After

### Before (Typed Message Interpretation)
```
ACP Message → Server Interprets → Creates Typed Message → DB Stores → UI Renders
                    ↓
            "toolCallId: 123, toolName: 'Read', toolCommand: '{...}', logs: null"
```

### After (Raw Message Storage)
```
ACP Message → Server Stores Raw → DB Stores Raw → UI Parses Raw → Renders
                                      ↓
                    {method: "session/update", params: {update: {...}}}
```

---

## Permission Decision Tree

```
User sends prompt
       ↓
ACP processes
       ↓
Tool requires permission?
       │
       ├─ Yes → ACP sends session/request_permission
       │          ↓
       │        Server sets thread.pendingPermissionId
       │          ↓
       │        UI renders permission bubble with dynamic buttons
       │          ↓
       │        User clicks button
       │          ↓
       │        Server sends JSON-RPC response
       │          ↓
       │        ACP resumes (optionId decides action)
       │          │
       │          ├─ "allow_always" → Execute + remember
       │          ├─ "allow_once" → Execute once
       │          └─ "reject_once" → Abort this tool
       │
       └─ No → Tool executes immediately
              (e.g., non-destructive reads)
```

---

**These diagrams illustrate the complete ACP-driven architecture flow.**
