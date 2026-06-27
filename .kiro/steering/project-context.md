# DevOS Project Context

## Architecture Reference

Before making changes, consult the architecture documentation in `docs/`:

- `docs/ACP_ARCHITECTURE.md` — Core ACP protocol design, data flow, and message types
- `docs/ARCHITECTURE_DIAGRAMS.md` — Visual diagrams of the system, permission flow, and state transitions
- `docs/UI_RENDERING_GUIDE.md` — How raw ACP messages are parsed and rendered as chat bubbles
- `docs/QUICK_REFERENCE.md` — Quick lookup for API routes, data structures, and debugging

## Rules

- Do not create markdown documentation files (*.md) unless explicitly asked by the user.

## Key Design Principles

- The server is a **thin HTTP router** — it stores raw ACP messages verbatim, never interprets or transforms them
- All conversation state flows through the ACP protocol (JSON-RPC 2.0 over stdin/stdout)
- The UI (`ChatCanvas.tsx`) parses raw ACP structures directly via `getMessageContent()`
- Permission flow: ACP sends `session/request_permission` → UI renders dynamic buttons → user picks → server sends JSON-RPC response
- `db.json` stores only raw ACP messages, workspace/thread metadata, and pending permission state

## Commands

- `npm run dev` — Start dev server (Express + Vite, port 3000)
- `npm run build` — Production build (vite build + esbuild server.cjs)
- `npm run lint` — Type-check with `tsc --noEmit`
