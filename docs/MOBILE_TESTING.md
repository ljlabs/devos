# Mobile UI Testing Guide

## What Was Fixed

The mobile UI had a white screen because React hooks were being called conditionally (after the mobile check). This violates React's hook rules. 

**Fix**: Moved all `useState` and `useRef` declarations BEFORE the mobile detection check, so hooks are always called in the same order.

## How to Test

### Desktop (should work as before)
- Open DevOS in a desktop browser (width >= 768px)
- Should show 3-column layout: Workspaces | Threads | Chat
- All existing features working

### Mobile (new stacked layout)
- Open DevOS on mobile device or resize browser to < 768px
- Should show full-screen workspace list
- Click workspace → see threads
- Click thread → see chat
- Back buttons navigate between screens
- No white screen (was the bug)

### Resize Detection
- Resize browser between 768px and below
- Layout should switch automatically between desktop and mobile
- No page reload needed

## Testing Checklist

- [ ] Desktop: 3-column layout visible
- [ ] Desktop: Workspace/thread switching works
- [ ] Desktop: Chat messages display
- [ ] Mobile: Workspace list shows
- [ ] Mobile: Workspace selection → threads list
- [ ] Mobile: Thread selection → chat
- [ ] Mobile: Back buttons work
- [ ] Mobile: Input area stays visible with keyboard
- [ ] Mobile: Chat scrolls properly
- [ ] Resize: Layout switches without reload

## Known Limitations (Mobile)

- Global activity log not shown (can add if needed)
- Deploy button hidden (kept in chat view only)
- Console logs are collapsible (not full view)

## If Still White Screen

1. Check browser console (F12 → Console tab)
2. Look for JavaScript errors
3. Check if server is running (should see network requests in Network tab)
4. Try hard refresh (Ctrl+Shift+R)
5. Clear cache if needed
