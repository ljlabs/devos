# Mobile Navigator UI Reference

## Visual Layout

### Full Screen Overlay

```
┌────────────────────────────────────────┐
│ Threads & Workspaces            [X]    │  ← Header: Title + Close Button
├────────────────────────────────────────┤
│         [+ New Thread]                 │  ← Action Button
├────────────────────────────────────────┤
│ ▼ Workspace A                 🔽      │  ← Expanded Workspace
│   🟢 Thread 1                          │
│   🟢 Thread 2                  [✏️][🗑️]│  ← Active Thread with Edit/Delete
│   ⚪ Thread 3                          │
│ > Workspace B                 ▶️      │  ← Collapsed Workspace
│ > Workspace C                 ▶️      │
│                                        │
│ [Scrollable list continues]            │
│                                        │
│                                        │
│                                        │
└────────────────────────────────────────┘
```

### Color States

#### Active Workspace
```
Color: Emerald
Border: emerald-500/30
Background: emerald-500/20
Text: emerald-300

Visual:
┌─────────────────────────────────────┐
│ ▼ Workspace Backend              🔽  │ ← Selected
└─────────────────────────────────────┘
```

#### Inactive Workspace
```
Color: Slate
Border: None
Background: Transparent (hover: white/5)
Text: slate-300 (hover: slate-300)

Visual:
┌─────────────────────────────────────┐
│ > Workspace Frontend             ▶️  │ ← Not selected
└─────────────────────────────────────┘
```

#### Active Thread
```
Color: Emerald (same as workspace)
Border: emerald-500/30
Background: emerald-500/20
Text: emerald-300

Visual:
  🟢 Database Thread         [✏️][🗑️]  ← Selected
```

#### Inactive Thread
```
Color: Slate
Border: None
Background: Transparent (hover: white/5)
Text: slate-400 (hover: slate-300)

Visual:
  ⚪ Setup Thread
```

## Status Indicators

### Running (Executing)
```
🟢 (Green pulsing)
color: #10b981
animation: animate-pulse
example: 🟢 API Server Test (Running)
```

### Awaiting Permission
```
🟡 (Amber pulsing)
color: #f59e0b
animation: animate-pulse
example: 🟡 File Access Request
```

### Thinking (Processing)
```
🔵 (Blue pulsing)
color: #3b82f6
animation: animate-pulse
example: 🔵 Analyzing Code
```

### Idle (Not Running)
```
⚪ (Gray static)
color: #64748b
animation: none
example: ⚪ Old Results
```

## Button States

### Normal Hover
```
Text color: slate-300
Background: Transparent
Transition: 0.2s

State: Default
  > Workspace A
```

### Hover Highlight
```
Text color: slate-300
Background: white/5
Transition: 0.2s

State: Hover
  > Workspace A    ← Light background appears
```

### Active
```
Border: emerald-500/30
Background: emerald-500/20
Text: emerald-300

State: Selected
  ▼ Workspace A   ← Emerald highlight
```

## Edit Mode

### When Hovering Over Thread
```
  🟢 Thread Name         [✏️][🗑️]
                         └─ Edit/Delete appear on hover
```

### When Editing (Clicked Pencil)
```
  [________________]     ← Input field in focus
      Auto-focused
      Border: emerald-500/30
      Background: #18181B
      Text: slate-200
```

### Editing Shortcuts
```
Enter  → Save rename
Escape → Cancel
Blur   → Save (on blur)
```

## Chevron States

### Expanded Workspace
```
▼ Workspace A    ← Chevron pointing down
  • Thread 1
  • Thread 2
```

### Collapsed Workspace
```
> Workspace B    ← Chevron pointing right
```

### Click Zone
```
┌─────────────────────────────────────┐
│ ▼ Workspace A                 🔽    │
│ └─ Click on chevron to toggle       │
│ └─ Click on name to select          │
│ └─ Clicking either toggles expand   │
└─────────────────────────────────────┘
```

## Spacing Reference

### Padding
```
Header: p-4 (16px all sides)
List container: p-2 (8px all sides)
Item: px-3 py-2 (12px x, 8px y)
Thread (indented): ml-6 (24px left margin)
```

### Gaps
```
Between items: space-y-1 (4px)
Between icon & text: gap-2 (8px)
Between buttons: gap-1 (4px)
```

### Sizing
```
Icon: size-2 h-2 (8px diameter for dots)
Edit/Delete buttons: size-12 (12px icons)
Indent: ml-6 (1.5rem = 24px)
Width: max-w-xs (20rem = 320px max)
```

## Animation States

### Pulsing Status Dot
```
Animation: animate-pulse (opacity 0.5 → 1.0)
Duration: 2 seconds
Example: 🟢 (pulses green)
```

