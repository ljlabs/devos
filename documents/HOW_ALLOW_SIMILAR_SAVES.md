# How Allow Similar Saves to db.json — Complete Guide

## The Flow

### Step 1: Tool Permission Request Arrives
When a tool needs permission, the ACP subprocess emits:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "session/request_permission",
  "params": {
    "toolCall": {
      "title": "Search for weather",
      "command": "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe C:/Users/jorda/.claude/skills/web-search/main.py text \"temperature today\" --max 5",
      "kind": "execute"
    },
    "options": [
      {"kind": "allow_always", "name": "Always Allow", "optionId": "allow_always"},
      {"kind": "allow_once", "name": "Allow", "optionId": "allow"},
      {"kind": "reject_once", "name": "Reject", "optionId": "reject"}
    ],
    "sessionId": "..."
  }
}
```

### Step 2: UI Shows Permission Buttons
Server stores this in thread:
```json
{
  "pendingPermissionId": 1,
  "pendingPermissionOptions": [
    {"kind": "allow_always", "name": "Always Allow", "optionId": "allow_always"},
    {"kind": "allow_once", "name": "Allow", "optionId": "allow"},
    {"kind": "reject_once", "name": "Reject", "optionId": "reject"}
  ]
}
```

UI renders buttons for user to click.

### Step 3: User Clicks "Always Allow"
UI sends POST request:
```bash
POST /api/threads/{threadId}/respond
Content-Type: application/json

{
  "optionId": "allow_always",
  "toolCommand": "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe C:/Users/jorda/.claude/skills/web-search/main.py text \"temperature today\" --max 5"
}
```

### Step 4: Server Saves Pattern to db.json
In `server.ts`, the `/respond` endpoint does this:

```typescript
if (optionId === "allow_always" && toolCommand) {
  updateDb((db) => {
    if (!db.allowedPatterns.includes(toolCommand)) {
      db.allowedPatterns.push(toolCommand);
    }
  });
}
```

### Step 5: db.json Updated
The pattern is saved. Before:
```json
{
  "workspaces": [...],
  "threads": [...],
  "messages": [...],
  "allowedPatterns": []
}
```

After:
```json
{
  "workspaces": [...],
  "threads": [...],
  "messages": [...],
  "allowedPatterns": [
    "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe C:/Users/jorda/.claude/skills/web-search/main.py text \"temperature today\" --max 5"
  ]
}
```

### Step 6: Next Time Same Tool is Called
When the agent calls the same tool again:
1. Server checks `allowedPatterns`
2. Pattern found → auto-approve (no UI prompt)
3. Tool executes immediately

## Code Flow Diagram

```
User Permission Request
        ↓
ACP emits: session/request_permission
        ↓
Server stores in thread.pendingPermissionOptions
        ↓
UI renders buttons
        ↓
User clicks "Always Allow"
        ↓
UI sends POST /api/threads/{threadId}/respond
        ├─ optionId: "allow_always"
        └─ toolCommand: "C:/Users/..."
        ↓
Server: if (optionId === "allow_always" && toolCommand)
        ├─ db.allowedPatterns.push(toolCommand)
        └─ writeDb(db)
        ↓
db.json updated ✅
        ↓
Next call to same tool:
        ├─ Check db.allowedPatterns
        ├─ Pattern found → auto-approve
        └─ No UI prompt shown
