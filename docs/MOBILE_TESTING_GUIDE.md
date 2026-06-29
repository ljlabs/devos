# Mobile Testing Guide

This guide helps you verify that mobile UI keyboard and scrolling issues are fixed.

## Quick Test (5 minutes)

### Using Chrome DevTools
1. Open DevTools (`F12`)
2. Click Device Toolbar icon (or `Ctrl+Shift+M`)
3. Select a device (e.g., "Pixel 5" or "iPhone 12")
4. Refresh the page

### Test Keyboard Behavior
1. Click in the message input field
2. Start typing — **Watch for**: No jump or shift in the UI
3. Type a longer message — **Watch for**: No white space below keyboard
4. Press `Esc` to close keyboard — **Watch for**: Content smoothly scrolls to show bottom

### Test Scrolling
1. Create a new thread (if needed)
2. Send several messages to generate conversation
3. Scroll up to read older messages while keyboard is open
4. Scroll back down — **Watch for**: Smooth scrolling, no flicker
5. Send a new message — **Watch for**: Auto-scroll to bottom is smooth

## Full Test Suite (15 minutes)

### 1. Keyboard Open/Close Behavior
**Expected**: No layout shift, no white space appears/disappears

- [ ] **Chrome Mobile**
  - [ ] Type in input
  - [ ] Watch keyboard appear
  - [ ] Confirm UI stays in place
  - [ ] Close keyboard with system button
  - [ ] Confirm UI scrolls to show messages

- [ ] **Firefox Mobile**
  - [ ] Repeat steps above
  - [ ] **Note**: May see slight flicker (expected, reduced with fix)

- [ ] **Safari/iOS** (if available)
  - [ ] Repeat steps above
  - [ ] Test with notch/safe areas
  - [ ] Confirm safe area insets respected

### 2. Scrolling During Input
**Expected**: Smooth scrolling, no content hidden above viewport

- [ ] Long message thread (10+ messages)
- [ ] Open keyboard
- [ ] Scroll up to read old messages
- [ ] **Watch for**: Header remains visible, scrolling is smooth
- [ ] Scroll back down
- [ ] **Watch for**: No flicker or jump

### 3. Navigation Transitions
**Expected**: No UI shift when switching workspaces/threads

- [ ] Open mobile view
- [ ] Select workspace → threads view
- [ ] **Watch for**: Smooth transition, no flicker
- [ ] Select thread → chat view
- [ ] **Watch for**: No shift or jump
- [ ] Back to threads
- [ ] **Watch for**: Smooth animation

### 4. Long Conversations
**Expected**: Can scroll indefinitely without UI breaking

- [ ] Create thread with 20+ messages
- [ ] Scroll up completely
- [ ] **Watch for**: Header always visible
- [ ] Scroll back to bottom
- [ ] **Watch for**: Auto-scroll works smoothly
- [ ] Send new message
- [ ] **Watch for**: New message appears, scroll is smooth

### 5. Input Field Behavior
**Expected**: Input expands as needed, doesn't overflow

- [ ] Type single line message
- [ ] **Watch for**: Input height correct
- [ ] Type 5-line message (with enters)
- [ ] **Watch for**: Input expands but stays visible, max height respected (120px)
- [ ] Type 10+ lines
- [ ] **Watch for**: Input stops expanding at max height, scrolls internally

### 6. Permission Bubbles
**Expected**: Buttons clickable, no scroll issues

- [ ] Trigger a permission request (if possible)
- [ ] Open keyboard
- [ ] **Watch for**: Permission bubble stays visible
- [ ] Scroll to see buttons
- [ ] **Watch for**: Smooth scrolling, buttons clickable
- [ ] Click "Allow" or "Deny"
- [ ] **Watch for**: No layout shift when response sent

## Browser-Specific Tests

### Chrome Mobile DevTools
```
Simulating: Pixel 5, iPhone 12, Galaxy S21
Keyboard: Press Esc to toggle
```

