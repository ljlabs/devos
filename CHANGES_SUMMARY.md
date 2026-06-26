# DevOS Changes Summary

## Phase 1: Permission and Status Display Fixes

### Issue 1: Permission requests only show for explicit `session/request_permission` calls
- Modified the permission event handler to only create UI messages when triggered from `handleLegacyPermissionRequest()` (identified by the "legacy-" prefix)
- Read-only commands now execute silently without showing permission prompts
- Only destructive operations that explicitly call `session/request_permission` will block and show the permission UI

### Issue 2: Chat messages display in proper order
- Messages are now stored and rendered in chronological order as they arrive in the DB
- Removed the intermediate placeholder message that could have disrupted ordering

### Issue 3: "Thinking" status appears in floating pill, not speech bubble
- Completely removed the "Initializing Claude Agent..." placeholder message from being created
- Agent messages only appear once the agent actually has content to send
- Status indicators ("thinking", "running") now exclusively display in the floating pill at the bottom of the chat
- ChatCanvas filters out any remaining placeholder messages

### Issue 4: Approved requests auto-resolve and remove from UI
- After approval, the permission message is marked with `approved: true`
- The UI immediately switches the button state to show "Approved & Executed" badge
- Approved permission messages are hidden from the UI after approval
- As new content flows in, the conversation naturally progresses forward

---

## Phase 2: Trusted Tools and Permission Visibility

### Issue 1: Hide Approved Permissions
Modified `ChatCanvas.tsx` to skip rendering `security_permission` messages when `approved === true`:
- After a user approves a permission request, it disappears from the chat
- Denied permissions remain visible for audit purposes
- Pending permissions show the action buttons

### Issue 2: Mark and Hide Trusted Tools
Added `trusted` field to the `Message` interface in `src/types.ts`:
```typescript
export interface Message {
  // ...
  trusted?: boolean; // Whether tool_call is auto-approved via rules
  // ...
}
```

New helper function `checkPermissionRule()` in `server.ts`:
- Checks if a command matches any security rule pattern
- Returns true if command is auto-approved via rules

Updated `wireAgentToDb()` to store tool calls with permission status:
- Tool calls are now stored in the DB (previously only emitted internally)
- Each tool call is marked with `trusted: true` if it matches a security rule
- Tool calls show up in database but may be hidden from UI based on trusted status

### Issue 3: Hide Trusted Tool Calls and Results
Modified `ChatCanvas.tsx` message rendering:
- Skip rendering tool_call messages where `trusted === true`
- Skip rendering tool_result messages if their associated tool_call is trusted
- Non-trusted tool calls/results are visible as before

### Final Message Visibility Rules

| Message Type | Condition | Display |
|---|---|---|
| `user_message` | Always | ✅ Always visible |
| `agent_message` | Always | ✅ Always visible |
| `tool_call` (trusted) | `trusted === true` | ❌ Hidden |
| `tool_call` (pending) | `trusted !== true` | ✅ Visible |
| `tool_result` (trusted tool) | Associated tool `trusted === true` | ❌ Hidden |
| `tool_result` (user-approved) | Associated tool `trusted !== true` | ✅ Visible |
| `security_permission` | `approved === true` | ❌ Hidden |
| `security_permission` | `approved === false` | ✅ Visible |
| `security_permission` | `approved === null` | ✅ Visible |

---

## Code Changes

### server.ts
1. **buildPermissionStrategy()** - Returns empty patterns array, requiring explicit permission
2. **checkPermissionRule()** - New helper to check if command matches security rules
3. **wireAgentToDb()** - Now:
   - Stores tool calls in DB with `trusted` flag based on permission rules
   - Creates agent messages only on first text chunk (no placeholder)
   - Tracks `agentMsgId` internally for accumulation
4. **POST /api/threads/:threadId/messages** - Removed placeholder agent message
5. **Agent state handler** - Only updates thread status for relevant state changes

### src/types.ts
1. Added `trusted?: boolean` field to Message interface for tool_call tracking

### src/components/ChatCanvas.tsx
1. Added filter to skip rendering "Initializing Claude Agent..." placeholder messages
2. Added filter to skip trusted tool_call messages (hidden from UI)
3. Added filter to skip tool_result messages for trusted tool calls
4. Added filter to skip security_permission messages when `approved === true`
5. Maintains proper message ordering with `.map()` over messages array

### src/App.tsx
1. Removed unused placeholder agent message state management
2. Simplified message fetch after send

---

## Behavior Flow

**User sends prompt → Creates user message → Status shows "thinking" in pill**

1. **User sends prompt**
   - User message created immediately
   - Status shows "thinking" in pill

2. **Agent runs Claude**
   - Creates agent message on first text chunk
   - Pill updates with progress

3. **Claude requests tool execution**
   - Tool call stored in DB
   - Check if command matches security rule
   - If trusted (matches rule): marked as `trusted: true`, hidden from UI, executes silently
   - If not trusted: marked as `trusted: false`, visible in UI, awaits permission if needed

4. **User approval flow (if needed)**
   - Permission message appears (if `session/request_permission` triggered)
   - User clicks Approve → Permission marked `approved: true` → Disappears from UI
   - User clicks Deny → Permission marked `approved: false` → Stays visible with "Clearance Denied" badge

5. **Tool execution**
   - Tool result stored in DB
   - If trusted tool: result hidden from UI
   - If user-approved tool: result visible in UI

6. **Turn finishes**
   - Status returns to "idle"
   - Conversation ready for next prompt

---

## Backward Compatibility

- Existing `db.json` messages without the `trusted` field work normally (undefined is falsy)
- The `approved` field remains as `null | boolean` as before
- No database migrations needed
- All changes are backward compatible with existing data

