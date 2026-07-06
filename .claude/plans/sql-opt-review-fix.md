# SQL Optimization Review Fixes

## Goal
Add comprehensive unit tests for all new targeted SQL methods, fix the `AllowSimilarPattern.variant` type mismatch, index the chunk lookup, and fix the optimistic thread 404 window.

---

## Task 1: Unit tests for `SqliteDb` targeted methods

**File:** `server_src/db.sqlite.test.ts` (extend existing file)

Add new `describe` blocks that test every new targeted method using real SQLite with a dedicated test DB:

- **`runInTransaction`** — verify atomicity: if callback throws, neither insert nor update applies
- **`getWorkspaceById`** — returns correct workspace or `undefined`
- **`insertWorkspace`** — inserts and retrieves; duplicate id throws
- **`updateWorkspaceName`** — updates name; returns updated row; no-op for missing id
- **`getThreadById`** — returns parsed Thread with JSON fields; returns `undefined` for missing
- **`getThreadsByWorkspace`** — returns only threads for that workspace; empty array for unknown workspace
- **`insertThread`** — inserts all fields including JSON-serialized `pendingPermissionOptions`; nullable fields stored/retrieved correctly
- **`updateThread`** — partial update: only specified fields change; `id` and `workspaceId` are immutable; `pendingPermissionOptions` JSON round-trips; empty fields object is no-op
- **`updateThreadStatus`** — updates only `status` field
- **`getMessagesByThread`** — returns messages in timestamp ASC order; raw is JSON-parsed; type maps to `undefined` when null
- **`insertMessage`** — inserts message; raw is JSON-stringified; type null maps to null
- **`getMessageByThreadAndMessageId`** — finds by `json_extract(raw, '$.params.update.messageId')`; returns most recent (timestamp DESC); returns `undefined` when no match
- **`updateMessageRaw`** — overwrites `raw` field; raw round-trips through JSON
- **`getAllowedPatterns`** — returns all patterns; `toolName` null maps to `undefined`
- **`insertAllowedPattern`** — inserts and retrieves; `id` generated server-side
- **`deleteAllowedPattern`** — deletes by pattern+toolName; `toolName=undefined` only matches NULL toolName; returns boolean
- **Cascade deletes** — deleting a workspace cascades to its threads and messages

---

## Task 2: Align `AllowSimilarPattern.variant` type

**Files:** `src/types.ts`, `server_src/server.ts`, `src/components/Dialogs.tsx`

Actual variants used in the codebase:
- Original union: `"exact" | "tool" | "category" | "workspace"`
- Additional values inserted by server: `"execute"`, `"write"`, `"edit"`, `"wildcard"`

**Fix:** Widen the `variant` type to:
```ts
variant: "exact" | "tool" | "category" | "workspace" | "wildcard" | "execute" | "write" | "edit";
```

This eliminates the `as any` casts at:
- `server_src/server.ts` — `kind as any` → remove the cast (line ~1207)
- `server_src/server.ts` — `kind as any` → remove the cast (line ~1335)

---

## Task 3: Index the chunk lookup

**File:** `server_src/db.sqlite.ts`

Add a generated column + index in `initializeSchema()`:

```sql
-- Virtual column extracting messageId from the JSON raw field
-- Used by getMessageByThreadAndMessageId for O(log n) lookups
ALTER TABLE messages ADD COLUMN messageId TEXT GENERATED ALWAYS AS (
  json_extract(raw, '$.params.update.messageId')
) VIRTUAL;
CREATE INDEX IF NOT EXISTS idx_messages_threadId_messageId ON messages(threadId, messageId);
```

Since the table already exists in production, this is handled by `IF NOT EXISTS`-style migration. For better-sqlite3 we can use `db.exec()` with the ALTER TABLE — if the column already exists it will throw, which we catch silently.

Also update `getMessageByThreadAndMessageId` to use the indexed column directly instead of `json_extract`:
```sql
SELECT * FROM messages WHERE threadId = ? AND messageId = ? ORDER BY timestamp DESC LIMIT 1
```

---

## Task 4: Fix optimistic thread 404 window

**File:** `src/App.tsx`

**Problem:** After creating a temp thread and navigating to it, ChatPage mounts and hits `/api/threads/<tempId>` → 404. WS subscribes to a non-existent thread. If the user sends a message in this window, the WS handler returns "thread not found".

**Fix:** After creating the optimistic thread, **don't navigate until the server responds**. Instead, keep the user on the workspace list and create the thread silently. Only navigate after the real thread ID arrives.

Updated flow:
1. Create thread optimistically (show a loading indicator in the thread list or a skeleton thread).
2. POST to server.
3. On success: replace temp thread with real one, navigate to real thread.
4. On failure: remove temp thread, stay on workspace list.

This eliminates the 404 window entirely. The thread appears in the list immediately (optimistic), and navigation only happens once the real ID exists.

**Tests:** Add unit tests for the optimistic creation flow in a new test file `test/frontend/handleCreateThreadQuick.test.ts` (or extend existing frontend tests):
- Temp thread is added to state immediately
- On success: temp thread replaced with real, navigate called with real ID
- On failure: temp thread removed, navigate called back to workspace list
- On network error: temp thread removed, navigate called back to workspace list

---

## Task 5: Integration tests for migrated server routes

**File:** `server_src/server.test.ts` (extend existing real-app test)

Add integration tests for the routes that exercise the new SQL code paths:

- **Thread CRUD:** POST /api/workspaces/:id/threads → GET /api/threads/:id → PATCH /api/threads/:id → DELETE /api/threads/:id
- **Messages:** POST /api/threads/:id/messages (creates user msg + sets status=thinking)
- **Messages list:** GET /api/threads/:id/messages returns thread's messages
- **Single thread:** GET /api/threads/:id returns correct thread
- **Cancel:** POST /api/threads/:id/cancel (with and without active session)
- **Workspace cascade delete:** DELETE /api/workspaces/:id removes workspace + threads + messages

---

## Execution order

1. Task 2 (type fix) — trivial, do first
2. Task 3 (chunk index) — db schema change
3. Task 1 (unit tests for targeted methods) — depends on tasks 2+3 for schema correctness
4. Task 4 (optimistic UI fix + tests)
5. Task 5 (integration tests)
6. Run full test suite, verify all pass