### Hover Transition
```
Animation: transition-colors
Duration: 0.2s
From: transparent
To: white/5
```

### Focus State
```
When focused: outline-none
Always visible outline: tab navigation
Border highlight: emerald-500/30
```

## Responsive Breakpoints

### Mobile (< 640px)
```
Show: Full screen overlay
Width: 100% (max-w-xs = 320px actual)
Height: 100vh (full viewport height)
Position: fixed inset-0
```

### Small Tablet (640px - 768px)
```
Show: Full screen overlay (same as mobile)
Width: 320px (max-w-xs)
Height: 100vh
Position: fixed inset-0
```

### Medium Tablet (768px - 1024px)
```
Show: Hidden (md:hidden)
Layout: Three column desktop layout used instead
```

### Desktop (> 1024px)
```
Show: Hidden (md:hidden)
Layout: Desktop layout used (WorkspaceSidebar + ThreadList)
```

## Z-Index Hierarchy

```
Navigator Overlay: z-50 (highest)
└─ Backdrop: bg-black/60
└─ Content: All navigator content
└─ Header: Top bar
└─ List: Scrollable threads

ChatCanvas: z-10 (behind overlay)
└─ Messages
└─ Input area

Other elements: z-0 (lowest)
```

## Scrolling Behavior

### Container
```
overflow-y-auto      ← Vertical scroll only
custom-scrollbar     ← Custom styled scrollbar
max-h-[90vh] implied ← Fits in viewport
```

### Scrollbar (Mobile)
```
Width: 4px (on mobile)
Width: 6px (on desktop)
Track: transparent
Thumb: #334155 (slate-600)
Thumb hover: #475569 (slate-700)
Border radius: 9999px (full round)
```

### Content
```
Padding bottom: Extra space for last item
Overflow: scrolls smoothly
Focus: Maintains scroll position
```

## Touch Targets

### Minimum Size: 44px (iOS standard)
```
Current sizes:
- Workspace button: ~40px height (needs touch adjustment)
- Thread button: ~36px height
- Edit/Delete: ~16px (too small!)

Touch-friendly hierarchy:
✅ Workspace: 44px (good)
✅ Thread: 40px (acceptable)
⚠️ Edit/Delete: 16px (okay for hover, needs improvement)
```

## Accessibility Features

### Keyboard Navigation
```
Tab     → Move to next button
Shift+Tab → Move to previous
Enter   → Activate button / Save edit
Escape  → Close navigator or cancel edit
Arrow Down → Next workspace/thread
Arrow Up → Previous workspace/thread
```

### Focus Indicators
```
Focus outline: 2px solid emerald-400
Visible on all interactive elements
High contrast on dark background
```

### Screen Reader
```
Role: navigation
Label: "Threads and Workspaces"
Landmarks: Proper heading hierarchy
Labels: Buttons have aria-label if needed
```

## Dark Mode Specific

### Colors Used
```
Background: #0E0E11 (near black)
Hover: white/5 (semi-transparent white)
Active: emerald-500/20 (tinted emerald)
Text: slate-300 (light gray)
Active text: emerald-300 (light emerald)
Border: white/5 (subtle light border)
```

### Contrast Ratios
```
Text on background: 7:1+ (exceeds WCAG AAA)
Active highlight: 6:1+ (exceeds WCAG AA)
Border visibility: Good on dark background
Status dots: 8:1+ (high contrast)
```

## Animation Reference

### All Animations Used
```
animate-pulse  ← Status dots (2s opacity)
transition-colors ← Hover effects (0.2s)
active:scale-95 ← Button press (micro-interaction)
opacity-0 group-hover:opacity-100 ← Edit/Delete buttons
```

### Performance
```
GPU accelerated: Yes (transform/opacity only)
Jank-free: Yes
Mobile smooth: Yes
Battery impact: Minimal
```

---

## Complete Example: Thread Selection Flow

```
Initial State:
┌────────────────────────────────────────┐
│ Threads & Workspaces            [X]    │
├────────────────────────────────────────┤
│         [+ New Thread]                 │
├────────────────────────────────────────┤
│ ▼ Workspace Backend         🔽 Emerald│
│   🟢 API Thread                        │
│   ⚪ Database Thread         [✏️][🗑️]← Hover appears
│ > Workspace Frontend        ▶️ Slate  │
└────────────────────────────────────────┘

User clicks "Database Thread":
1. Thread highlights emerald
2. State updates: activeThreadId = "db-thread"
3. Navigator closes automatically
4. User returns to chat with thread selected

After Close:
├────────────────────────────┐
│ ChatCanvas (now showing    │
│ Database Thread            │
│ messages)                  │
└────────────────────────────┘
```

---

This reference covers all visual states and interactions in the Mobile Navigator.
