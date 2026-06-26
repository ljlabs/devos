# Permission Management Fix - Option A Implementation

## Summary
Implemented Option A: Fixed the ACP permission handling to ensure Claude Code routes all tool calls through the permission callback system.

## Changes Made

### 1. Added `permissionMode: "default"` to `session/new` (Line 1097)
**File:** `server.ts` in `ACPManager.initialize()`

```typescript
const sessionResult = await this.sendRequest("session/new", {
  cwd: this.workspacePath,
  mcpServers: [],
  permissionMode: "default"  // ← NEW: Forces all tools through request_permission
});
```

**What this does:**
- Tells the Claude Code ACP wrapper to always request permission before executing tools
- Previously, the ACP was using its default permission mode (likely `auto` or `acceptEdits`), which auto-approved many tools silently
- Now every tool call will fire a `session/request_permission` message to your Node server, where your existing permission rules and user approval logic can catch it

### 2. Added Defensive Permission Bypass Detection (Lines 748-754, 864-915)

**New private properties:**
```typescript
private lastToolCallId: string | null = null;
private toolCallPermissionTimeout: NodeJS.Timeout | null = null;
```

**New timeout logic in `handleAgentNotification`:**
- When `tool_call_started` fires, a 500ms timeout is set
- If `session/request_permission` does NOT arrive within 500ms, it's treated as a silent bypass
- The system logs a security alert: `[SECURITY ALERT] Tool call executed without permission request`
- The tool call is retroactively marked with `bypassDetected: true` and `retroactive: true` in the UI
- A security alert message is injected into the conversation thread for visibility

**Why 500ms?**
- Gives the ACP time to emit `session/request_permission` for legitimate cases
- Quickly catches tools that slip through without permission requests
- Doesn't block legitimate tool execution (runs asynchronously)

## How Permission Flow Works Now

```
User sends prompt
    ↓
Claude Code (ACP) starts evaluating
    ↓
Claude Code decides to call a tool
    ↓
[tool_call_started notification fires]
    → Your server receives this
    → Sets 500ms timeout watching for request_permission
    ↓
Claude Code should emit [session/request_permission]
    → Your server's handleAgentRequest catches it
    → Checks rules: if matches "*" or rule pattern → auto-allow
    → Otherwise → sets pendingPermissionResolver and marks thread awaiting_permission
    → User approves/rejects in UI
    ↓
Tool executes with approval
```

**If bypass is detected (no request_permission in 500ms):**
```
[tool_call_started] fires
    → 500ms timeout starts
    → Tool executes
    → [tool_result] fires
    ↓
Security timeout triggers (never got permission request)
    → Logs warning to console
    → Marks tool as bypassDetected
    → Injects security alert message in thread for user to review
```

## What You Had Before (Broken)

- `permissionMode` was not specified, so ACP defaulted to `auto` or similar
- This mode auto-approved most tools without sending `session/request_permission`
- Your `checkPermission()` and `pendingPermissionResolver` were never invoked
- Tools like `pwd` executed silently with no permission check

## What You Have Now (Fixed)

1. **Primary layer**: `permissionMode: "default"` forces all tools through `session/request_permission`
2. **Secondary layer**: Rules-based auto-allow via `checkPermission()` — approved tools skip user prompt
3. **Tertiary layer**: User approval for unapproved tools via `pendingPermissionResolver`
4. **Safety net**: 500ms bypass detection catches edge cases where the ACP silently executes without permission

## Testing the Fix

1. Restart your server
2. In the UI, ask Claude to run a command (e.g., "run `ls`")
3. **Expected behavior (with fix):**
   - Thread status changes to `awaiting_permission`
   - Message shows "The agent is requesting permission to run a sensitive command."
   - An approve/reject button appears
   - Tool only executes after user clicks approve

4. **Old behavior (before fix):**
   - Command ran silently, no prompt appeared

## Rules System

Your existing rules system in `db.json` now works as intended:

```json
{
  "rules": [
    {
      "id": "rule-1782468767048",
      "commandPattern": "npm run test",
      "action": "allow",
      "createdAt": "2026-06-26T10:12:47.048Z"
    }
  ]
}
```

When Claude tries to run `npm run test`, the `checkPermission()` method checks if "npm run test" matches the pattern. If it does, permission is auto-granted. If not, user is prompted.

## Edge Cases Handled

1. **Multiple tools in quick succession**: Timeouts are cleared and reset for each `tool_call_started`
2. **Tool execution slower than 500ms**: Timeout triggers, marks as bypass, but doesn't interfere with tool execution
3. **Session/request_permission arrives within 500ms**: Timeout is cleared when `session/request_permission` fires, normal flow continues
4. **Tool completes**: Timeout is cleared when `tool_result` fires

## Next Steps (Optional)

1. **Add UI indicators**: Show in ChatCanvas when a tool call has `bypassDetected: true`
2. **Audit logging**: Log all permission decisions to a file for compliance
3. **Tighter timeout**: Reduce 500ms to 250ms if you want faster bypass detection (test first)
4. **Configure rules**: Add more patterns to `db.json` rules for common safe operations

## Potential Issues & Troubleshooting

### Issue: Still getting silent bypasses
- Check server logs for `[ACP Agent Output]` messages
- Ensure `permissionMode: "default"` is in the session/new params (verify in your code)
- Restart the Node server (changes don't apply to existing ACP processes)

### Issue: Everything requires approval now
- This is correct behavior with `permissionMode: "default"`
- Add rules to `db.json` to auto-approve safe commands
- Consider adding a UI toggle for users to switch permission modes

### Issue: Timeout fires for legitimate tools
- The tool still executes (timeout is non-blocking)
- You'll just see a retroactive security alert
- This is safe — better to over-alert than under-alert
- Can reduce 500ms timeout if it's too aggressive

## Related Code

- `checkPermission()` at line ~1040: Rules matching logic
- `handleAgentRequest()` at line ~930: Handles `session/request_permission`
- `/api/threads/:threadId/approve` and `/deny` endpoints: User approval endpoints (already exist)
- Frontend `ChatCanvas.tsx`: Shows pending actions and approve/deny buttons
