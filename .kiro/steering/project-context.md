# DevOS Project Context

## Architecture Reference

Core documentation in `docs/`:
- `ACP_ARCHITECTURE.md` — ACP protocol design and data flow
- `SQLITE_REFERENCE.md` — Database schema, migration, testing
- `QUICK_REFERENCE.md` — API routes and debugging
- `UI_RENDERING_GUIDE.md` — Raw ACP messages to UI rendering

## Key Components

**Server** (`server_src/`):
- `server.ts` - Express router + request handling
- `db.sqlite.ts` - SQLite persistence layer (24 tests)
- `claudeAgent.ts` - ACP subprocess wrapper

**Database**:
- Auto-created as `devos.db` (SQLite)
- 4 tables: workspaces, threads, messages, allowedPatterns
- Cascade deletion on workspace/thread delete
- ~5-10x faster than JSON

**UI** (`src/`):
- React components in `/components`
- Chat canvas renders ACP messages
- Workspace/thread sidebar navigation

## Rules

- Keep code comments clear and concise
- Documentation in `docs/` directory only (see `documentation-standards.md`)
- Tests cover database layer, API endpoints, cascade deletion
- Run `npm run test` before committing

## Commands

```bash
npm run dev      # Dev server (port 3000, Vite hot-reload)
npm run build    # Production build
npm run lint     # Type-check
npm run test     # Run 72 tests
```
