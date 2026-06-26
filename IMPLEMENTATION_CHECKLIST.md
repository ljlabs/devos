# ACP Architecture Implementation Checklist

## ✅ Code Changes Complete

### Types & Interfaces
- [x] Simplified `Thread` interface (removed targetFile, activeSymbols, dependencies)
- [x] Simplified `Message` interface (raw ACP messages only)
- [x] Added `ACPMessageMethod` type
- [x] Removed `SecurityRule` interface
- [x] Removed `CodeBlock`, `LogsInfo`, `PendingAction` interfaces
- [x] Updated `DatabaseSchema` (removed rules)

### Server Changes
- [x] Updated `wireAgent()` to store raw ACP messages
- [x] Updated thread status logic for permission tracking
- [x] Removed `/api/threads/{threadId}/approve` route
- [x] Removed `/api/threads/{threadId}/deny` route
- [x] Removed `/api/rules` routes
- [x] Added `POST /api/threads/{threadId}/respond` route
- [x] Updated message persistence to store raw ACP messages
- [x] Simplified `POST /api/threads/{threadId}/messages` handler

### UI Changes
- [x] Rewrote `ChatCanvas.tsx` with `getMessageContent()` helper
- [x] Added raw ACP message parsing
- [x] Implemented dynamic permission button rendering
- [x] Simplified message type handling
- [x] Updated props interface (removed approve/deny/rule handlers)
- [x] Added `onPermissionResponse` prop

### App Component
- [x] Added `handlePermissionResponse()` handler
- [x] Removed `handleApproveAction()`, `handleDenyAction()`, `handleAddRule()`, `handleClearRules()`
- [x] Removed SecurityRule import
- [x] Removed rule state and rule fetching
- [x] Removed ContextExplorer component and import
- [x] Simplified security view
- [x] Updated ChatCanvas props

### Type Checking
- [x] No TypeScript errors in server.ts
- [x] No TypeScript errors in src/types.ts
- [x] No TypeScript errors in src/App.tsx
- [x] No TypeScript errors in src/components/ChatCanvas.tsx
- [x] No TypeScript errors in claudeAgent.ts

## 📚 Documentation Created

- [x] `ACP_ARCHITECTURE.md` — Detailed architecture overview
- [x] `UI_RENDERING_GUIDE.md` — UI bubble rendering examples
- [x] `MIGRATION_SUMMARY.md` — Changes and migration details
- [x] `QUICK_REFERENCE.md` — Quick lookup guide
- [x] `IMPLEMENTATION_CHECKLIST.md` — This file

## 🧪 Testing (Ready to Execute)

### Functional Tests

- [ ] **Start Server**
  ```bash
  npm run dev
  # or
  npm run build && npm start
  ```
  Expected: Server starts on http://localhost:3000

- [ ] **Create Workspace**
  - [ ] Navigate to sidebar
  - [ ] Click "New Workspace"
  - [ ] Enter name and create
  - [ ] Verify workspace appears in db.json

- [ ] **Create Thread**
  - [ ] Click workspace
  - [ ] Click "+ New Thread"
  - [ ] Enter title "Test Thread"
  - [ ] Verify thread in db.json with correct workspaceId

- [ ] **Send Simple Prompt**
  - [ ] Activate thread
  - [ ] Type "Hello" and send
  - [ ] Check db.json for user message in raw format
  - [ ] UI should show user bubble

- [ ] **Monitor ACP Activity**
  - [ ] Send prompt: "what is 2 + 2?"
  - [ ] Monitor server console for ACP messages
  - [ ] Check db.json for session/update messages
  - [ ] UI should render agent response bubble

- [ ] **Tool Execution (File Read)**
  - [ ] Send: "read the README.md file"
  - [ ] Monitor for session/update with status: "pending"
  - [ ] Verify rawInput shows file path
  - [ ] UI should show pending tool bubble
  - [ ] Check for result with rawOutput
  - [ ] UI should show result bubble

- [ ] **Permission Request**
  - [ ] Send: "write 'hello' to test.txt"
  - [ ] Monitor for session/request_permission message
  - [ ] Verify thread.pendingPermissionId is set
  - [ ] Verify thread.pendingPermissionOptions has 3+ options
  - [ ] UI should show permission bubble with buttons

- [ ] **Permission Response**
  - [ ] Click "Allow" or "Allow Always" button
  - [ ] Monitor for POST /api/threads/{id}/respond call
  - [ ] Verify request body has optionId
  - [ ] Check server sent JSON-RPC response to ACP
  - [ ] ACP should resume execution
  - [ ] Tool should execute and show result

- [ ] **Multiple Tools in Sequence**
  - [ ] Send: "read file1.txt, then read file2.txt"
  - [ ] Verify multiple tool pending → result bubbles
  - [ ] Verify each can have permissions
  - [ ] Verify order is maintained