**Test Steps**:
1. Device Toolbar → Select device
2. Refresh page
3. Wait for workspaces to load
4. Navigate through UI
5. Type messages with keyboard visible
6. Verify no scroll or layout issues

### Firefox Mobile
```
Download: Firefox for Android
```

**Test Steps**:
1. Install app from Play Store
2. Navigate to `http://localhost:3000` (or deployed URL)
3. Repeat keyboard and scrolling tests
4. **Expected**: May see slight flicker (reduced with debounce)

### Safari/iOS
```
Device: iPhone or iPad
```

**Test Steps**:
1. Open Safari
2. Navigate to deployed URL
3. Test keyboard behavior
4. Test scrolling
5. **Expected**: Smooth experience, safe areas respected

## Real Device Testing

### Android (Chrome/Firefox)
1. Connect device via USB (or WiFi)
2. Open mobile browser
3. Navigate to `http://<your-machine-ip>:3000`
4. Repeat test suite above

### iOS (Safari)
1. On iOS device, open Safari
2. Navigate to deployed URL
3. Repeat test suite above

## Debugging

### Console Errors
If you see errors, check:
- Browser console (`F12` → Console tab)
- Network tab for failed API calls
- React DevTools for component errors

### Common Issues
| Issue | Solution |
|-------|----------|
| Keyboard not showing in DevTools | Press `Esc` to toggle |
| White screen on load | Check browser console for React errors |
| Infinite scroll loop | Check that `isNearBottom()` threshold is correct (120px) |
| UI shift on keyboard open | Verify `visualViewport` API is working |

### Viewport Debugging
```javascript
// In browser console on mobile:
window.visualViewport.height        // Should change when keyboard opens
window.innerHeight                  // Should stay constant
window.visualViewport.scale         // Device pixel ratio
```

## Performance Baseline

Expected metrics (Chrome DevTools Performance tab):

| Metric | Target | Notes |
|--------|--------|-------|
| FCP (First Contentful Paint) | < 2s | Messages appear quickly |
| LCP (Largest Contentful Paint) | < 3s | No layout shift |
| CLS (Cumulative Layout Shift) | < 0.1 | Verify keyboard doesn't cause shift |
| TTI (Time to Interactive) | < 3s | Should be responsive quickly |

## Regression Tests

Run these after any UI changes:

- [ ] Mobile keyboard still works smoothly
- [ ] Desktop UI unchanged
- [ ] No console errors
- [ ] Messages render correctly
- [ ] Input field focuses properly
- [ ] Scrolling is smooth
- [ ] No memory leaks (check DevTools Memory tab)

## Success Criteria

✅ **Mobile fixes are working if**:
1. Keyboard opens without UI jumping
2. No white space appears between keyboard and app
3. Header stays visible while scrolling
4. Scrolling is smooth (no flicker on Firefox)
5. Input field expands smoothly
6. Can send and receive messages without issues
7. Switching workspaces/threads doesn't cause flicker
8. Long conversations scroll smoothly

❌ **Issues to report if**:
1. UI jumps when keyboard appears/disappears
2. Header disappears above viewport
3. White space appears between keyboard and app
4. Scrolling is jerky or flickering
5. Input field doesn't expand properly
6. Navigation causes layout shifts

## Video Recording

For detailed bug reports, record:
1. Device and browser (e.g., "iPhone 12, Safari")
2. Steps to reproduce
3. Expected vs actual behavior
4. Any console errors

Use mobile screen recording:
- **Android**: Android Studio emulator, Android 14+
- **iOS**: Xcode simulator, or use QuickTime
- **Desktop DevTools**: F12 → Device Toolbar → Record video

## References

- [MDN: visualViewport API](https://developer.mozilla.org/en-US/docs/Web/API/visualViewport)
- [CSS Tricks: 100dvh](https://css-tricks.com/the-small-viewports-unit/)
- [Chrome DevTools: Device Toolbar](https://developer.chrome.com/docs/devtools/device-mode/)
