# Embedded File Explorer / Mini-IDE Implementation Plan (Issue #9)

## Overview

Add a lightweight embedded IDE to DevOS with three panels: **FILE EXPLORER**, **CODE EDITOR**, and **TERMINAL**. Optimized for mobile-first usage with a bottom navigation bar, plus desktop integration in the sidebar.

---

## Architecture Decisions

| Question | Decision | Rationale |
|---|---|---|
| Monaco Editor? | Deferred — use simple `<pre>` with CSS highlighting first | Monaco is 5-8MB, poor mobile performance |
| xterm.js? | Deferred — use read-only terminal display first | xterm.js is 1-2MB canvas, poor mobile battery life |
| Real PTY backend? | Future phase — start with thread log display | Requires `node-pty`, WebSocket infrastructure |
| Mobile layout? | Bottom nav (CHAT \| FILES \| EDITOR \| TERMINAL) | Matches user's HTML mockup, thumb-accessible |
| Desktop layout? | File tree in sidebar below workspace list | Extends existing sidebar navigation pattern |

---

## Backend API Design

### New Module: `server_src/files.ts`

```typescript
// Types
export interface FileEntry {
  name: string;
  path: string;       // relative to workspace root
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
}

export interface FileContent {
  path: string;
  content: string;
  size: number;
  lines: number;
  truncated?: boolean;
}

// Functions
export function listDirectory(workspaceRoot: string, relativePath?: string): FileEntry[]
export function readFile(workspaceRoot: string, relativePath: string): FileContent
```

**Security**: Path traversal prevention via `path.resolve()` + `startsWith(workspaceRoot)`. Excludes hidden files, `node_modules`, `.git`, `__pycache__`, `dist`, `build`.

### New Routes in `server_src/server.ts`

Place after workspace CRUD routes (after line ~426), before git routes:

```
GET /api/workspaces/:workspaceId/files?path=<relative>
  → { entries: FileEntry[], currentPath: string }

GET /api/workspaces/:workspaceId/files/read?path=<relative>
  → { content: string, size: number, lines: number, path: string, truncated?: boolean }
```

---

## Frontend Components

### New Components

| Component | Path | Description |
|---|---|---|
| `FileIcon` | `src/components/FileIcon.tsx` | Extension → Lucide icon mapper with colors |
| `FileExplorer` | `src/components/FileExplorer.tsx` | Recursive tree with lazy-loaded folders |
| `CodeDisplay` | `src/components/CodeDisplay.tsx` | Read-only code view with line numbers + regex highlighting |
| `TerminalDisplay` | `src/components/TerminalDisplay.tsx` | Terminal output + virtual keyboard toolbar |
| `IdeTabBar` | `src/components/IdeTabBar.tsx` | Tab strip for open files (desktop) |
| `MobileBottomNav` | `src/components/MobileBottomNav.tsx` | Fixed bottom bar with 4 tabs |
| `MobileIdeView` | `src/components/MobileIdeView.tsx` | Container switching between IDE panels |

### Modified Files

- `src/types.ts` — Add `IdePanel`, `FileEntry`, `FileContent`
- `src/components/MobileApp.tsx` — Add IDE state, bottom nav, panel rendering
- `src/components/WorkspaceSidebar.tsx` — Add file tree section (desktop)
- `src/App.tsx` — Add desktop IDE state

---

## Mobile Layout Structure

```
┌─────────────────────────┐
│ Header (contextual)     │ ← "DevOS IDE" / filename / "Terminal"
├─────────────────────────┤
│                         │
│   ACTIVE PANEL          │ ← Full viewport minus header/footer
│   (FILES/EDITOR/TERM/   │   Scrollable content area
│    CHAT)                │
│                         │
├─────────────────────────┤
│ [CHAT][FILES][EDITOR][T]│ ← MobileBottomNav (fixed, h-14)
└─────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Backend Foundation (Days 1-2)
1. Create `server_src/files.ts`
2. Add routes to `server_src/server.ts`
3. Write integration tests in `server_src/server.test.ts`

### Phase 2: Types & State (Day 2)
4. Update `src/types.ts`
5. Add IDE state to `MobileApp.tsx`

### Phase 3: Core UI Components (Days 3-4)
6. Create `FileIcon.tsx`
7. Create `FileExplorer.tsx`
8. Create `CodeDisplay.tsx`
9. Create `TerminalDisplay.tsx`

### Phase 4: Mobile Navigation (Day 4)
10. Create `MobileBottomNav.tsx`
11. Create `MobileIdeView.tsx`
12. Integrate into `MobileApp.tsx`

### Phase 5: Desktop Integration (Day 5)
13. Update `WorkspaceSidebar.tsx` with file tree section
14. Update `App.tsx` with desktop IDE state

---

## Testing Strategy

**Backend**:
- Unit tests for path traversal rejection
- Integration tests for directory listing and file reading
- Edge cases: binary files (>1MB), symlinks, empty directories

**Frontend**:
- Component tests for FileExplorer expand/collapse
- CodeDisplay syntax highlighting accuracy
- MobileBottomNav tab switching state preservation

---

## Success Criteria

✅ Mobile bottom nav switches between CHAT/FILES/EDITOR/TERMINAL smoothly  
✅ File tree loads lazily on folder expand  
✅ Clicking a file opens it in EDITOR panel with syntax highlighting  
✅ Terminal panel displays thread logs formatted as terminal output  
✅ Desktop sidebar shows file tree below workspace list  
✅ All existing functionality remains intact  

---

## Out of Scope (Future Enhancements)

- Monaco Editor integration (progressive enhancement on desktop)
- xterm.js + node-pty for real terminal PTY sessions
- File editing/saving capability
- Search/replace in files
- Git diff view in editor tabs