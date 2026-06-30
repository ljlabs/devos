# Git Branch Management

Feature implementation for [Issue #10](https://github.com/ljlabs/devos/issues/10).

## Overview

Git branch management is now integrated into the workspace settings modal. When editing a workspace, users can view and manage Git branches, stashes, and repository status.

## Features

### 1. Current Branch Status
- Displays active branch name
- Shows "Dirty" indicator when uncommitted changes exist
- Shows ahead/behind counters relative to upstream (if tracked)

### 2. Git Status
- Lists modified, staged, and untracked files
- Shows first 10 files with "more..." indicator if needed

### 3. Branch Management
- List all local branches
- Current branch highlighted in green
- Click any branch to switch to it
- Instant feedback on branch changes

### 4. Stash Operations
- **Create**: Stash current changes with optional message
- **Apply**: Apply stash without removing it
- **Pop**: Apply stash and remove it
- **Drop**: Delete a stash without applying

## Usage

1. Open workspace settings (click settings icon on workspace)
2. Scroll to "Git Information" section
3. Choose operation:
   - Switch branch: Click desired branch name
   - Stash changes: Click "New Stash" button
   - Manage stashes: Hover over stash → Apply/Pop/Drop buttons

## API Endpoints

All Git operations are under `/api/workspaces/:workspaceId/git/`

### Info
- `GET /git/info` — Branch, status, ahead/behind

### Branches
- `GET /git/branches` — List all branches
- `POST /git/switch-branch` — Switch to branch (body: `{ branchName }`)

### Stashes
- `POST /git/stash` — Create stash (body: `{ message? }`)
- `GET /git/stashes` — List all stashes
- `POST /git/stash/apply` — Apply without removing (body: `{ stashId }`)
- `POST /git/stash/pop` — Apply and remove (body: `{ stashId }`)
- `DELETE /git/stash/:stashId` — Drop stash

## Implementation

**Server** (`server_src/git.ts`):
- Thin wrapper around `git` CLI via `child_process.exec`
- ~50 LOC per major function
- Error messages indicate git/repo issues

**UI** (`src/components/GitSection.tsx`):
- Conditional render (only on Edit, not Create)
- Real-time refresh after operations
- Graceful error handling for non-git repos

**Routes** (`server_src/server.ts`):
- 7 endpoints, all under workspace context
- Validates workspace exists before operations
- Logs all git commands via `logInfo()`

## Error Handling

**Not a Git Repository**
- Shows error banner when `.git` dir missing
- Gracefully degrades instead of crashing modal

**Command Failures**
- Network issues, file permissions, branch conflicts
- Returns descriptive error messages to UI
- User can retry after resolving issue

## Future Enhancements

- Commit history viewer
- Create/delete branch UI
- Merge/rebase operations
- Remote branch tracking
- Detailed diff viewer

## Testing

Manual testing recommended with real git repo. Test scenarios:
- Non-git directory (error handling)
- Switch branches
- Stash with/without message
- Apply/pop/drop stashes
- Dirty vs clean repos
- Repos with no upstream tracking
