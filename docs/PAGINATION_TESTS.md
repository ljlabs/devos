# Pagination Tests - Quick Reference

## What These Tests Do

Verifies that the message pagination system returns **different messages** at each page, not repeated content.

## Test Files

| File | Purpose | Messages | Pages |
|------|---------|----------|-------|
| `server_src/db.sqlite.pagination.test.ts` | Synthetic mock messages | Controlled (5-500) | Various sizes |
| `server_src/db.sqlite.mock-real.test.ts` | Real database (`devos_mock.db`) | 4,960 actual | 496 pages |

## Running Tests

### Run pagination tests only
```bash
npm run test -- db.sqlite.mock-real.test db.sqlite.pagination.test
```

### Run with verbose output
```bash
npm run test -- db.sqlite.mock-real.test db.sqlite.pagination.test --reporter=verbose
```

### Run specific test file
```bash
npm run test -- db.sqlite.mock-real.test
npm run test -- db.sqlite.pagination.test
```

### Run specific test case
```bash
npm run test -- db.sqlite.mock-real.test --grep "different pages"
```

## What Gets Verified

✅ **No Duplicates**: Same message never appears twice across pages
✅ **Different Content**: Each page contains distinct messages
✅ **Cursor Progression**: Oldest message from page N becomes cursor for page N+1
✅ **Real Data**: Uses actual 4,960 messages from mock database
✅ **API Format**: Verifies response structure matches `/api/threads/:id/messages/paginated`
✅ **Edge Cases**: Handles <10, =10, and >500 messages correctly

## Key Findings

- ✅ **4,960 messages** successfully retrieved across **496 pages**
- ✅ **Zero duplicates** detected across entire pagination traversal
- ✅ **Message IDs differ** between pages: `msg-1783098871230-...` → `msg-1783098818528-...`
- ✅ **Content is diverse**: Agent chunks, tool calls, tool results, all captured
- ✅ **Cursor logic works**: Each page correctly fetches older messages before previous cursor

## Test Output Example

```
stdout | db.sqlite.mock-real.test.ts > Pagination with real messages
Using thread "Untitled" with 4960 messages

stdout | db.sqlite.mock-real.test.ts > loads latest messages successfully
Loaded 10 latest messages
  - Newest: msg-1783098871230-hgopgwjtpq (2026-07-03T17:14:39.476Z)
  - Oldest: msg-1783098813001-foco74u3n48 (2026-07-03T17:13:33.001Z)

stdout | db.sqlite.mock-real.test.ts > complete pagination traversal without duplicates
Retrieved 4960 total unique messages across 496 pages
```

## Database Structure

Mock database (`devos_mock.db`) contains:
- **4 Workspaces** (LekkerLoyal, notes, etc.)
- **1 Thread** with 4,960 messages
- **Message Types**:
  - Agent responses (session updates)
  - Tool calls (bash commands)
  - Tool results (command output)

## How Pagination Works

1. **Page 1**: `GET /api/threads/xxx/messages/paginated?limit=10`
   - Returns 10 newest messages
   - Response: `{ messages: [...], hasMore: true, nextCursor: "msg-..." }`

2. **Page 2**: `GET /api/threads/xxx/messages/paginated?cursor=msg-...&limit=10`
   - Returns 10 older messages before cursor
   - Cursor = oldest message ID from previous page

3. **Continue**: Each page uses oldest message from previous page as cursor

## Troubleshooting

**Test times out?**
- Increase timeout in test file (30 seconds is default for full traversal)
- Run smaller test: `--grep "loads latest messages"`

**Missing mock database?**
- Ensure `devos_mock.db` exists in project root
- Copy from backup if needed

**Tests fail with "no messages"?**
- Check database file is valid: `ls -la devos_mock.db`
- Verify database structure: run test with `--reporter=verbose`

## Documentation

See `docs/PAGINATION_TEST_VERIFICATION.md` for full analysis and findings.
