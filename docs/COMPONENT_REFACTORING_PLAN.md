# Component Refactoring Plan

**Goal**: Eliminate message-rendering duplication between `ChatCanvas.tsx` and `MobileChatCanvas.tsx` by extracting shared bubbles and logic into reusable components.

**Current State**: ~1,000 lines of duplicate rendering code across two files. Mobile version already reuses `getMessageContent()` and `MarkdownContent`, but still duplicates all bubble rendering.

**Result**: Both views will share identical rendering logic, reducing maintenance burden and ensuring consistency.

---

## 1. Shared Business Logic (Hooks & Utilities)

Extract utilities into `src/utils/` and hooks into `src/hooks/`.

### `useAutoScroll` Hook
Auto-scroll to bottom when near the bottom of the chat.

```typescript
// src/hooks/useAutoScroll.ts
export function useAutoScroll() {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const isNearBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  useEffect(() => {
    if (isNearBottom()) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [isNearBottom]);

  return { messagesEndRef, scrollContainerRef, isNearBottom };
}
```

### `useTextareaExpand` Hook
Auto-expand textarea as user types, capped at max height.

```typescript
// src/hooks/useTextareaExpand.ts
export function useTextareaExpand(maxHeight: number = 240) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleChange = useCallback((text: string, onChangeCallback: (text: string) => void) => {
    onChangeCallback(text);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const newHeight = Math.min(textareaRef.current.scrollHeight, maxHeight);
      textareaRef.current.style.height = newHeight + "px";
    }
  }, [maxHeight]);

  return { textareaRef, handleChange };
}
```

### Message Parsing (Already Extracted)
`getMessageContent()` is already shared—keep it in `ChatCanvas.tsx` or move to `src/utils/messages.ts` for clarity.

---

## 2. Shared Components

Create `src/components/shared/` with message bubbles, content renderers, and panels.

### Directory Structure

```
src/components/shared/
├── bubbles/
│   ├── UserMessageBubble.tsx
│   ├── AgentMessageBubble.tsx
│   ├── AgentChunkBubble.tsx
│   ├── ToolPendingBubble.tsx
│   ├── ToolResultBubble.tsx
│   ├── PermissionBubble.tsx
│   └── StatusIndicator.tsx
├── content/
│   ├── MarkdownContent.tsx (move from ChatCanvas)
│   ├── ThinkingBlock.tsx (move from ChatCanvas)
│   └── ErrorPill.tsx
└── panels/
    ├── ThreadLogPanel.tsx
```

---

## 3. Component Interfaces

### User Message Bubble

```typescript
// src/components/shared/bubbles/UserMessageBubble.tsx
interface UserMessageBubbleProps {
  content: string;
  timestamp: string;
  isCompact?: boolean; // mobile = true, desktop = false
}

export function UserMessageBubble({ content, timestamp, isCompact }: UserMessageBubbleProps) {
  return (
    <div className={`flex justify-end max-w-4xl mx-auto w-full group animate-fadeIn select-text ${isCompact ? "px-2" : "px-0"}`}>
      <div className={`bg-[#18181B] border border-white/5 rounded-lg rounded-tr-none text-slate-200 whitespace-pre-wrap break-words ${
        isCompact ? "max-w-[85%] p-2.5 text-xs" : "max-w-[80%] p-3 sm:p-4 text-xs sm:text-sm"
      }`}>
        <p className="leading-relaxed">{content}</p>
        <div className={`mt-2 font-mono text-right text-slate-500 select-none ${isCompact ? "text-[9px]" : "text-[9px] sm:text-[10px]"}`}>
          {new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
}
```

### Agent Message Bubble

```typescript
// src/components/shared/bubbles/AgentMessageBubble.tsx
interface AgentMessageBubbleProps {
  content: string;
  timestamp: string;
  isCompact?: boolean;
}

export function AgentMessageBubble({ content, timestamp, isCompact }: AgentMessageBubbleProps) {
  return (
    <div className={`flex justify-start gap-${isCompact ? '2' : '4'} max-w-4xl mx-auto w-full group animate-fadeIn select-text ${isCompact ? "px-2" : "px-0"}`}>
      <div className={`bg-emerald-500/20 border border-emerald-500/40 rounded-lg flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(16,185,129,0.15)] select-none ${
        isCompact ? "w-6 h-6" : "w-7 h-7 sm:w-8 sm:h-8"
      }`}>
        <Bot size={isCompact ? 12 : 14} className="text-emerald-400" />
      </div>
      <div className={`flex-1 ${isCompact ? "max-w-[88%]" : "max-w-[90%] sm:max-w-[90%]"}`}>
        <div className={`bg-[#0E0E11] border border-white/5 rounded-lg rounded-tl-none ${
          isCompact ? "p-2.5 text-xs" : "p-3 sm:p-5 text-xs sm:text-sm"
        }`}>
          <div className={`flex items-center justify-between pb-2 mb-3 border-b border-white/5 select-none font-mono font-bold text-emerald-400 gap-1 sm:gap-0 ${
            isCompact ? "text-[9px]" : "text-[9px] sm:text-[10px]"
          }`}>
            <span>CLAUDE AI AGENT</span>
            <span className="text-slate-500 font-normal whitespace-nowrap">
              {new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <MarkdownContent content={content} />
        </div>
        <div className="mt-1 flex justify-end">
          <CopyButton content={content} />
        </div>
      </div>
    </div>
  );
}
```

