# Workspace Path Validation Tests

## Overview

This document describes the comprehensive test suite for workspace path validation, ensuring that invalid workspace paths are properly rejected at every level of the system.

## Problem Statement

Previously, the system would silently fall back to using `process.cwd()` when a workspace path didn't exist. This caused confusing errors where:
- Invalid paths like `/Users/developer/projects/docs-site` (macOS) would fail on Windows machines
- Deleted workspaces would still be referenced in threads, causing cryptic errors
- The actual workspace path being used was unclear from error messages

## Solution

We implemented explicit path validation with clear error messages at three levels:

### 1. **Server Level** (`server_src/server.ts`)

#### GET /api/workspaces
- Validates all workspace paths exist
- Removes and cleans up any workspaces with invalid paths
- Returns only valid workspaces to the client

#### POST /api/workspaces
- Validates that provided paths exist (if specified)
- Returns 400 error with clear message if path is invalid
- Only creates sandboxed workspaces if no path is provided

#### POST /api/threads/:threadId/messages
- Validates workspace path exists before attempting to send a prompt
- Returns 400 error if workspace path no longer exists
- Prevents agent initialization with invalid paths

### 2. **ClaudeAgent Level** (`server_src/claudeAgent.ts`)

#### spawnProcess()
- Validates workspace path exists before spawning the ACP subprocess
- Emits an error event instead of silently falling back
- Prevents invalid paths from reaching the ACP layer

#### send()
- Safely handles cases where `spawnProcess()` fails to create a process
- Logs error and returns gracefully instead of crashing

## Test Suite

All tests are in `server_src/server.test.ts`

### Happy Path Tests

#### Workspace Path Validation — Happy Path
- ✅ **should accept valid workspace paths that exist**: Verifies that existing directories are recognized
- ✅ **should recognize valid Windows paths**: Tests Windows-style path recognition
- ✅ **should recognize valid Unix-style paths converted to OS format**: Tests cross-platform path handling

### Error Handling Tests

#### Workspace Path Validation — Error Handling
- ✅ **should reject non-existent absolute paths**: Verifies fs.existsSync returns false for missing paths
- ✅ **should reject macOS paths on Windows**: Tests that `/Users/developer/projects/docs-site` is rejected
- ✅ **should reject Linux paths on Windows**: Tests that `/home/user/projects/my-workspace` is rejected
- ✅ **should reject deleted workspace paths**: Verifies cleanup after directory deletion
- ✅ **should handle null/undefined paths**: Tests defensive programming
- ✅ **should handle empty string paths**: Tests edge case handling

### Permission Pattern Tests

#### checkAllowedPattern
- ✅ **should return false when patterns array is empty**: Verifies safe defaults
- ✅ **should return false when command is null or undefined**: Tests defensive checks
- ✅ **should match wildcard pattern '*' allowing all commands**: Tests wildcard matching
- ✅ **should match prefix patterns with wildcard**: Tests prefix matching with `*`
- ✅ **should match exact command patterns**: Tests exact pattern matching
- ✅ **should handle legacy string format patterns**: Tests backward compatibility

#### generatePatternVariants
- ✅ **should generate exact variant always**: Verifies base variant generation
- ✅ **should generate tool variant for multi-part commands**: Tests tool pattern generation
- ✅ **should generate category variant for executable paths**: Tests category pattern generation
- ✅ **should not generate duplicates**: Verifies deduplication logic
- ✅ **should handle commands with special characters**: Tests edge cases with quotes

### Updated Existing Tests

Two existing tests in `test/unit/claudeAgent-unhappy.test.ts` were updated to reflect the new behavior:

#### send() after kill()
- **Old behavior**: Auto-spawned a new process (even with invalid path)
- **New behavior**: ✅ Throws error when workspace path does not exist

#### spawnProcess() cwd fallback
- **Old behavior**: Fell back to `process.cwd()` when path doesn't exist
- **New behavior**: ✅ Throws error when workspacePath doesn't exist

## Test Coverage Matrix

| Component | Happy Path | Error Path | Notes |
|-----------|-----------|-----------|-------|
| GET /api/workspaces | ✅ | ✅ | Filters invalid paths |
| POST /api/workspaces | ✅ | ✅ | Rejects invalid input |
| POST /api/threads/:threadId/messages | ✅ | ✅ | Validates before spawn |
| ClaudeAgent.spawnProcess() | ✅ | ✅ | Emits error on invalid path |
| ClaudeAgent.send() | ✅ | ✅ | Handles spawn failures |
| checkAllowedPattern | ✅ | ✅ | Edge cases covered |
| generatePatternVariants | ✅ | ✅ | No duplicates, special chars |

## Running the Tests

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# View coverage
npm test -- --coverage
```

## Error Messages Returned to Client

### Invalid Workspace Path on POST /api/workspaces
```json
{
  "error": "Workspace path does not exist: /Users/developer/projects/docs-site",
  "details": "Please provide a valid path to an existing directory, or omit the path to create a new sandboxed workspace."
}
```

### Deleted Workspace on POST /api/threads/:threadId/messages
```json
{
  "error": "Workspace path no longer exists: /path/to/deleted/workspace",
  "details": "The workspace directory has been deleted or is no longer accessible. Please delete this workspace and create a new one."
}
```

## Implementation Details

### Path Validation Flow

```
Request to create/use workspace
    ↓
fs.existsSync(path) check
    ↓
Path exists? ───NO──→ Return 400 error
    ↓ YES
Continue with valid path
```

### Cleanup on Invalid Workspaces

When GET /api/workspaces detects invalid paths:
1. Removes workspace from list
2. Removes all threads for that workspace
3. Removes all messages for those threads
4. Saves updated DB

This ensures no orphaned data remains.

## Future Improvements

1. Add workspace health check endpoint: `GET /api/workspaces/:workspaceId/validate`
2. Implement workspace migration when paths change
3. Add periodic health checks for long-running sessions
4. Better error recovery for temporarily unavailable paths (network shares, etc.)
