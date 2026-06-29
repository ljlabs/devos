# Mobile UI Implementation

## Overview

DevOS now has separate UI implementations for mobile and desktop, ensuring optimal UX on both form factors without breaking the existing desktop layout.

## Architecture

### Desktop Layout (Original - Preserved)
- 3-column layout: Workspace Sidebar | Threads | Chat Canvas
- Responsive Tailwind breakpoints (hidden on mobile via `hidden md:flex`)
- Fixed positioning for header/sidebar
- Original `App.tsx` component with all desktop logic

### Mobile Layout (New)
- Single-column stacked view with navigation states
- Separate components for mobile-optimized UX
- Touch-friendly controls and spacing
- Proper keyboard handling for mobile browsers
- No scrolling issues with virtual keyboard

## New Files

**Components** (`src/components/`):
- `MobileApp.tsx` - Mobile-specific app root, manages workspace → threads → chat navigation state
- `MobileWorkspaceSidebar.tsx` - Workspace selection screen (full-screen)
- `MobileThreadList.tsx` - Thread list screen (full-screen)
- `MobileChatCanvas.tsx` - Chat screen with mobile-optimized keyboard handling

**Documentation**:
- This file

## How It Works

1. **Responsive Detection** (`App.tsx`):
   ```typescript
   const [isMobile, setIsMobile] = useState(false);
   useEffect(() => {
     const checkMobile = () => setIsMobile(window.innerWidth < 768);
     window.addEventListener("resize", checkMobile);
   }, []);
   
   if (isMobile) return <MobileApp />;
   // Desktop layout...
   ```

2. **Mobile Navigation** (`MobileApp.tsx`):
   - State: `currentView = 'workspaces' | 'threads' | 'chat'`
   - Only one screen visible at a time
   - Back buttons navigate between screens
   - Stacked user interaction pattern

3. **Touch-Optimized Input**:
   - Larger buttons and touch targets
   - Textarea with proper keyboard handling
   - Fixed input area at bottom (doesn't get pushed off by keyboard)
   - Flex layout ensures content stays scrollable

## Key Features

### Mobile Advantages
- ✅ Full-screen, focused experience
- ✅ No horizontal scrolling
- ✅ Proper virtual keyboard handling
- ✅ Touch-friendly spacing (larger buttons, taller hit areas)
- ✅ Stacked navigation reduces cognitive load
- ✅ Input area stays visible with keyboard

### Desktop Preserved
- ✅ Original 3-column layout
- ✅ Multi-workspace and thread visibility
- ✅ No layout shifts
- ✅ Existing responsive design intact

## Breakpoint

- **Mobile**: `width < 768px` (md breakpoint)
- **Desktop**: `width >= 768px`

Resize behavior: Layout updates on resize without page reload.

## Testing

**Mobile Devices**:
- Test on actual phones (iOS Safari, Chrome, Firefox)
- Test virtual keyboard behavior (should not hide input)
- Test navigation between screens (back buttons)
- Verify scrolling in chat/logs

**Desktop**:
- Verify 3-column layout still works
- Check responsive behavior above 768px
- Ensure sidebar collapse still functions

## Shared Components

The following components are shared between mobile and desktop:
- `WorkspaceModal`, `SettingsModal` (Dialogs)
- `PermissionBubble` (permission requests)
- Markdown rendering (`MarkdownContent`)
- Message parsing (`getMessageContent`)

These are imported from `ChatCanvas.tsx` as named exports.

## Keyboard Handling

Mobile chat input uses:
- `visualViewport` API to track keyboard height
- `overscroll-behavior: contain` to prevent scroll jank
- Flex layout ensures input stays anchored at bottom
- Textarea auto-expands as user types (max 120px)

## Future Enhancements

- Add PWA support (manifest, service worker)
- Haptic feedback on button presses
- Dark mode toggle
- Landscape orientation optimizations
- Bottom navigation bar (if needed)

## Files Not Modified

- `index.css` - Reverted to original (working state)
- `index.html` - Reverted to original
- `ChatCanvas.tsx` - Only added named exports at end
- Desktop components - Untouched

## Related Steering

See `.kiro/steering/project-context.md` for architecture overview.