### Tool Pending Bubble

```typescript
// src/components/shared/bubbles/ToolPendingBubble.tsx
interface ToolPendingBubbleProps {
  title: string;
  kind: string;
  toolCallId: string;
  status: string;
  isExpanded: boolean;
  onToggleExpand: (toolCallId: string) => void;
  resultOutput?: string; // from matching tool_call_update
  permissionApproved?: boolean;
  permissionRejected?: boolean;
  isFailed?: boolean;
  isCompact?: boolean;
}

export function ToolPendingBubble({
  title,
  kind,
  toolCallId,
  status,
  isExpanded,
  onToggleExpand,
  resultOutput,
  permissionApproved,
  permissionRejected,
  isFailed,
  isCompact,
}: ToolPendingBubbleProps) {
  const hasResult = !!resultOutput;
  // ... rendering logic
}
```

### Permission Bubble

Already partially extracted in `ChatCanvas.tsx`—move to `src/components/shared/bubbles/PermissionBubble.tsx` as-is.

### Status Indicator

```typescript
// src/components/shared/bubbles/StatusIndicator.tsx
interface StatusIndicatorProps {
  status: 'thinking' | 'running' | 'awaiting_permission' | 'idle';
  isCompact?: boolean;
}

export function StatusIndicator({ status, isCompact }: StatusIndicatorProps) {
  // Compact for mobile, full for desktop
  // Shows status dot + message
}
```

### Error Pill

```typescript
// src/components/shared/content/ErrorPill.tsx
interface ErrorPillProps {
  message: string;
  isCompact?: boolean;
}

export function ErrorPill({ message, isCompact }: ErrorPillProps) {
  // Renders error message in a rounded pill
}
```

### Thread Log Panel

```typescript
// src/components/shared/panels/ThreadLogPanel.tsx
interface ThreadLogPanelProps {
  logs: any[];
  isCompact?: boolean;
  onClear: () => void;
  onClose: () => void;
  threadTitle: string;
}

export function ThreadLogPanel({ logs, isCompact, onClear, onClose, threadTitle }: ThreadLogPanelProps) {
  // Responsive thread log rendering
}
```

---

## 4. Refactored Component Tree

### Desktop ChatCanvas (Refactored)

```typescript
// src/components/ChatCanvas.tsx
export default function ChatCanvas(props: ChatCanvasProps) {
  const { activeThread, messages, inputText, onChangeInput, onSendMessage, ... } = props;
  const { messagesEndRef, scrollContainerRef, isNearBottom } = useAutoScroll();
  const { textareaRef, handleChange } = useTextareaExpand(240);
  const [expandedToolId, setExpandedToolId] = useState<string | null>(null);
  const [showConsole, setShowConsole] = useState(false);

  if (!activeThread) {
    return <EmptyState />;
  }

  return (
    <main className="flex-1 flex flex-col bg-[#0B0B0C] overflow-hidden">
      <header className="h-12 sm:h-14 flex items-center ...">
        {/* Responsive header */}
      </header>

      {showConsole && (
        <ThreadLogPanel logs={threadLogs} onClear={...} onClose={...} isCompact={false} />
      )}

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 sm:space-y-8 custom-scrollbar">
        {messages.length === 0 ? (
          <EmptyConversationState />
        ) : (
          messages.map((msg) => {
            const parsed = getMessageContent(msg);
            if (!parsed) return null;

            if (parsed.type === "user") {
              return <UserMessageBubble key={msg.id} content={parsed.content} timestamp={msg.timestamp} isCompact={false} />;
            }
            if (parsed.type === "agent_text") {
              return <AgentMessageBubble key={msg.id} content={parsed.content} timestamp={msg.timestamp} isCompact={false} />;
            }
            if (parsed.type === "tool_pending") {
              return (
                <ToolPendingBubble
                  key={msg.id}
                  {...parsed.content}
                  isExpanded={expandedToolId === parsed.content.toolCallId}
                  onToggleExpand={setExpandedToolId}
                  isCompact={false}
                />
              );
            }
            // ... other types
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <InputArea inputText={inputText} onChangeInput={handleChange} textareaRef={textareaRef} isCompact={false} />
    </main>
  );
}
```

### Mobile ChatCanvas (Refactored)

