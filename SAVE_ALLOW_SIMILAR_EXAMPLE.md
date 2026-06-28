# Save Allow Similar to db.json — Step-by-Step Example

## Real-World Scenario

You're running DevOS. Claude tries to search the web using a Python MCP tool. The system asks for permission:

```
Permission Request: 
- Tool: Web Search (Python script)
- Command: C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe C:/Users/jorda/.claude/skills/web-search/main.py text "temperature today" --max 5

Buttons:
[Always Allow] [Allow] [Reject]
```

## When User Clicks "Always Allow"

### Step 1: UI Sends Request
```bash
POST /api/threads/thread-1782640950468/respond
Content-Type: application/json

{
  "optionId": "allow_always",
  "toolCommand": "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe C:/Users/jorda/.claude/skills/web-search/main.py text \"temperature today\" --max 5"
}
```

### Step 2: Server Receives Request
In `server.ts` line ~490-510:
```typescript
app.post("/api/threads/:threadId/respond", async (req, res) => {
  const { optionId, toolCommand } = req.body;
  
  // optionId = "allow_always"
  // toolCommand = "C:/Users/jorda/.claude/skills/web-search/...python.exe..."

  if (optionId === "allow_always" && toolCommand) {
    updateDb((db) => {
      // Ensure field exists
      db.allowedPatterns = db.allowedPatterns || [];
      
      // Add pattern if not already there
      if (!db.allowedPatterns.includes(toolCommand)) {
        db.allowedPatterns.push(toolCommand);
        logInfo("server", `Pattern added: ${toolCommand}`);
      }
    });
  }
```

### Step 3: db.json Updated

**BEFORE (user clicks "Always Allow"):**
```json
{
  "workspaces": [...],
  "threads": [...],
  "messages": [...],
  "allowedPatterns": []
}
```

**AFTER (pattern saved):**
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

## Next Time: Automatic Approval

When Claude tries to call the **same** web search tool again:

### Step 1: Tool Request Arrives
```json
{
  "toolCallId": "call_xyz123",
  "sessionUpdate": "tool_call",
  "status": "pending",
  "rawInput": {
    "command": "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe C:/Users/jorda/.claude/skills/web-search/main.py text \"temperature today\" --max 5"
  }
}
```

### Step 2: Server Checks Pattern
In `claudeAgent.ts` (StaticPermissionStrategy):
```typescript
const command = "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe C:/Users/jorda/.claude/skills/web-search/main.py text \"temperature today\" --max 5";

// Load patterns from db.json
const patterns = ["C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe C:/Users/jorda/.claude/skills/web-search/main.py text \"temperature today\" --max 5"];

// Check if command matches any pattern (prefix matching)
const allowed = patterns.some(pat => command.startsWith(pat));
// Result: true ✅
```

### Step 3: Tool Auto-Approves
```
✅ Pattern found in allowedPatterns
✅ Tool automatically approved
✅ No UI permission prompt shown
✅ Tool executes immediately
```

## Realistic Example: Multiple Patterns

After several "Always Allow" clicks:

```json
{
  "allowedPatterns": [
    "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe C:/Users/jorda/.claude/skills/web-search/main.py text \"temperature today\" --max 5",
    "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe C:/Users/jorda/.claude/skills/web-search/main.py text \"weather forecast\"",
    "npm run",
    "npm test",
    "git commit"
  ]
}
```

With this configuration:
- ✅ Web search for "temperature today" → auto-approved
- ✅ Web search for "weather forecast" → auto-approved
- ✅ `npm run lint` → auto-approved (matches "npm run")
- ✅ `npm run build` → auto-approved (matches "npm run")
- ✅ `npm test -- --watch` → auto-approved (matches "npm test")
- ✅ `git commit -am "fix"` → auto-approved (matches "git commit")
- ❌ `rm -rf /` → permission prompt (no match)

## Wildcard Pattern: Allow All Similar

If user clicks "Allow Similar" button:

```json
{
  "allowedPatterns": ["*"]
}
```

Then:
- ✅ ANY tool command → auto-approved
- ✅ No permission prompts ever (except first time)

## Manual Edit Example

You can manually edit `db.json` to add shorter patterns:

**Instead of:**
```json
"allowedPatterns": [
  "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe C:/Users/jorda/.claude/skills/web-search/main.py text \"temperature today\" --max 5",
  "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe C:/Users/jorda/.claude/skills/web-search/main.py text \"weather forecast\"",
  "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe C:/Users/jorda/.claude/skills/web-search/main.py text \"tomorrow\""
]
```

