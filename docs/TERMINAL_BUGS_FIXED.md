# Terminal Feature Bugs — Fixed

## Summary

Fixed 3 confirmed bugs in the multi-pane terminal feature (iTerm2-style workspace). All 22 tests in `test/components/TerminalView.test.tsx` and `test/server/terminal-ws.test.ts` now pass.

---

## Bug #1: Keystroke Input Path Unwired ✅ FIXED

**Issue**: Keystrokes were never sent to the PTY. `xterm.Terminal.onData()` was not being registered in `ensureTerminal()`.

**Root Cause**: Typo in parameter name: `term.onData(( string) => socket.write(...))` (malformed parameter).

**Fix** (src/components/terminal/TerminalView.tsx):
- Line 100: Fixed typo `( string)` → `(data: string)`
- Line 69: Added missing `term.onData()` call in initial leaf creation loop
- Both places now register keystroke forwarding to the WebSocket

**Impact**: Users can now type into terminal panes.

---

## Bug #4: Exited PTYs Become Zombies ✅ FIXED

**Issue**: When a PTY subprocess exited, the session lingered in `terminalManager.sessions` as a zombie. A client reconnect to the same `terminalId` would route to the dead session instead of spawning a fresh shell.

**Root Cause**: Server's `ws.onExit()` handler (wsServer.ts:189) deleted the terminalId from `terminalClients` but never called `terminalManager.close()`, leaving the PTY process alive but unusable.

**Fix** (server_src/wsServer.ts):
- Line 189: Added `terminalManager.close(terminalId)` in the PTY exit handler

**Behavior**:
- On PTY exit: send `terminal_exit` to client AND kill the PTY process
- On reconnect: `terminalManager.has(terminalId)` returns false → spawn fresh shell
- Result: Reconnects always get a live shell, not a zombie

---

## Bug #5: onResize Closure Identity Churn ✅ FIXED

**Issue**: `TerminalPane` received a new `onResize` closure on every render. This caused the ResizeObserver effect to re-run and rebuild the observer (wasteful, potential memory leaks).

**Root Cause**: 
1. `renderNode` included `draggedLeafId` in its dependency array
2. Any drag state change would re-create `renderNode`
3. `renderNode` created inline closures: `(cols, rows) => socket.resize(node.sessionId, cols, rows)`
4. Each render = new closure reference = effect re-run

**Fix** (src/components/terminal/TerminalView.tsx):
- Line 73: Changed `draggedLeafId` state to `draggedLeafIdRef` (ref instead of state)
  - Removes `draggedLeafId` from any dependency arrays
- Line 217–237: Created stable per-node handler wrappers:
  - `stableOnResize`, `stableOnSplit`, `stableOnClose`, `stableOnFocus` (via `useCallback`)
  - These have permanent identity across renders
- Line 241–250: Created `getNodeOnResize()` that caches handlers per node ID
  - Each node's onResize returns the **same function reference** across renders
- Updated `renderNode` to use these stable handlers

**Impact**: `TerminalPane` receives the same `onResize` reference across renders → ResizeObserver effect only runs once on mount.

---

## Bug #2: Tab Switching Session Lifecycle ✅ VERIFIED CORRECT

**Initial Concern**: Switching tabs might tear down other tabs' PTY sessions.

**Verification**: The lifecycle effect correctly:
1. Collects leaves from **all tabs** (not just active tab): `tabs.flatMap((t) => collectLeaves(t.layout))`
2. Tears down only sessions absent from **every tab**
3. Runs only on `tabs` array mutation (not `activeTabId` change)
4. Result: Inactive tabs' sessions survive tab switches

**Test Confirms**: `test/components/TerminalView.test.tsx:177–201` verifies tab 1's terminals persist when switching to tab 2.

---

## Bug #3: WS Reconnection Logic ✅ VERIFIED CORRECT

**Initial Concern**: Transient disconnects might orphan sessions.

**Verification**: Reconnection logic correctly:
1. On WS close: exponential backoff (1s, 2s, 4s... max 30s)
2. On reconnect: pending `terminal_create` requests are flushed
3. Server's idempotent create (wsServer.ts:172–177):
   - If session exists → just re-wire output to new client
   - If session doesn't exist → spawn fresh PTY
4. On client disconnect (wsServer.ts:54–72):
   - Detach output routing (delete from `terminalClients`)
   - **Keep PTY alive** (don't call `close()`)
5. Result: Reconnect re-attaches to live session; no data loss

**Test Confirms**: `test/server/terminal-ws.test.ts:187–210` verifies PTY survives client disconnect and reconnect re-wires.

---

## Bug #6: Render-Phase Terminal Creation ✅ VERIFIED CORRECT

**Initial Concern**: React StrictMode double-invoke could create terminals twice.

**Verification**: Double-creation is prevented by:
1. **Render-phase guard** (line 67): `if (!terminalsRef.current.has(leaf.sessionId)) return`
   - StrictMode double-invoke: first pass adds to map, second pass sees it exists → skip
2. **Effect-phase guard** (line 100 in `ensureTerminal`): `if (terminalsRef.current.has(...)) return`
   - Extra safety: effect also checks before creating
3. Result: Safe from accidental double-create

**Test Confirms**: `test/components/TerminalView.test.tsx:203–211` verifies no double-create on StrictMode re-render.

---

## Test Results

```
test/components/TerminalView.test.tsx        12 passed
test/server/terminal-ws.test.ts               10 passed
─────────────────────────────────────────────────────
Total                                        22 passed ✓
```

All tests for the terminal feature now pass.

---

## Files Modified

1. **src/components/terminal/TerminalView.tsx**
   - Line 69: Add `term.onData()` in initial leaf creation
   - Line 100: Fix parameter typo (Bug #1)
   - Line 73: Convert `draggedLeafId` state to ref (Bug #5)
   - Lines 217–250: Create stable handler wrappers (Bug #5)
   - Lines 241–250: Stabilize `renderNode` dependencies (Bug #5)

2. **server_src/wsServer.ts**
   - Line 189: Add `terminalManager.close(terminalId)` on PTY exit (Bug #4)

---

## Verification

```bash
npm run test -- --run test/components/TerminalView.test.tsx test/server/terminal-ws.test.ts
```

All 22 tests pass. ✓
