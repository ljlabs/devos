# Permission System Bug - Diagnostic Prompt for Claude Chat

## The Problem

**Status**: Patterns ARE being saved successfully, but they're NOT being matched during permission checks.

**Observed Behavior**:
1. User saves pattern: `C:/Users/jorda/Documents/workspace/brainstorm/venv/Scripts/python.exe C:/Users/jorda/Documents/workspace/brainstorm/.claude/skills/web-search/main.py *`
2. Pattern appears in DB (visible in GET /api/allowedPatterns response)
3. Next command: `C:/Users/jorda/Documents/workspace/brainstorm/venv/Scripts/python.exe C:/Users/jorda/Documents/workspace/brainstorm/.claude/skills/web-search/main.py text "next expected heatwave in California June July 2026"`
4. **Expected**: Auto-approved (pattern matches)
5. **Actual**: Still prompts for permission (`[PERMISSION REQUIRED] No pattern match for tool, awaiting user input`)

## Key Evidence from Logs

### Saved Pattern
```json
{
  "pattern": "C:/Users/jorda/Documents/workspace/brainstorm/venv/Scripts/python.exe C:/Users/jorda/Documents/workspace/brainstorm/.claude/skills/web-search/main.py *",
  "toolName": "Bash",
  "variant": "execute",
  "createdAt": "2026-06-29T16:57:07.419Z"
}
```

### Incoming Command (from session/request_permission)
```
Command: C:/Users/jorda/Documents/workspace/brainstorm/venv/Scripts/python.exe C:/Users/jorda/Documents/workspace/brainstorm/.claude/skills/web-search/main.py text "next expected heatwave in California June July 2026"
ToolName: Bash
```

### Server Log
```
[server:thread-1782752174193] [PERMISSION REQUIRED] No pattern match for tool, awaiting user input
```

## Current Implementation (server_src/server.ts)

### checkAllowedPattern function
```typescript
function checkAllowedPattern(command: string, toolName: string | undefined, patterns: any[]): boolean {
  if (!patterns || patterns.length === 0) return false;
  if (!command || typeof command !== "string") return false;

  // Normalise path separators once
  const normCommand = command.replace(/\\/g, "/");

  // Detect compound operators OUTSIDE of quoted strings
  function findUnquotedOperator(s: string): boolean {
    let inDouble = false;
    let inSingle = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"' && !inSingle) { inDouble = !inDouble; continue; }
      if (c === "'" && !inDouble) { inSingle = !inSingle; continue; }
      if (inDouble || inSingle) continue;
      // Outside quotes — check for operators
      if (c === "&" && s[i + 1] === "&") return true;
      if (c === "|") return true;  // covers both | and ||
      if (c === ";") return true;
    }
    return false;
  }

  if (!findUnquotedOperator(normCommand)) {
    return matchesSinglePattern(normCommand, toolName, patterns);
  }

  // ... handles compound commands ...
  // Split on unquoted compound operators and check each part
}

function matchesSinglePattern(normCommand: string, toolName: string | undefined, patterns: any[]): boolean {
  for (const pattern of patterns) {
    const pat: string = (pattern.pattern || pattern);

    // Tool-scoped pattern: only match when the tool is known and matches
    if (pattern.toolName) {
      // If incoming toolName is unknown or mismatched, do not auto-approve
      if (!toolName || pattern.toolName !== toolName) continue;
    }

    const normPat = pat.replace(/\\\\/g, "/");  // <-- NOTE: Uses double backslash

    // "*" matches everything
    if (normPat === "*") return true;

    // Pattern ending with * → prefix match
    if (normPat.endsWith("*")) {
      const prefix = normPat.slice(0, -1);
      if (normCommand.startsWith(prefix)) return true;
    } else {
      // Exact match
      if (normCommand === normPat) return true;
    }
  }

  return false;
}
```

### How it's called (in wireAgent)
```typescript
if (raw.method === "session/request_permission") {
  const rawInput = raw.params?.toolCall?.rawInput ?? {};
  const toolCommand: string = rawInput.command ?? rawInput.file_path ?? rawInput.path ?? "";
  const toolName: string | undefined =
    raw.params?.toolCall?._meta?.claudeCode?.toolName ??
    raw.params?._meta?.claudeCode?.toolName ??
    (typeof raw.params?.toolCall?.title === "string"
      ? raw.params.toolCall.title.split(/\s+/)[0]
      : undefined);
  const patterns = readDb().allowedPatterns || [];

  if (toolCommand && checkAllowedPattern(toolCommand, toolName, patterns)) {
    // Auto-approve
    logInfo("server", `[AUTO-APPROVE] Pattern matched: "${toolCommand}" (tool=${toolName ?? "unknown"})`, threadId);
    // ... send allow response ...
  }
}
```

