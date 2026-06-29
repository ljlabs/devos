# SQLite Database

DevOS uses SQLite for persistence (auto-created as `devos.db`).

## Migration

If you have existing `db.json`:
```bash
npx tsx scripts/migrate-db.ts
```

This migrates workspaces, threads, messages, and patterns to SQLite.

## Architecture

**Files**:
- `devos.db` - SQLite database
- `server_src/db.sqlite.ts` - Database layer
- `scripts/migrate-db.ts` - Migration script

**Schema**:
```
workspaces (1)──<──(N) threads
threads (1)──<──(N) messages

allowedPatterns (separate)
```

All relationships use `ON DELETE CASCADE`.

## Operations

| Operation | Method | Result |
|-----------|--------|--------|
| Delete workspace | `deleteWorkspace(id)` | Deletes threads + messages |
| Delete thread | `deleteThread(id)` | Deletes messages |
| Read data | `readDb()` | Returns DatabaseSchema |
| Write data | `writeDb(data)` | Atomic transaction |
| Update | `updateDb(fn)` | Read-modify-write |

## Configuration

```bash
DB_FILE=/path/to/custom.db npm run dev
```

Default: `devos.db` in project root.

## Testing

```bash
npm run test -- db.sqlite.test.ts  # 24 database tests
npm run test -- server_src         # All server tests (72)
```

Performance: ~5-10x faster than JSON, ~50ms for cascade deletes with 1000 messages.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Database locked | `rm devos.db-shm devos.db-wal` |
| Migration fails | Delete `devos.db*`, retry |
| Data missing | Restore from `db.json.backup` |

See code comments in `db.sqlite.ts` for implementation details.
