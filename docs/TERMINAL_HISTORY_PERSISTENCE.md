# Terminal History Persistence on Page Refresh

## Problem

When a user refreshes the page while running the terminal:
- The browser clears React state (all tabs and terminals)
- New layout is restored from `sessionStorage` with the same session IDs
- But the xterm Terminal instances are fresh (no buffer)
- So the previous output is lost

## Solution

### Server-Side: History Recording

**File**: `server_src/terminal.ts`

Each `TerminalSession` now maintains a **ring buffer** of the last 100 lines of output:

```typescript
interface TerminalSession {
  outputHistory: string[];      // Ring buffer of recent output chunks
  historyIndex: number;         // Current write position in the ring
}
```

When PTY data arrives (`onData`), it's recorded:
```typescript
terminalManager.recordOutput(terminalId, data);
```

The `recordOutput` method maintains the ring buffer (oldest data is overwritten when buffer is full).

### Protocol Change

**Message**: `terminal_created`

When a client reconnects to an existing session, the `terminal_created` response now includes history:

```json
{
  "type": "terminal_created",
  "terminalId": "pane-abc123",
  "history": [
    "$ ls\n",
    "file1.txt  file2.txt\n",
    "$ "
  ]
}
```

**Note**: History is only sent on reconnect (existing session). New sessions don't send history.

### Client-Side: History Replay

**File**: `src/hooks/useTerminalSocket.ts`

Added `onHistory` listener interface:
```typescript
onHistory: (sessionId: string, listener: HistoryListener) => () => void;
```

The hook now handles `terminal_created` with history and calls all registered listeners.

**File**: `src/components/terminal/TerminalView.tsx`

After creating each terminal, a history listener is registered:
```typescript
socket.onHistory(sessionId, (history) => {
  for (const chunk of history) {
    terminal.write(chunk);  // Replay into xterm buffer
  }
});
```

This is done in an effect (after initial render) so it doesn't block render-phase code.

## Files Modified

1. **server_src/terminal.ts**
   - Added `outputHistory` and `historyIndex` to `TerminalSession`
   - Added `recordOutput(id, data)` method
   - Added `getHistory(id)` method returning chronological array

2. **server_src/wsServer.ts**
   - Line ~247: Call `terminalManager.recordOutput()` on PTY onData
   - Line ~232: Send `history` array in `terminal_created` response on reconnect

3. **src/hooks/useTerminalSocket.ts**
   - Added `HistoryListener` type
   - Added `historyListeners` map
   - Added `onHistory` method to API
   - Handle `terminal_created` messages with history

4. **src/components/terminal/TerminalView.tsx**
   - Added history replay effect that wires `onHistory` listeners for all terminals
   - Replays history chunks into xterm buffer on reconnect

5. **test/server/terminal-ws.test.ts**
   - Added test: "replays terminal history on reconnect so buffer is restored"

6. **test/components/TerminalView.test.tsx**
   - Updated mock socket to include `onHistory` method
   - Updated beforeEach to clear/reset the mock

## Behavior

### First Session
1. User opens terminal, types commands
2. Server records each output chunk to the ring buffer
3. User refreshes page

### After Refresh
1. TerminalView restores layout from `sessionStorage` with same session IDs
2. Client sends `terminal_create` for each session ID
3. Server sees session already exists (PTY is still running)
4. Server responds with `terminal_created` + `history` array
5. Client writes history chunks to xterm buffer in order
6. New PTY output arrives and is appended (seamlessly continues from history)

## Ring Buffer Design

- **Size**: Last ~100 output chunks (not lines, to handle multi-line chunks)
- **Insertion order**: When buffer is full, new data overwrites oldest
- **Retrieval**: `getHistory()` returns array in chronological order (oldest first)

This ensures:
- Memory-bounded (always ~100 chunks)
- Fast append (O(1) per data arrival)
- Accurate replay (chronological order preserved)

## Test Coverage

**Test**: "replays terminal history on reconnect so buffer is restored"

Verifies:
1. PTY outputs 3 chunks to the server
2. Client disconnects (page refresh)
3. Client reconnects with same terminal ID
4. `terminal_created` message includes all 3 history chunks
5. Chunks are in correct order

**Result**: ✓ All 22 tests pass (12 TerminalView + 10 terminal-ws)