## The Bug - Likely Root Cause

**Inconsistent backslash normalization**:

In `checkAllowedPattern()`, line 690:
```typescript
const normCommand = command.replace(/\\/g, "/");  // Single backslash in regex
```

In `matchesSinglePattern()`, line 653:
```typescript
const normPat = pat.replace(/\\\\/g, "/");  // Double backslash in regex
```

**The Problem**: 
- `checkAllowedPattern()` correctly uses `/\\/g` to replace single backslashes
- `matchesSinglePattern()` incorrectly uses `/\\\\/g` which ONLY matches TWO consecutive backslashes
- If the pattern is stored with single backslashes (e.g., from Windows path), the regex in `matchesSinglePattern()` won't normalize them

**Example**:
- Pattern stored as: `C:\Users\jorda\...\main.py *` (single backslashes)
- Regex `/\\\\/g` tries to match `\\` (double backslash) but the pattern has single backslashes
- Result: Pattern is NOT normalized
- Command comes in already normalized to forward slashes
- Prefix comparison fails: `C:/Users/.../main.py text ...` does NOT start with `C:\Users\...\main.py ` (mixed separators)

## Test Case (Unit Test - Currently Passes but May Reveal Issue)

```typescript
it("reproduces the California heatwave bug: pattern with wildcard should match multipart CLI args", () => {
  const pythonExe = "C:/Users/jorda/Documents/workspace/brainstorm/venv/Scripts/python.exe";
  const mainPy = "C:/Users/jorda/Documents/workspace/brainstorm/.claude/skills/web-search/main.py";
  
  const patterns = [
    {
      pattern: `${pythonExe} ${mainPy} *`,
      toolName: "Bash",
      variant: "execute",
      createdAt: "2026-06-29T16:57:07.419Z"
    }
  ];
  
  // This command SHOULD match the pattern
  const command = `${pythonExe} ${mainPy} text "next expected heatwave in California June July 2026"`;
  
  expect(checkAllowedPattern(command, "Bash", patterns)).toBe(true);
});

it("pattern stored with backslashes should normalize and match forward-slash command", () => {
  const pythonExe = "C:\\Users\\jorda\\Documents\\workspace\\brainstorm\\venv\\Scripts\\python.exe";
  const mainPy = "C:\\Users\\jorda\\Documents\\workspace\\brainstorm\\.claude\\skills\\web-search\\main.py";
  
  const patterns = [
    {
      pattern: `${pythonExe} ${mainPy} *`,  // Stored with backslashes!
      toolName: "Bash",
      variant: "execute"
    }
  ];
  
  // Command arrives with forward slashes from ACP
  const command = "C:/Users/jorda/Documents/workspace/brainstorm/venv/Scripts/python.exe C:/Users/jorda/Documents/workspace/brainstorm/.claude/skills/web-search/main.py text \"query\"";
  
  // This should still match after normalization
  expect(checkAllowedPattern(command, "Bash", patterns)).toBe(true);
});
```

## Questions for Diagnosis

1. **Is the backslash regex the issue?** The `matchesSinglePattern()` function uses `/\\\\/g` instead of `/\\/g`. This would ONLY catch double backslashes, not single ones.

2. **Are patterns being stored with backslashes?** Check if patterns in the DB have `\` or `/` as separators.

3. **Is there a mismatch between storage and matching?** One path might normalize on store, the other on match.

## Next Steps

1. Change line 653 in `server_src/server.ts` from:
   ```typescript
   const normPat = pat.replace(/\\\\/g, "/");
   ```
   to:
   ```typescript
   const normPat = pat.replace(/\\/g, "/");
   ```

2. Add explicit logging to see what's being compared:
   ```typescript
   logInfo("server", `Pattern matching: "${normCommand}" vs prefix "${prefix}" (pattern="${pat}")`, threadId);
   ```

3. Run the full test suite to verify the fix doesn't break other cases.
