# Mobile Keyboard & Scrolling Issues — Fixed

## Problems Addressed

### 1. **UI Jumping When Keyboard Opens**
- **Cause**: `window.innerHeight` includes the mobile keyboard, causing the viewport to change
- **Solution**: Use `visualViewport.height` instead — this excludes the keyboard and remains stable

### 2. **UI Shifting Up Slowly Until Header Disappears**
- **Cause**: Cumulative layout shifts from:
  - `height: 100vh` being recalculated when keyboard opens
  - Missing `height: 100dvh` (dynamic viewport height) fallback
  - Input field not using `position: relative` or proper layout
- **Solution**:
  - Use `100dvh` which dynamically adjusts for keyboard presence
  - Proper CSS containment with `overflow-y: auto` instead of scroll
  - Fixed input area that respects the viewport

### 3. **White Space Below Keyboard**
- **Cause**: Empty space due to incorrect viewport calculations
- **Solution**: Use `visualViewport` API to properly constrain the scrollable area

### 4. **Flickering on Firefox Mobile**
- **Cause**: Re-renders from scroll position changing during keyboard state changes
- **Solution**: 
  - Debounced resize handlers
  - `overscroll-behavior: contain` to prevent bounce scrolling
  - Delay scroll-to-bottom to allow layout to settle

## Implementation Details

### CSS Changes (`src/index.css`)
```css
html {
  height: 100%;
  width: 100%;
  position: fixed;
}

body {
  height: 100vh;
  height: 100dvh; /* Dynamic viewport height — keyboard-aware */
  position: fixed;
  overscroll-behavior: none;
}

#root {
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
```

### Viewport Meta Tag (`index.html`)
```html
<meta name="viewport" 
      content="width=device-width, 
               initial-scale=1.0, 
               viewport-fit=cover,
               user-scalable=no, 
               maximum-scale=1" />
```

Key settings:
- `viewport-fit=cover`: Use safe area on notched devices
- `user-scalable=no`: Prevent double-tap zoom (prevents layout shift)
- `maximum-scale=1`: Prevent zoom which changes viewport

### Mobile Chat Component (`src/components/MobileChatCanvas.tsx`)

**Keyboard Detection**:
```typescript
// Detect if keyboard is open
useEffect(() => {
  const updateKeyboardState = () => {
    if (window.visualViewport) {
      const heightRatio = window.visualViewport.height / window.innerHeight;
      setIsKeyboardOpen(heightRatio < 0.75); // Keyboard likely open
    }
  };

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateKeyboardState);
  }
}, []);
```

**Input Area**:
```typescript
// Uses relative positioning, not position: fixed
// Flex layout ensures it stays at bottom of scrollable content
<div 
  className="flex-shrink-0 p-3 bg-gradient-to-t from-[#0B0B0C]"
  style={{ position: 'relative' }}
>
  {/* Input field */}
</div>
```

**Scroll Container**:
```typescript
// Uses overscroll-behavior to prevent iOS bounce
<div
  ref={scrollContainerRef}
  className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0"
  style={{ 
    overscrollBehavior: 'contain',
    WebkitOverflowScrolling: 'touch'
  }}
>
```

**Auto-scroll with Delay**:
```typescript
useEffect(() => {
  // Delay to allow layout to settle after keyboard change
  const timeout = setTimeout(() => {
    if (isNearBottom()) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, 100);

  return () => clearTimeout(timeout);
}, [messages]);
```

## Mobile Viewport Utility (`src/utils/mobileViewport.ts`)

Provides helpers for:
- `isKeyboardOpen()` — Detect if keyboard is open
- `getSafeViewportHeight()` — Get keyboard-aware viewport height
- `onViewportChange()` — Subscribe to keyboard open/close events
- `preventScrollRestoration()` — Prevent scroll jumping on reload
- `setupMobileScrolling()` — Apply containment CSS

## Browser Support

- **Chrome/Edge Mobile**: Full support
- **Firefox Mobile**: Full support (flicker reduced with debouncing)
- **Safari/iOS**: Full support including notch handling

## Testing on Mobile

**Chrome DevTools**:
1. Open DevTools → Device toolbar
2. Select device (e.g., "Pixel 5")
3. Simulate keyboard with `Esc` key

**Real Device**:
1. Deploy to mobile browser
2. Type in input field — watch keyboard appear
3. Scroll messages — no shift should occur
4. Switch between workspaces — no flicker

## References

- [visualViewport API](https://developer.mozilla.org/en-US/docs/Web/API/visualViewport)
- [100dvh CSS Unit](https://web.dev/viewport-units/#dvh)
- [overscroll-behavior](https://developer.mozilla.org/en-US/docs/Web/CSS/overscroll-behavior)