```typescript
// src/components/MobileChatCanvas.tsx
export default function MobileChatCanvas(props: MobileChatCanvasProps) {
  const { activeThread, messages, inputText, onChangeInput, ... } = props;
  const { messagesEndRef, scrollContainerRef } = useAutoScroll();
  const { textareaRef, handleChange } = useTextareaExpand(120); // smaller on mobile
  const [expandedToolId, setExpandedToolId] = useState<string | null>(null);
  const [showConsole, setShowConsole] = useState(false);

  if (!activeThread) {
    return <EmptyState />;
  }

  return (
    <div className="flex flex-col bg-[#0B0B0C] overflow-hidden" style={{ position: 'fixed', inset: 0 }}>
      <header className="flex-shrink-0 h-14 flex items-center ...">
        {/* Mobile header */}
      </header>

      {showConsole && (
        <ThreadLogPanel logs={threadLogs} onClear={...} onClose={...} isCompact={true} />
      )}

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-3 space-y-4 custom-scrollbar">
        {messages.length === 0 ? (
          <EmptyConversationState />
        ) : (
          messages.map((msg) => {
            const parsed = getMessageContent(msg);
            if (!parsed) return null;

            if (parsed.type === "user") {
              return <UserMessageBubble key={msg.id} content={parsed.content} timestamp={msg.timestamp} isCompact={true} />;
            }
            if (parsed.type === "agent_text") {
              return <AgentMessageBubble key={msg.id} content={parsed.content} timestamp={msg.timestamp} isCompact={true} />;
            }
            if (parsed.type === "tool_pending") {
              return (
                <ToolPendingBubble
                  key={msg.id}
                  {...parsed.content}
                  isExpanded={expandedToolId === parsed.content.toolCallId}
                  onToggleExpand={setExpandedToolId}
                  isCompact={true}
                />
              );
            }
            // ... other types
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <InputArea inputText={inputText} onChangeInput={handleChange} textareaRef={textareaRef} isCompact={true} />
    </div>
  );
}
```

---

## 5. Implementation Phases

### Phase 1: Extract Utilities & Hooks
- Create `src/hooks/useAutoScroll.ts` and `useTextareaExpand.ts`
- Move `getMessageContent()` to `src/utils/messages.ts` (optional)
- Update imports in both canvas files

### Phase 2: Extract Shared Components
- Create `src/components/shared/bubbles/` subdirectory
- Move/extract:
  - `MarkdownContent` → `MarkdownContent.tsx`
  - `ThinkingBlock` → `ThinkingBlock.tsx`
  - `PermissionBubble` → `PermissionBubble.tsx`
- Create new bubble components:
  - `UserMessageBubble.tsx`
  - `AgentMessageBubble.tsx`
  - `AgentChunkBubble.tsx`
  - `ToolPendingBubble.tsx`
  - `ToolResultBubble.tsx`
  - `StatusIndicator.tsx`
- Create `src/components/shared/content/` components:
  - `ErrorPill.tsx`
- Create `src/components/shared/panels/`:
  - `ThreadLogPanel.tsx`

### Phase 3: Refactor Canvas Files
- Update `ChatCanvas.tsx` to use shared bubbles with `isCompact={false}`
- Update `MobileChatCanvas.tsx` to use shared bubbles with `isCompact={true}`
- Both files now use identical rendering logic; only sizing/spacing differs

### Phase 4: Testing & Cleanup
- Verify both desktop and mobile render identically (except sizing)
- Remove any remaining duplicate code
- Run test suite: `npm run test`

---

## 6. Benefits

| Aspect | Before | After |
|--------|--------|-------|
| **Duplication** | ~1,000 lines | ~200 lines (logic only) |
| **Bubble Types** | Defined twice | Defined once |
| **New Message Type** | Update 2 files | Update 1 file + both views inherit |
| **Consistency** | Manual sync | Automatic |
| **Maintenance** | High (2 sources of truth) | Low (1 source of truth) |
| **File Size** | ChatCanvas: 1,032 lines | ChatCanvas: ~400 lines |
| **Component Reusability** | Low (embedded in canvas) | High (standalone components) |

---

## 7. Migration Checklist

- [ ] Phase 1: Create hooks
- [ ] Phase 2: Extract content components (MarkdownContent, ThinkingBlock)
- [ ] Phase 3: Create bubble components
- [ ] Phase 4: Refactor ChatCanvas
- [ ] Phase 5: Refactor MobileChatCanvas
- [ ] Phase 6: Run `npm run test` to verify no regressions
- [ ] Phase 7: Manual testing on desktop and mobile
- [ ] Phase 8: Delete any old duplicated code
- [ ] Phase 9: Commit with message: "refactor: extract shared chat components (bubbles, hooks, utils)"

---

## 8. Key Decisions

1. **`isCompact` Prop**: Controls sizing/spacing. Desktop uses `false`, mobile uses `true`. Avoids two separate components.

2. **Shared `getMessageContent()`**: Already extracted and reused—core message parsing is DRY.

3. **No New Enums/Config**: Keep styling inline with Tailwind. Props control layout, not theme.

4. **Backward Compatibility**: Both canvas files maintain the same public props and behavior during refactor. No API changes.

5. **Test Coverage**: Existing tests should pass; add component tests for each bubble in Phase 4.

---

## 9. Questions for Review

- Should `getMessageContent()` move to `src/utils/messages.ts`? (Current: in ChatCanvas)
- Should `MarkdownContent` accept additional className overrides for custom styling?
- Should bubbles accept a `theme` prop (e.g., "dark" | "light") for future theming?
- Are there any message types not covered in the current bubble set?

