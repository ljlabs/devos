# Wish List Features Plan

Three features from `documents/feature_wish_list.md`.

---

## Feature 1: Rename a Thread

### Backend
- Add `PATCH /api/threads/:threadId` route in `server.ts`
  - Accepts `{ title: string }`, updates `thread.title` in db.json, returns updated thread

### Frontend
- `App.tsx`: Add `handleRenameThread(threadId, newTitle)` that PATCHes the API and updates local state
- `ThreadList.tsx`: Add props `onRenameThread(threadId, title)` and a small edit icon (pencil) on hover for each thread card. Clicking the icon makes the title an inline editable `<input>` — press Enter to save, Escape to cancel

### Tests
- PATCH route returns 404 for nonexistent thread
- PATCH route updates thread title in db.json
- Rename UI shows input on icon click, saves on Enter, cancels on Escape

---

## Feature 2: Skip Modal on Thread Creation

### Frontend
- `App.tsx`: Add `handleCreateThreadQuick()` that POSTs to the API with `{ title: "Untitled" }` directly (no modal), sets the new thread as active, and adds a log entry
- `ThreadList.tsx`: "New Thread" button calls `onOpenNewThread()` — wire this to `handleCreateThreadQuick` instead of `setShowNewThread(true)`
- Remove `NewThreadModal` from `App.tsx` render and the related state (`showNewThread`, `newThreadTitle`, `setNewThreadTitle`, `setShowNewThread`)
- Remove `NewThreadModal` import from `App.tsx` (keep `NewWorkspaceModal`)

### Tests
- Clicking "New Thread" creates a thread immediately without showing a modal
- Thread appears in the list with "Untitled" title
- ACP later renames it via `session_info_update`

---

## Feature 3: Delete Workspaces and Threads

### Backend
- Add `DELETE /api/threads/:threadId` route in `server.ts`:
  - Remove thread from `db.threads`
  - Remove all messages with matching `threadId` from `db.messages`
  - Call `ClaudeAgent.removeInstance(threadId)` to kill the subprocess
  - Return `{ ok: true }`
- Add `DELETE /api/workspaces/:workspaceId` route in `server.ts`:
  - Find all thread IDs belonging to this workspace
  - Remove those threads and their messages (reuse thread deletion logic)
  - Kill any associated ClaudeAgent instances
  - Remove workspace from `db.workspaces`
  - Return `{ ok: true }`

### Frontend
- `App.tsx`:
  - `handleDeleteThread(threadId)`: DELETE API, remove from local state, if it was active switch to another thread
  - `handleDeleteWorkspace(workspaceId)`: DELETE API, remove from local state, if it was active switch to another workspace
- `ThreadList.tsx`: Add a delete icon (Trash2 from lucide) on hover for each thread card, calls `onDeleteThread(id)` prop
- `WorkspaceSidebar.tsx`: Add a delete icon (Trash2 from lucide) on hover for each workspace item, calls `onDeleteWorkspace(id)` prop. Both delete actions should have a simple `window.confirm()` guard

### Tests
- DELETE thread removes thread, its messages, and kills agent subprocess
- DELETE workspace removes workspace, all its threads, and all their messages
- UI removes deleted items from state and switches active selection
- Confirm dialog prevents accidental deletion
