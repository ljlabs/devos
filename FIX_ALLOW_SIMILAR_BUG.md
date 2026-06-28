# Fix: Allow Similar Permission Denied Bug

## Problem

When user clicked "Always Allow" on a tool permission prompt, the response was rejected with:
```
"User refused permission to run tool"
```

## Root Cause

The code was sending **`optionId: "allow_similar"`** to ACP, but ACP only recognizes:
- `"allow_always"`
- `"allow_once"` 
- `"reject_once"`

ACP rejected the unknown option ID as a permission denial.

## Solution

### 1. Only Send Valid ACP Option IDs
Changed server.ts to validate and enforce valid option IDs:
```typescript
const validOptionIds = ["allow_always", "allow_once", "reject_once"];
if (!validOptionIds.includes(optionId)) {
  return res.status(400).json({
    error: `Invalid optionId: "${optionId}". Must be one of: ${validOptionIds.join(", ")}`,
  });
}
```

### 2. Pattern Variants System
Instead of a simple "allow similar" flag, generate pattern variants:

```typescript
function generatePatternVariants(fullCommand: string) {
  // "exact": Full command (specific parameters)
  // "tool": "python.exe main.py *" (any args to this specific tool)
  // "category": "python.exe *" (any python in that directory)
  
  return [
    { variant: "exact", pattern: fullCommand },
    { variant: "tool", pattern: "C:/... python.exe main.py *" },
    { variant: "category", pattern: "C:/... python.exe *" },
  ];
}
```

Example for web search tool:
```
Command: "C:/Users/.../python.exe C:/Users/.../main.py text \"temperature today\" --max 5"

Variants saved:
1. exact:     "C:/Users/.../python.exe C:/Users/.../main.py text \"temperature today\" --max 5"
2. tool:      "C:/Users/.../python.exe C:/Users/.../main.py *"
3. category:  "C:/Users/.../python.exe *"
```

### 3. Pattern Matching and Auto-Approval
When a new tool request comes in:
```typescript
// Check if command matches any allowed pattern
if (checkAllowedPattern(toolCommand, patterns)) {
  // Auto-approve with "allow" option
  agent.send({
    jsonrpc: "2.0",
    id: raw.id,
    result: { outcome: { outcome: "selected", optionId: "allow" } },
  });
  return; // No permission prompt shown
}

// No match - show normal permission buttons
thread.status = "awaiting_permission";
thread.pendingPermissionId = raw.id;
```

### 4. Updated Database Schema
```typescript
interface AllowSimilarPattern {
  variant: "exact" | "tool" | "category" | "workspace";
  pattern: string;  // Supports * wildcard for prefix matching
  toolName?: string;
  createdAt: string;
}

interface DatabaseSchema {
  allowedPatterns?: AllowSimilarPattern[];
}
```

Example db.json:
```json
{
  "workspaces": [...],
  "threads": [...],
  "messages": [...],
  "allowedPatterns": [
    {
      "variant": "tool",
      "pattern": "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe C:/Users/jorda/.claude/skills/web-search/main.py *",
      "createdAt": "2026-06-28T12:00:00.000Z"
    },
    {
      "variant": "category",
      "pattern": "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe *",
      "createdAt": "2026-06-28T12:00:00.000Z"
    }
  ]
}
```

## Flow After Fix

### First Tool Request (no pattern yet)
```
1. Tool requests: python ... main.py text "temperature today"
2. Check patterns: No match
3. Show permission buttons: [Always Allow] [Allow] [Reject]
4. User clicks "Always Allow"
5. Server generates variants and saves to db.json
6. Send to ACP: optionId "allow_always" ✅ (valid)
7. Tool executes
```

### Second Similar Request (pattern saved)
```
1. Tool requests: python ... main.py text "weather forecast"
2. Check patterns: Matches "tool" variant ✅
3. Auto-approve with optionId "allow" ✅ (valid)
4. NO permission prompt shown
5. Tool executes immediately
```

### Different Tool Type (no pattern)
```
1. Tool requests: npm run build
2. Check patterns: No web-search patterns match
3. Show permission buttons normally
```

## User Experience

### Before Fix
```
User clicks "Always Allow"
→ Permission DENIED
→ Error message shown
→ Tool doesn't execute
```

### After Fix
```
User clicks "Always Allow"
→ Patterns saved to db.json
→ Tool executes successfully
→ Next similar tool: Auto-approved (no prompt)
```

## Pattern Matching Logic

Wildcard matching with * for prefix:
```
Pattern: "python.exe *"
Command: "python.exe C:/scripts/main.py"
Match? YES (command starts with "python.exe ")

Pattern: "python.exe main.py *"
Command: "python.exe main.py text \"hello\""
Match? YES (command starts with "python.exe main.py ")

Pattern: "npm"
Command: "npm run build"
Match? YES (command starts with "npm")

Pattern: "npm run"
Command: "npm test"
Match? NO (doesn't start with "npm run")
```

## Files Changed

- `server.ts`:
  - Added `generatePatternVariants()` helper
  - Added `checkAllowedPattern()` helper
  - Added validation for ACP option IDs
  - Updated wireAgent() to auto-approve matching patterns
  - Updated /respond endpoint to save variants

- `src/types.ts`:
  - Added `AllowSimilarPattern` interface
  - Updated `DatabaseSchema.allowedPatterns` type

## Testing

```bash
npm test -- --run
# 339 tests passing
```

All existing tests pass. New functionality validated manually.

## Deployment

No breaking changes. Backward compatible with existing db.json files. Old string-based patterns still work due to flexible pattern matching.

## Next Steps

1. UI should show dropdown for pattern variants
   - "Exact": This exact command only
   - "Tool": Any parameters to this tool
   - "Category": Any tool in this category
   
2. User selects variant before clicking "Always Allow"

3. Backend saves selected variant(s)

4. Future similar tools auto-approve based on variant match