```

## What Gets Saved

### Full Command Pattern
The ENTIRE tool command string is saved:
```
C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe C:/Users/jorda/.claude/skills/web-search/main.py text "temperature today" --max 5
```

This is exact matching, so next call must be identical.

### Prefix Matching
You can manually add shorter patterns to `allowedPatterns`:
```json
"allowedPatterns": [
  "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe",
  "npm run lint",
  "npm",
  "*"
]
```

This uses prefix matching:
- `"C:/Users/.../python.exe"` → matches any python script call
- `"npm run"` → matches `npm run lint`, `npm run build`, etc.
- `"npm"` → matches any npm command
- `"*"` → matches everything

## db.json Structure

### Before First Permission
```json
{
  "workspaces": [...],
  "threads": [...],
  "messages": [...],
  "allowedPatterns": []
}
```

### After User Allows a Tool
```json
{
  "workspaces": [...],
  "threads": [...],
  "messages": [...],
  "allowedPatterns": [
    "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe C:/Users/jorda/.claude/skills/web-search/main.py text \"temperature today\" --max 5"
  ]
}
```

### After Multiple Tools Allowed
```json
{
  "workspaces": [...],
  "threads": [...],
  "messages": [...],
  "allowedPatterns": [
    "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe C:/Users/jorda/.claude/skills/web-search/main.py text \"temperature today\" --max 5",
    "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe C:/Users/jorda/.claude/skills/web-search/main.py text \"weather forecast\"",
    "npm run",
    "git commit"
  ]
}
```

## Key Code Locations

### 1. Where Pattern is Saved
**File:** `server.ts` (line ~490-510)

```typescript
app.post("/api/threads/:threadId/respond", async (req, res) => {
  const { optionId, toolCommand } = req.body;

  // SAVE HERE ↓
  if (optionId === "allow_always" && toolCommand) {
    updateDb((db) => {
      if (!db.allowedPatterns.includes(toolCommand)) {
        db.allowedPatterns.push(toolCommand);
      }
    });
  }
  // ↑ SAVE HERE
```

### 2. Where Pattern is Checked
**File:** `claudeAgent.ts` (line ~300-320)

```typescript
private dispatchIncoming(msg: any): void {
  // Tool call detected ↓
  if (update?.sessionUpdate === "tool_call" && update?.status === "pending") {
    const command = update.rawInput?.command || "unknown";

    // CHECK PATTERN HERE ↓
    if (this.strategy.isAllowed(command)) {
      // AUTO-APPROVE (no permission gate)
      return;
    }

    // PERMISSION GATE (show UI buttons)
    this.setState("awaiting_permission");
    this.emit("permission", this.pendingTool);
  }
}
```

### 3. Database Schema
**File:** `src/types.ts` (line ~52-56)

```typescript
export interface DatabaseSchema {
  workspaces: Workspace[];
  threads: Thread[];
  messages: Message[];
  allowedPatterns?: string[];  // ← NEW FIELD
}
```

## How the Pattern Matching Works

### StaticPermissionStrategy
**File:** `claudeAgent.ts` (line ~73-88)

```typescript
export class StaticPermissionStrategy implements IPermissionStrategy {
  constructor(private patterns: string[]) {}

  isAllowed(command: string): boolean {
    // Handle null/undefined safely
    if (!command || typeof command !== 'string') {
      return false;
    }
    
    // Wildcard allows everything
    if (this.patterns.includes("*")) return true;
    
    // Prefix matching: pattern must be start of command
    return this.patterns.some((pat) => command.startsWith(pat));
  }
}
```

### Example Matching
```
Pattern: "npm"
Command: "npm run lint"
Match? YES (command starts with pattern)

Pattern: "npm run"
Command: "npm run build"
Match? YES (command starts with pattern)

Pattern: "npm run lint"
Command: "npm run build"
Match? NO (command doesn't match exactly)

Pattern: "*"
Command: anything
Match? YES (wildcard matches all)
```

## Manual Pattern Management

### Add Pattern Manually
```bash
curl -X POST http://localhost:3000/api/allowedPatterns \
  -H "Content-Type: application/json" \
  -d '{"pattern": "npm run"}'
```

Result in `db.json`:
```json
"allowedPatterns": ["npm run"]
```

### Remove Pattern
```bash
curl -X DELETE http://localhost:3000/api/allowedPatterns \
  -H "Content-Type: application/json" \
  -d '{"pattern": "npm run"}'
```

Pattern removed from `db.json`.

### View All Patterns
```bash
curl http://localhost:3000/api/allowedPatterns
```

Returns all patterns in `allowedPatterns` array.

## Practical Examples

### Example 1: Web Search Tool
**Tool command:**
```
C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe C:/Users/jorda/.claude/skills/web-search/main.py text "temperature today" --max 5
```

**User clicks:** "Always Allow"

**Saved to db.json:**
```json
"allowedPatterns": [
  "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe C:/Users/jorda/.claude/skills/web-search/main.py text \"temperature today\" --max 5"
]
```

**Next time same tool is called:** Auto-approved (no UI prompt)

### Example 2: Multiple npm Commands
**Tool command 1:** `npm run lint`
**User clicks:** "Always Allow"

**Tool command 2:** `npm test`
**User clicks:** "Always Allow"

**db.json:**
```json
"allowedPatterns": [
  "npm run lint",
  "npm test"
]
```

### Example 3: Allow All Similar
**User clicks:** "Allow Similar" (wildcard)

**db.json:**
```json
"allowedPatterns": ["*"]
```

**Result:** All tools auto-approved forever

## Summary

**How it saves:**
1. User clicks "Always Allow" on permission prompt
2. UI sends POST with `optionId: "allow_always"` + `toolCommand`
3. Server calls `updateDb()` → `db.allowedPatterns.push(toolCommand)`
4. Changes written to `db.json` immediately
5. Next identical tool call checks pattern → auto-approved

**Key files:**
- `server.ts` — Saves pattern in `/respond` endpoint
- `claudeAgent.ts` — Checks pattern via `StaticPermissionStrategy`
- `db.json` — Persists `allowedPatterns` array
- `src/types.ts` — Defines `DatabaseSchema.allowedPatterns`

**Pattern matching:**
- Prefix-based (not exact)
- Wildcard `"*"` allows all
- Safe defaults (deny if no match)
