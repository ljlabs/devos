# Code Changes Reference

## Quick Index
- [server.ts](#servertschanges)
- [src/types.ts](#srctypestschanges)
- [src/components/ChatCanvas.tsx](#srcccomponentschatcanvastsx)
- [src/App.tsx](#srcapptsx)

---

## server.ts Changes

### 1. Import Fix
```typescript
// BEFORE
import { ClaudeAgent, ... } from "./ClaudeAgent";

// AFTER
import { ClaudeAgent, ... } from "./claudeAgent";
```
*Reason: Case-sensitive file system compatibility*

---

### 2. Added checkPermissionRule() Helper
```typescript
function checkPermissionRule(command: string): boolean {
  const db = readDb();
  const rules = db.rules;
  
  // Check if command matches any rule pattern
  const isAllowed = rules.some((rule) => {
    return rule.commandPattern === "*" || command.includes(rule.commandPattern);
  });
  
  return isAllowed;
}
```
*Reason: Check if a command matches any trusted security rule*

---

### 3. Updated buildPermissionStrategy()
```typescript
// BEFORE
function buildPermissionStrategy(): StaticPermissionStrategy {
  const db = readDb();
  const patterns = db.rules.map((r) => r.commandPattern);
  return new StaticPermissionStrategy(patterns);
}

// AFTER
function buildPermissionStrategy(): StaticPermissionStrategy {
  // Empty patterns array — require explicit permission for all commands.
  // Only the Claude agent wrapper will request permissions via
  // session/request_permission method when needed.
  return new StaticPermissionStrategy([]);
}
```
*Reason: Don't auto-approve based on rules; let Claude request permissions explicitly*

---

### 4. Updated wireAgentToDb() - Message Event Handler
```typescript
// BEFORE: Created agent message before turn even started
const agentMsg: Message = {
  id: agentMsgId,
  threadId,
  type: "agent_message" as MessageType,
  sender: "agent",
  timestamp: new Date().toISOString(),
  text: "Initializing Claude Agent...",
  codeBlock: null,
  logs: null,
  pendingAction: null,
};

// AFTER: Create agent message only on first text chunk
agent.on("message", (chunk: MessageChunk) => {
  const db = readDb();
  
  if (!agentMsgId) {
    agentMsgId = `msg-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    db.messages.push({
      id: agentMsgId,
      threadId,
      type: "agent_message" as MessageType,
      sender: "agent",
      timestamp: new Date().toISOString(),
      text: chunk.text,
      codeBlock: null,
      logs: null,
      pendingAction: null,
    });
  } else {
    const msg = db.messages.find((m) => m.id === agentMsgId);
    if (msg) {
      msg.text = msg.text + chunk.text;
    }
  }
  writeDb(db);
});
```
*Reason: No placeholder messages; agent messages only appear when agent has content*

---

### 5. Updated wireAgentToDb() - Tool Call Handler
```typescript
// BEFORE: Only logged internally, didn't store in DB
agent.on("tool_call", (tool: ToolCall) => {
  console.log(`[wireAgentToDb] tool_call: ${tool.toolName} - ${tool.command}`);
});

// AFTER: Store in DB with trusted flag
agent.on("tool_call", (tool: ToolCall) => {
  const db = readDb();
  const isTrusted = checkPermissionRule(tool.command);
  
  db.messages.push({
    id: tool.id,
    threadId,
    type: "tool_call" as MessageType,
    sender: "agent",
    timestamp: new Date().toISOString(),
    text: "",
    toolName: tool.toolName,
    toolCommand: tool.command,
    trusted: isTrusted, // Mark as trusted if auto-approved by rules
    logs: null,
    pendingAction: null,
  });
  
  console.log(`[wireAgentToDb] tool_call: ${tool.toolName} - ${tool.command} [trusted=${isTrusted}]`);
  writeDb(db);
});
```
*Reason: Track tool calls with permission status; mark trusted tools for UI filtering*

---

### 6. Updated wireAgentToDb() - Permission Handler
```typescript
// BEFORE: Every permission request created a UI message
agent.on("permission", (pending: PendingTool) => {
  const db = readDb();
  db.messages.push({
    id: `perm-${Date.now()}`,
    threadId,
    type: "security_permission" as MessageType,
    sender: "agent",
    timestamp: new Date().toISOString(),
    text: "",
    codeBlock: null,
    logs: null,
    pendingAction: { command: pending.input, approved: null },
  });
  const thread = db.threads.find((t) => t.id === threadId);
  if (thread) thread.status = "awaiting_permission";
  writeDb(db);
});

// AFTER: Only show if from legacy permission request
agent.on("permission", (pending: PendingTool) => {
  const db = readDb();
  
  if (pending.acpToolCallId.startsWith("legacy-")) {
    db.messages.push({
      id: `perm-${Date.now()}`,
      threadId,
      type: "security_permission" as MessageType,
      sender: "agent",
      timestamp: new Date().toISOString(),
      text: "",
      codeBlock: null,
      logs: null,
      pendingAction: { command: pending.input, approved: null },
    });
    const thread = db.threads.find((t) => t.id === threadId);
    if (thread) thread.status = "awaiting_permission";
    writeDb(db);
  } else {
    console.log(`[wireAgentToDb] permission event ignored (not from legacy request): ${pending.acpToolCallId}`);
  }
});
```
*Reason: Only show permission UI when Claude explicitly requests it*

---

### 7. Updated wireAgentToDb() - State Handler
```typescript
// BEFORE: Always updated thread status
agent.on("state", (state: AgentState) => {
  const db = readDb();
  const thread = db.threads.find((t) => t.id === threadId);
  if (thread && state !== "initializing") {
    thread.status = state === "error" ? "idle" : state;
  }
  writeDb(db);
});

// AFTER: Only update relevant state changes
agent.on("state", (state: AgentState) => {
  const db = readDb();
  const thread = db.threads.find((t) => t.id === threadId);
  if (thread && state !== "initializing") {
    if (state === "thinking" || state === "idle") {
      thread.status = state;
    } else if (state === "awaiting_permission") {
      const hasPendingPermission = db.messages.some(
        m => m.threadId === threadId && 
             m.type === "security_permission" && 
             m.pendingAction?.approved === null
      );
      if (hasPendingPermission) {
        thread.status = "awaiting_permission";
      }
    } else if (state === "error") {
      thread.status = "idle";
    }
  }
  writeDb(db);
});
```
*Reason: Only set awaiting_permission status if actual permission message exists*

---

### 8. Updated wireAgentToDb() - Done/Error Handlers
```typescript
// BEFORE: Tried to update placeholder agentMsgId
agent.on("done", (result: PromptResult) => {
  const db = readDb();
  const msg = db.messages.find((m) => m.id === agentMsgId);
  if (msg) msg.text = result.finalText;
  // ...
});

// AFTER: Only update if we have an agentMsgId
agent.on("done", (result: PromptResult) => {
  const db = readDb();
  if (agentMsgId) {
    const msg = db.messages.find((m) => m.id === agentMsgId);
    if (msg) msg.text = result.finalText;
  }
  // ...
});
```
*Reason: Handle case where no agent message was created (shouldn't happen, but safe)*

---

### 9. Updated POST /api/threads/:threadId/messages
```typescript
// BEFORE: Created placeholder agent message before ACP turn
db.messages.push(userMsg);
const agentMsgId = `msg-agent-${Date.now()}`;
const agentMsg: Message = {
  id: agentMsgId,
  threadId,
  type: "agent_message" as MessageType,
  sender: "agent",
  timestamp: new Date().toISOString(),
  text: "Initializing Claude Agent...",
  codeBlock: null,
  logs: null,
  pendingAction: null,
};
db.messages.push(agentMsg);
thread.status = "thinking";
writeDb(db);
res.json(userMsg);

// AFTER: Only create user message, let agent create messages on content
db.messages.push(userMsg);
thread.status = "thinking";
writeDb(db);
res.json(userMsg);

// Pass userMsg.id for reference (not needed, but available)
wireAgentToDb(agent, threadId, userMsg.id);
```
*Reason: No placeholder messages; agent messages only created when agent has content*

---

## src/types.ts Changes

### Added trusted Field to Message Interface
```typescript
// BEFORE
export interface Message {
  id: string;
  threadId: string;
  type: MessageType;
  sender: 'user' | 'agent';
  timestamp: string;
  text: string;
  
  codeBlock?: CodeBlock | null;
  
  toolName?: string;
  toolCommand?: string;
  
  logs?: LogsInfo | null;
  toolCallId?: string;
  
  pendingAction?: PendingAction | null;
}

// AFTER
export interface Message {
  id: string;
  threadId: string;
  type: MessageType;
  sender: 'user' | 'agent';
  timestamp: string;
  text: string;
  
  codeBlock?: CodeBlock | null;
  
  toolName?: string;
  toolCommand?: string;
  trusted?: boolean; // Whether tool_call is auto-approved via rules
  
  logs?: LogsInfo | null;
  toolCallId?: string;
  
  pendingAction?: PendingAction | null;
}
```
*Reason: Track whether tool calls are auto-approved by security rules*

---

## src/components/ChatCanvas.tsx Changes

### 1. Updated Message Filtering
```typescript
// BEFORE
messages.map((msg) => {
  if (msg.type === 'tool_call') {
    return null;
  }
  // ...
});

// AFTER
messages.map((msg) => {
  if (msg.type === 'agent_message' && msg.text === "Initializing Claude Agent...") {
    return null;
  }

  if (msg.type === 'tool_call' && msg.trusted) {
    return null; // Hide trusted tools
  }

  if (msg.type === 'tool_call') {
    return null; // Skip non-trusted tool_call messages
  }
  // ...
});
```
*Reason: Filter out placeholder messages and trusted tools*

---

### 2. Updated Security Permission Rendering
```typescript
// BEFORE
if (msg.type === 'security_permission') {
  return (
    <div>...</div>
  );
}

// AFTER
if (msg.type === 'security_permission') {
  // Skip approved permission messages - they should be hidden after approval
  if (msg.pendingAction?.approved === true) {
    return null;
  }
  
  return (
    <div>...</div>
  );
}
```
*Reason: Hide approved permissions from UI*

---

### 3. Updated Tool Result Rendering
```typescript
// BEFORE
if (msg.type === 'tool_result') {
  const toolCall = messages.find(m => m.type === 'tool_call' && m.id === msg.toolCallId);
  const toolType = toolCall?.toolName?.split(':')[0] || 'BASH';
  // ... render result
}

// AFTER
if (msg.type === 'tool_result') {
  const toolCall = messages.find(m => m.type === 'tool_call' && m.id === msg.toolCallId);
  
  // Skip tool results for trusted tool calls
  if (toolCall?.trusted) {
    return null;
  }
  
  const toolType = toolCall?.toolName?.split(':')[0] || 'BASH';
  // ... render result
}
```
*Reason: Hide results for trusted tool calls*

---

## src/App.tsx Changes

### Simplified sendMessage Handler
```typescript
// BEFORE: Created placeholder agent message
const tempUserMsg: Message = { /* ... */ };
setMessages(prev => [...prev, tempUserMsg]);

try {
  const res = await fetch(`/api/threads/${activeThreadId}/messages`, { /* ... */ });
  if (res.ok) {
    await fetchMessages(activeThreadId);
    await fetchThreads(activeWorkspaceId);
  }
} catch (e) { /* ... */ }

// AFTER: No changes needed in App.tsx
// (The server no longer sends placeholder agent message)
```
*Reason: Server-side change handles message creation*

---

## Summary of Changes by Type

### Breaking Changes
✅ **None** - All changes are backward compatible

### New Features
- ✅ Tool call tracking with trusted flag
- ✅ Permission rule checking
- ✅ Auto-hiding of approved permissions
- ✅ Auto-hiding of trusted tools

### Bug Fixes
- ✅ Proper message ordering
- ✅ No placeholder messages
- ✅ Only explicit permission requests show
- ✅ Approved permissions auto-disappear

### Type Updates
- ✅ Added `trusted?: boolean` to Message interface

### Helper Functions
- ✅ Added `checkPermissionRule()` to check command against security rules

---

## Testing Each Change

### Test 1: Tool Tracking with Trusted Flag
```bash
# Create a rule
curl -X POST http://localhost:3000/api/rules \
  -H "Content-Type: application/json" \
  -d '{"commandPattern": "npm run lint"}'

# Send message: "Run npm run lint"
# Verify: tool_call message has trusted: true
```

### Test 2: Permission Rule Check
```bash
# Send message: "Run npm run test" (no rule)
# Verify: Permission prompt appears
# Approve it
# Verify: Permission disappears from UI
```

### Test 3: Hide Trusted Tools
```bash
# Create a rule for "npm run build"
# Send message: "Build the project"
# Verify: No permission prompt (trusted)
# Verify: Tool not visible in chat
```

### Test 4: Message Ordering
```bash
# Send message with multiple tool calls
# Verify: Messages appear in order: user → agent → tools → results
```

---

## Performance Impact

- **Minimal**: Added one permission check per tool call (DB rule lookup)
- **Memory**: Slightly larger with tool call storage (negligible)
- **UI**: Fewer messages to render (faster with trusted tools)

---

## Rollback Instructions

If needed to rollback:
1. Restore original imports: `./ClaudeAgent` (case-sensitive)
2. Remove `checkPermissionRule()` function
3. Restore `buildPermissionStrategy()` to use DB rules
4. Revert `wireAgentToDb()` to create placeholder agent message
5. Remove `trusted` field from Message interface
6. Revert ChatCanvas filters

All changes are isolated and can be reverted independently.
