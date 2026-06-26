# Bug Fixes: Message Ordering and Permission Visibility

This document describes the fixes for two critical UI bugs in the DevOS conversation interface.

## Bug 1: Message Ordering Issue

### Problem
When a user sends a message and Claude requests a tool:
- **Expected order**: User message → Agent message → Tool call (or permission request)
- **Actual order**: User message → Tool call → Agent message (updated in place)

The agent message was being updated multiple times via `agent_message_chunk` notifications. When a `tool_call` arrived during these updates, it was added to the database array after the agent message. However, the agent message continued to be updated, making it appear to change/move in the UI after the tool call had been added.

### Root Cause
In `server.ts`, the `handleAgentNotification()` method processes `agent_message_chunk` updates on the LAST agent message, regardless of whether tool calls or permission messages had already been appended after it.

### Solution
Modified the `agent_message_chunk` handling to check if there are any `tool_call` or `security_permission` messages after the target agent message. If so, the agent message is frozen and not updated further. This prevents agent message updates from appearing "after" tool calls in the database.

**Changes in `server.ts` (lines 961-980)**:
```typescript
// Only update the agent message if there are no tool_call or security_permission messages after it
// This preserves message ordering in the UI
const allMessages = db.messages.filter(m => m.threadId === this.threadId);
const lastAgentMsgIndex = allMessages.findIndex(m => m.id === lastMsg?.id);
const hasToolOrPermissionAfter = allMessages.slice(lastAgentMsgIndex + 1).some(
  m => m.type === 'tool_call' || m.type === 'security_permission'
);

if (lastMsg && !hasToolOrPermissionAfter) {
  const content = update.content;
  if (content && content.type === "text") {
    lastMsg.text = (lastMsg.text === "Initializing Claude Agent..." || lastMsg.text === "Thinking..." ? "" : lastMsg.text) + content.text;
    writeDb(db);
  }
}
```

---

## Bug 2: Permission Request Visibility

### Problem
1. **Approved permissions stayed visible** - After a user approved a permission request, it still appeared in the chat history
2. **Denied permissions should stay visible** - These correctly remained visible for audit purposes
3. **Trusted tools showed permission UI** - Tools that were auto-approved via security rules still showed permission request bubbles, or showed tool execution messages

### Root Cause
- Approved security_permission messages were never hidden from the UI
- Tool calls for auto-approved commands (trusted tools) had no way to be hidden

### Solution
Three complementary fixes:

#### 1. Hide Approved Permissions in UI
Modified `ChatCanvas.tsx` to skip rendering `security_permission` messages when `approved === true`:

```typescript
// Skip approved permission messages - they should be hidden after approval
if (msg.type === 'security_permission' && msg.pendingAction?.approved === true) {
  return null;
}
```

#### 2. Mark Trusted Tools
Added a `trusted` field to the `Message` interface in `src/types.ts`:
```typescript
export interface Message {
  // ...
  // For tool_call
  toolName?: string;
  toolCommand?: string;
  trusted?: boolean; // Whether tool_call is auto-approved via rules
  // ...
}
```

Modified `server.ts` to mark auto-approved tool calls with `trusted: true` (lines 1001-1019):
```typescript
// Check permissions first
const isAllowed = this.checkPermission(toolInput);

const toolCallMsg: Message = {
  // ...
  trusted: isAllowed, // Mark as trusted if auto-approved
  // ...
};
```

#### 3. Hide Trusted Tool Messages
Modified `ChatCanvas.tsx` to skip rendering tool calls and their results when marked as trusted:

```typescript
// Skip tool_call messages - they're rendered with their tool_result
// Skip trusted tool calls (auto-approved via rules) - they should be invisible
if (msg.type === 'tool_call') {
  if (msg.trusted) {
    return null; // Skip trusted tools entirely
  }
  // Skip non-trusted tool_call messages (they're rendered with their tool_result)
  return null;
}
```

And in tool_result rendering:
```typescript
// Skip tool results for trusted tool calls
if (toolCall?.trusted) {
  return null;
}
```

---

## Final Message Visibility Rules

| Message Type | Condition | Display |
|---|---|---|
| `user_message` | Always | ✅ Always visible |
| `agent_message` | Always | ✅ Always visible |
| `tool_call` (trusted) | `trusted === true` | ❌ Hidden |
| `tool_call` (pending) | `trusted !== true` | ✅ Visible (part of UI flow) |
| `tool_result` (trusted tool) | Associated tool `trusted === true` | ❌ Hidden |
| `tool_result` (user-approved) | Associated tool `trusted !== true` | ✅ Visible |
| `security_permission` | `approved === true` | ❌ Hidden (cleanup) |
| `security_permission` | `approved === false` | ✅ Visible (audit trail) |
| `security_permission` | `approved === null` | ✅ Visible (waiting for action) |

---

## Testing

The fixes maintain backward compatibility:
- Existing `db.json` messages without the `trusted` field work normally (undefined is falsy)
- The `approved` field remains as `null | boolean` as before
- No database migrations needed

### Manual Testing Steps
1. Create a security rule: `npm run lint` → Allow
2. Ask Claude to run `npm run lint` → Tool should be invisible (no permission prompt)
3. Ask Claude to run `npm run build` → Permission prompt should appear
4. Click Approve → Permission message should disappear
5. Click Deny → Permission message should remain with "Clearance Denied" badge

---

## Files Modified
1. `server.ts` - Agent message freezing logic + trusted tool marking
2. `src/types.ts` - Added `trusted?: boolean` field to Message interface
3. `src/components/ChatCanvas.tsx` - Hide approved permissions and trusted tools
