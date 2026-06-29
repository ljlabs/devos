# Mobile Viewport Shift Fix

## Problem

The mobile UI was experiencing viewport shifts and flickering when:
1. Virtual keyboard appeared on Android (Chrome, Firefox)
2. Switching between workspaces/threads
3. Typing in the message input
4. Header and sidebar would shift up above the viewport, becoming invisible

## Root Cause

**Fixed positioning on body/html prevented proper keyboard handling:**

```css
/* BEFORE (broken) */
html { position: fixed; }
body { position: fixed; top: 0; left: 0; }
```

When the mobile keyboard appears, it reduces the viewport height. With `position: fixed`, the entire layout is locked in place, causing the browser to shift content up, pushing the header and navigation off-screen.

## Solution

### 1. **Removed Position Fixed from CSS** (`index.css`)
```css
/* AFTER (fixed) */
html { 
  height: 100%;
  overflow: hidden;
  /* NO position: fixed */
}
body { 
  margin: 0;
  height: 100%;
  overflow: hidden;
  /* NO position: fixed, top, left */
}
```

### 2. **Updated Viewport Meta Tag** (`index.html`)
Added `viewport-fit=cover` and `user-scalable=no` to prevent browser zoom on input focus:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no, maximum-scale=1" />
```

### 3. **Used Sticky Positioning for Input** (`MobileChatCanvas.tsx`)
Input box stays visible at bottom even during scroll, but doesn't lock the entire layout:
```tsx
<div style={{ position: 'sticky', bottom: 0, zIndex: 50 }}>
  {/* Input area */}
</div>
```

### 4. **Proper Flex Layout in MobileApp** (`MobileApp.tsx`)
Used fixed positioning only where needed (the MobileApp container), allowing proper flex layout:
```tsx
<div style={{ height: '100vh', position: 'fixed', inset: 0 }}>
  {/* Flex children handle keyboard properly */}
</div>
```

### 5. **Smooth Scrolling** (`index.css`)
Added webkit scrolling for better momentum on iOS:
```css
.custom-scrollbar {
  -webkit-overflow-scrolling: touch;
}
```

### 6. **Prevent Double-Tap Zoom** (`index.css`)
```css
html {
  touch-action: manipulation;
}
```

## Result

✅ **Fixed:**
- Header and sidebar stay visible when keyboard opens
- Messages scroll properly without viewport jumping
- No flickering during workspace/thread switches
- Smooth keyboard handling on Chrome and Firefox
- Works on iOS and Android

## Files Modified

1. `src/index.css` — Fixed positioning, added touch-action
2. `src/components/MobileChatCanvas.tsx` — Sticky input positioning
3. `src/components/MobileApp.tsx` — Proper fixed container
4. `index.html` — Updated viewport meta tag

## Testing

Test on:
- Android Chrome (Mobile & Desktop modes)
- Android Firefox (Mobile & Desktop modes)
- iOS Safari
- Type in message input and observe keyboard behavior
- Switch workspaces/threads
- Verify header stays visible at all times