### Database Verification

- [ ] db.json has correct structure:
  ```json
  {
    "workspaces": [...],
    "threads": [...],
    "messages": [...]
  }
  ```
  - No `rules` array
  - Threads have `sessionId` and `pendingPermissionId`
  - Messages have `raw` field (raw ACP message)

- [ ] Raw messages are unmodified:
  ```bash
  # Check a message
  cat db.json | jq '.messages[0].raw'
  
  # Should show full ACP structure, not filtered/simplified
  ```

- [ ] Thread state updates correctly:
  - [ ] idle → thinking when message sent
  - [ ] thinking → awaiting_permission on request
  - [ ] awaiting_permission → idle after response

### UI Verification

- [ ] User messages display right-aligned
- [ ] Agent messages display left-aligned with bot icon
- [ ] Tool pending bubbles show input JSON
- [ ] Tool result bubbles show output
- [ ] Permission bubbles show:
  - [ ] Tool title and kind
  - [ ] File path being accessed
  - [ ] Dynamic buttons matching options array
- [ ] Buttons have correct styling:
  - [ ] allow_always: Green
  - [ ] allow_once: Yellow
  - [ ] reject_once: Transparent border
- [ ] Messages scroll smoothly
- [ ] Timestamps show correctly
- [ ] Console tab shows active session info

### Error Scenarios

- [ ] **Tool Fails**
  - [ ] Request tool on non-existent file
  - [ ] Verify status: "failed"
  - [ ] Verify rawOutput shows error
  - [ ] UI shows failure bubble in red

- [ ] **Permission Denied**
  - [ ] Send prompt requiring permission
  - [ ] Click "Reject" button
  - [ ] ACP should abort operation
  - [ ] Agent should report permission denied

- [ ] **Network Error**
  - [ ] Kill server mid-operation
  - [ ] Verify UI doesn't crash
  - [ ] Error should be logged
  - [ ] Restart server and continue

- [ ] **Invalid Message**
  - [ ] Malformed JSON from ACP (simulate)
  - [ ] Should be logged, not crash

### Performance Tests

- [ ] **Polling Performance**
  - [ ] Open Console tab (activity log)
  - [ ] Monitor polling rate
  - [ ] When idle: ~4s between polls
  - [ ] When thinking: ~1s between polls
  - [ ] Verify no excessive CPU usage

- [ ] **Large Message**
  - [ ] Execute command with large output
  - [ ] Verify message renders without lag
  - [ ] Scroll through output doesn't stutter

- [ ] **Many Messages**
  - [ ] Send 10+ prompts in sequence
  - [ ] Verify UI stays responsive
  - [ ] All messages render in correct order
  - [ ] db.json doesn't become slow

## 📋 Integration Checklist

- [ ] ClaudeAgent properly spawns ACP subprocess
- [ ] ACP subprocess connects and initializes
- [ ] session/new creates valid sessionId
- [ ] session/prompt triggers agent
- [ ] Agent emits messages through stdout
- [ ] Messages are parsed and stored correctly

## 🚀 Deployment Readiness

- [ ] Build completes without warnings
  ```bash
  npm run build
  ```

- [ ] Production start works
  ```bash
  npm run build
  npm start
  ```

- [ ] No console errors in browser DevTools

- [ ] No server errors in terminal

- [ ] All API endpoints respond correctly

## 📖 Documentation Review

- [ ] ACP_ARCHITECTURE.md is clear
- [ ] UI_RENDERING_GUIDE.md shows examples
- [ ] QUICK_REFERENCE.md is useful
- [ ] MIGRATION_SUMMARY.md explains changes
- [ ] All code comments are up-to-date

## 🐛 Known Limitations / Future Work

- [ ] No persistence of conversation history beyond db.json
- [ ] No support for WebSockets (HTTP polling only)
- [ ] No per-user isolation (shared db.json)
- [ ] No encryption of stored messages
- [ ] No audit logging of permissions
- [ ] No rate limiting on API

## ✨ Optional Enhancements

- [ ] Add WebSocket support for real-time updates
- [ ] Add message export/import
- [ ] Add permission policies (e.g., auto-allow test commands)
- [ ] Add message search
- [ ] Add thread tagging
- [ ] Add session recording/playback

## Final Sign-Off

- [x] **Code**: Ready
- [x] **Types**: Ready
- [x] **Documentation**: Ready
- [ ] **Testing**: Pending
- [ ] **Deployment**: Pending

---

## Next Steps

1. Run test suite: `npm test` (if configured)
2. Start development server: `npm run dev`
3. Execute functional tests (see Testing section above)
4. Verify all checklist items pass
5. Deploy to staging/production

---

**Last Updated**: 2026-06-26  
**Status**: ✅ Implementation Complete, Ready for Testing
