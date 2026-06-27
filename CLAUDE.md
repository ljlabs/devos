# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Start dev server (Express + Vite, port 3000)
- `npm run build` — Build production bundle (vite build + esbuild server.cjs)
- `npm run start` — Run production build
- `npm run lint` — Type-check with `tsc --noEmit`

## Architecture

DevOS is a multi-agent chat workspace that communicates with Claude agents via the **Agent Client Protocol (ACP)**. The system has three layers:

### Backend (`server.ts` + `claudeAgent.ts`)

- **`server.ts`** — Express HTTP API over ACP subprocesses. Manages CRUD for workspaces/threads/messages and persists raw ACP messages verbatim to `db.json`. Routes handle workspace creation, thread creation, message posting, and permission responses.
- **`claudeAgent.ts`** — Thin wrapper around the ACP subprocess (`@agentclientprotocol/claude-agent-acp`). Spawns a child process per thread, speaks raw JSON-RPC 2.0 over stdin/stdout. Singleton per thread ID. Emits `"message"` and `"close"` events.
- **Data flow**: User sends message → server persists it → server initializes/resumes Claude agent → sends `session/prompt` → agent responds via `"message"` event → server writes to db → UI polls for new messages.

### Frontend (`src/`)

- **`App.tsx`** — Root component managing all state (workspaces, threads, messages, views). Polls API at 1s (active) or 4s (idle) intervals.
- **`ChatCanvas.tsx`** — Renders raw ACP messages as interactive bubbles. `getMessageContent()` parses all ACP message types (tool calls, permission requests, streaming text, session updates).
- **`WorkspaceSidebar.tsx`** — Left sidebar with workspace list and navigation views.
- **`ThreadList.tsx`** — Middle column listing threads with status indicators (idle/thinking/awaiting_permission).
- **`types.ts`** — Core types: `Workspace`, `Thread`, `Message`, `DatabaseSchema`, `ACPMessageMethod`.

### ACP Protocol

Messages use JSON-RPC 2.0. Key methods: `initialize`, `session/new`, `session/load`, `session/prompt`, `session/cancel`, `session/update`, `session/request_permission`. Permission flow: agent sends `session/request_permission` → UI shows options → user picks → server sends JSON-RPC response with `selected.optionId`.

**ACP Agent Package**: `@agentclientprotocol/claude-agent-acp` — [GitHub](https://github.com/agentclientprotocol/claude-agent-acp). Spawns via `npx -y` per thread. On Windows, use `npx.cmd` directly (not `shell: true` with `npx`) to avoid `cmd.exe` spawn errors.

## Environment

- `GEMINI_API_KEY` — Required for Gemini AI API calls (configured via AI Studio Secrets panel)
- `APP_URL` — Auto-injected Cloud Run service URL

## Rules

- Do not create markdown documentation files (*.md) unless explicitly asked by the user.

## Tech Stack

React 19, Vite 6, TypeScript 5.8, Tailwind CSS 4, Express 4, Lucide React icons, Motion (Framer Motion successor).

## Documentation

Additional architecture docs live in `docs/`:
- `docs/ACP_ARCHITECTURE.md` — Detailed ACP protocol design, data flow, and message types
- `docs/ARCHITECTURE_DIAGRAMS.md` — Visual ASCII diagrams of system architecture, message flow, permission flow, and state transitions
- `docs/UI_RENDERING_GUIDE.md` — How raw ACP messages are parsed and rendered as chat bubbles in ChatCanvas
- `docs/QUICK_REFERENCE.md` — Compact reference for API routes, data structures, and debugging
