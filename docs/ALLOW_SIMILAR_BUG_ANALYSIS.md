# Allow Similar Permission System - Bug Analysis & Fix Plan

**Date**: June 29, 2026  
**Issue**: https://github.com/ljlabs/devos/issues/4  
**Status**: Diagnosed with comprehensive test plan

## The Bugs

### Bug 1: CLI Arguments Breaking Compound Command Checker
**Symptoms**: Python CLI commands with multiple arguments (e.g., `--max 10`, `text "query"`) are incorrectly flagged as compound commands because quote-tracking fails on escaped quotes or unusual quote patterns.

**Example**:
```
Pattern saved:    python.exe main.py *
Command 1:        python.exe main.py text "Google Workspace CLI..." --max 10
Command 2:        python.exe main.py text "gws google workspace..." --max 8
Expected:         Both auto-approved
Actual:           Command 2 prompts again (pattern doesn't match)
```

**Root Cause**: The quote-tracking logic in `findUnquotedOperator()` correctly handles paired quotes, but when a query string contains special characters or when arguments span multiple quoted sections, the logic may detect false operator positives. However, the REAL issue is that the normalization and prefix matching aren't being applied consistently.

### Bug 2: Path Backslash/Forward-Slash Normalization Inconsistency
**Symptoms**: Patterns saved with forward slashes don't reliably match incoming commands with backslashes (or vice versa).

**Root Cause**: Path normalization (`replace(/\\/g, "/")`) is applied, but there may be edge cases where:
- Patterns are stored in mixed format (some \, some /)
- Normalization doesn't account for case sensitivity on Windows

### Bug 3: Tool-Scoped Pattern Matching Gap
**Symptoms**: A pattern saved with `toolName="Bash"` may silently auto-approve requests when `toolName` is undefined (unknown tool).

**Root Cause**: The condition checks are using `&&` short-circuit logic that doesn't properly reject unknown toolNames.

## Current Implementation Analysis

### Quote Tracking Logic
The `findUnquotedOperator()` function correctly:
- Tracks double-quote pairs
- Tracks single-quote pairs
- Ignores operators inside either quote type
- Returns early if any unquoted operator found

**Potential Issue**: The logic assumes balanced quotes and may behave unexpectedly with:
- Escaped quotes (`\"` or `\'`) — treated as literal chars, which could cause quote-tracking to fall out of sync
- Newlines in quoted strings — shouldn't be a problem, but verify

### Compound Command Splitting
When a compound operator is detected, the code:
1. Tries exact full-string match against non-wildcard patterns (good safety feature)
2. Splits on unquoted operators
3. Checks that ALL sub-commands independently match patterns

**Issue**: Step 2's splitter mirrors the quote tracking but may diverge from Step 1 if quote handling differs.

### Tool-Scoped Matching
Current logic in `matchesSinglePattern()`:
```typescript
if (pattern.toolName) {
  if (!toolName || pattern.toolName !== toolName) continue;
}
```

This is CORRECT. If pattern has a toolName and incoming toolName doesn't match (or is undefined), skip this pattern. The loop continues to the next pattern.

**However**: The issue occurs when NO pattern skips — if the loop finishes without finding a match, it returns false. This is correct.

**Real Issue**: Looking at real patterns, we have MANY unscoped patterns (old-format with no toolName), so they match any tool. This may mask the bug.

## Test Cases Needed

### Test Category 1: CLI Arguments with Multiple Quoted Sections
- `python.exe main.py text "query 1" --max 10`
- `python.exe main.py text "query 2" --max 8`
- Pattern: `python.exe main.py *`
- Expected: Both auto-approved

### Test Category 2: Operators Inside Quoted Arguments
- Pipes in query: `echo "foo | bar"`
- Semicolons in query: `echo 'step1; step2'`
- Expected: Not split into sub-commands

### Test Category 3: Path Normalization Edge Cases
- Windows: `C:\Users\jorda\file.txt` → normalized to `C:/Users/jorda/file.txt`
- Mixed: Pattern has `/`, command has `\` (or vice versa)
- Expected: All normalized, then matched

### Test Category 4: Tool-Scoped Strict Matching
- Pattern: `npm run *` with `toolName="Bash"`
- Command: `npm run build` with `toolName=undefined`
- Expected: NOT auto-approved (fail safe)

## Implementation Plan

1. **Add comprehensive regression tests** for all four categories (see below)
2. **Verify quote-tracking logic** handles all edge cases (escaped quotes, newlines, etc.)
3. **Add explicit assertion tests** for what should NOT happen
4. **Run full test suite** to ensure no regressions
5. **Document the fix** in code comments

## Files to Modify

- `server_src/server.ts` — May need minor adjustments to `findUnquotedOperator()` or `splitOnUnquotedOperators()`
- `server_src/server.test.ts` — Add comprehensive test cases for all scenarios

## What Should NOT Change

- The core security model (all sub-commands must match)
- The tool-scoped matching (patterns with toolName must be strictly matched)
- The exact-before-split safety check (full compound patterns must be checked before splitting)
