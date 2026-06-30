# Component Extraction - Phase 1 & 2 Complete

## What Was Done

Extracted shared business logic and UI components from `ChatCanvas.tsx` and `MobileChatCanvas.tsx` to eliminate duplication.

## New Directory Structure

```
src/
├── hooks/
│   ├── useTextareaExpand.ts      (new)
│   └── useAutoScroll.ts           (new)
├── utils/
│   └── messages.ts                (new - message parsing)
└── components/shared/
    ├── bubbles/
    │   ├── UserMessageBubble.tsx
    │   ├── AgentMessageBubble.tsx
    │   ├── AgentChunkBubble.tsx
    │   ├── ToolPendingBubble.tsx
    │   ├── ToolResultBubble.tsx
    │   ├── PermissionBubble.tsx
    │   ├── StatusIndicator.tsx
    │   └── index.ts
    ├── content/
    │   ├── MarkdownContent.tsx
    │   ├── ThinkingBlock.tsx
    │   ├── ErrorPill.tsx
    │   └── index.ts
    ├── panels/
    │   ├── ThreadLogPanel.tsx
    │   └── index.ts
    └── index.ts
```

## Extracted Files

### Phase 1: Utilities & Hooks
- `src/hooks/useAutoScroll.ts` - Auto-scroll behavior when near bottom
- `src/hooks/useTextareaExpand.ts` - Textarea auto-expand (capped at maxHeight)
- `src/utils/messages.ts` - Message parsing logic (getMessageContent)

### Phase 2: Shared Components

**Bubbles** (message rendering):
- `UserMessageBubble` - User input display
- `AgentMessageBubble` - Full agent response
- `AgentChunkBubble` - Streaming agent response
- `ToolPendingBubble` - Tool execution pending + result
- `ToolResultBubble` - Standalone tool result (when not grouped with pending)
- `PermissionBubble` - Permission request with pattern picker
- `StatusIndicator` - Agent status (thinking/running/awaiting)

**Content** (text & styling):
- `MarkdownContent` - Markdown rendering with dark theme
- `ThinkingBlock` - Collapsible thinking process  
- `ErrorPill` - Error message display

**Panels**:
- `ThreadLogPanel` - Thread logs/console display

## Key Design

All bubbles accept an `isCompact` prop:
- `isCompact={false}` → Desktop sizing/spacing
- `isCompact={true}` → Mobile sizing/spacing

No separate mobile components needed—same component with conditional sizing.

## Next: Phase 3 Refactoring

Update both canvas files to use shared components:

### ChatCanvas Changes
- Import from `src/components/shared`
- Use hooks: `useAutoScroll`, `useTextareaExpand`
- Import message parser: `getMessageContent` from `src/utils/messages`
- Render bubbles with `isCompact={false}`
- Remove duplicate component definitions

### MobileChatCanvas Changes
- Import from `src/components/shared`
- Use same hooks
- Render bubbles with `isCompact={true}`
- Remove all duplicate rendering logic

## Testing

Run `npm run test` to verify:
- 72 existing tests should still pass
- No regressions in message rendering
- Both desktop and mobile views work identically

## Import Pattern

```typescript
// Before (desktop & mobile each had their own)
import { PermissionBubble, getMessageContent } from "./ChatCanvas";

// After (centralized)
import {
  PermissionBubble,
  UserMessageBubble,
  AgentMessageBubble,
  ToolPendingBubble,
  StatusIndicator,
  // ... other components
} from "./shared";

import { getMessageContent } from "../utils/messages";
import { useAutoScroll, useTextareaExpand } from "../hooks";
```

## Benefits

| Metric | Before | After |
|--------|--------|-------|
| ChatCanvas lines | 1,032 | ~400 (target) |
| MobileChatCanvas lines | 370 | ~300 (target) |
| Bubble components | 2 files (duplicated) | 7 reusable shared |
| Message parsing | 2 copies | 1 shared |
| Add new message type | Update 2 files | Update 1 shared + both views inherit |

## Status

✅ Phase 1-2 Complete: All shared components & hooks created and type-checked
⏳ Phase 3 Pending: Refactor ChatCanvas and MobileChatCanvas to use shared components
⏳ Phase 4 Pending: Testing & verification