**Edit to:**
```json
"allowedPatterns": [
  "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe"
]
```

Now any web search command starting with that path will auto-approve! (prefix matching)

## Where in db.json

Your actual `db.json` file at:
```
c:\Users\jorda\Documents\workspace\devos\db.json
```

The `allowedPatterns` field is at the top level:
```json
{
  "workspaces": [...],
  "threads": [...],
  "messages": [...],
  "allowedPatterns": [
    "pattern1",
    "pattern2"
  ]
}
```

## How to Verify

### 1. Check Current Patterns
```bash
curl http://localhost:3000/api/allowedPatterns
```

Returns:
```json
[
  "npm run",
  "git commit"
]
```

### 2. Look at db.json Directly
```bash
cat db.json | jq '.allowedPatterns'
```

Output:
```json
[
  "npm run",
  "git commit"
]
```

### 3. Add Pattern Manually
```bash
curl -X POST http://localhost:3000/api/allowedPatterns \
  -H "Content-Type: application/json" \
  -d '{"pattern": "npm"}'
```

### 4. Remove Pattern
```bash
curl -X DELETE http://localhost:3000/api/allowedPatterns \
  -H "Content-Type: application/json" \
  -d '{"pattern": "npm"}'
```

## Full Flow Visualization

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Tool requests permission                                  │
│    Command: "C:/Users/.../python.exe ... text 'temp'"        │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│ 2. UI shows buttons                                          │
│    [Always Allow] [Allow] [Reject]                           │
└──────────────────────┬──────────────────────────────────────┘
                       │
                    User clicks
                   "Always Allow"
                       │
┌──────────────────────▼──────────────────────────────────────┐
│ 3. POST /api/threads/{id}/respond                            │
│    {optionId: "allow_always", toolCommand: "..."}            │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│ 4. Server: updateDb()                                        │
│    db.allowedPatterns.push(toolCommand)                      │
│    writeDb(db)  ← writes to db.json                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│ 5. db.json updated                                           │
│    "allowedPatterns": ["C:/Users/.../python.exe ..."]        │
└──────────────────────┬──────────────────────────────────────┘
                       │
                  ✅ SAVED!
                       │
        ┌──────────────────────────────┐
        │   Next Time Same Tool        │
        │   Is Called:                 │
        │                              │
        │ 1. Check allowedPatterns     │
        │ 2. Pattern found ✅           │
        │ 3. Auto-approve              │
        │ 4. No UI prompt              │
        │ 5. Execute immediately       │
        └──────────────────────────────┘
```

## Code Path

User clicks "Always Allow" → This code runs:

```typescript
// File: server.ts, line ~495
if (optionId === "allow_always" && toolCommand) {
  updateDb((db) => {
    // 1. Ensure field exists
    db.allowedPatterns = db.allowedPatterns || [];
    
    // 2. Add pattern if new
    if (!db.allowedPatterns.includes(toolCommand)) {
      db.allowedPatterns.push(toolCommand);  // ← ADDS TO ARRAY
    }
  });
}

// updateDb() calls:
// 1. readDb() ← read db.json from disk
// 2. fn(db)   ← run the callback above
// 3. writeDb(db) ← write updated db to disk
```

Result:
```
db.json on disk UPDATED ✅
allowedPatterns array INCLUDES new pattern ✅
```

## Next: Auto-Approval

When tool called again, this code runs:

```typescript
// File: claudeAgent.ts, line ~310
const command = update.rawInput?.command; // "C:/Users/.../python.exe..."

if (this.strategy.isAllowed(command)) {
  // Pattern matched ✅
  // No permission gate, execute immediately
  return;
}

// If we get here, permission needed
this.setState("awaiting_permission");
this.emit("permission", this.pendingTool);
```

## Summary

| Step | What Happens | Where |
|------|--------------|-------|
| User clicks "Always Allow" | Permission prompt disappears | UI |
| Server receives request | Reads optionId and toolCommand | `/api/threads/{id}/respond` |
| Pattern is saved | `db.allowedPatterns.push(toolCommand)` | `server.ts` line ~515 |
| db.json written to disk | File updated immediately | `writeDb()` |
| Next tool call | Pattern checked, auto-approved | `claudeAgent.ts` line ~310 |

**Result: Pattern permanently saved in db.json and reused automatically**
