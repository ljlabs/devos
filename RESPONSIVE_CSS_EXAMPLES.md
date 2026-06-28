# Responsive CSS Examples - DevOS Mobile Updates

## Common Responsive Patterns Used

### 1. Hidden/Visible by Breakpoint

**Hide on Mobile, Show on Tablet+:**
```jsx
<div className="hidden md:flex">
  {/* Only visible on md (768px) and larger */}
  <WorkspaceSidebar />
</div>
```

**Show on Mobile, Hide on Tablet+:**
```jsx
<button className="md:hidden p-1.5 hover:bg-white/5 rounded-md">
  {/* Menu button only visible on mobile */}
  <Menu size={18} />
</button>
```

### 2. Responsive Sizing

**Button/Icon Sizing:**
```jsx
{/* Small on mobile, large on desktop */}
<button className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl">
  <Send size={14} className="sm:w-4 sm:h-4" />
</button>
```

**Padding/Margin:**
```jsx
{/* Tight spacing on mobile, relaxed on desktop */}
<div className="p-2 sm:p-4 px-3 sm:px-6">
  {/* 8px padding on mobile, 16px on sm, 24px horizontal on desktop */}
</div>
```

### 3. Responsive Typography

**Font Size Scaling:**
```jsx
<h1 className="text-base sm:text-lg md:text-xl text-white">
  {/* 16px → 18px → 20px across breakpoints */}
  Welcome to DevOS
</h1>

<p className="text-xs sm:text-sm text-slate-400">
  {/* 12px → 14px across breakpoints */}
  Select a project workspace...
</p>
```

### 4. Responsive Layout Direction

**Flex Direction Change:**
```jsx
<div className="flex flex-col md:flex-row gap-2 md:gap-4">
  {/* Stacked on mobile, side-by-side on desktop */}
  <ThreadList />
  <ChatCanvas />
</div>
```

**Alignment Changes:**
```jsx
<div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4">
  {/* Column layout on mobile, row on desktop, alignment adjusts */}
</div>
```

### 5. Content Width & Max-Width

**Responsive Max-Width:**
```jsx
<div className="max-w-[85%] sm:max-w-[80%] md:max-w-2xl">
  {/* Wider bubble on mobile to use more screen space */}
  {/* Narrower on larger screens for visual balance */}
</div>
```

### 6. Responsive Visibility of Content

**Truncate vs Break:**
```jsx
<span className="truncate md:break-words">
  {/* Truncated on mobile, break across lines on desktop */}
  Thread title or long text
</span>
```

**Hide Elements Selectively:**
```jsx
<span className="hidden sm:inline">Full Text</span>
<span className="sm:hidden">Short</span>
{/* Shows "Short" on mobile, "Full Text" on sm and up */}
```

## Real Examples from DevOS

### ChatCanvas Header
```jsx
<header className="h-12 sm:h-14 flex items-center justify-between px-3 sm:px-6 border-b border-white/5">
  {/* Height: 48px mobile, 56px desktop */}
  {/* Padding: 12px mobile, 24px desktop */}
  
  <button className="md:hidden p-1.5">
    {/* Menu button only on mobile */}
  </button>
  
  <div className="hidden sm:block">
    <Bot size={18} />
  </div>
  
  <button className="px-2 sm:px-3 py-1 sm:py-1.5 text-xs font-bold">
    {/* Button padding and text scale */}
    Deploy
  </button>
</header>
```

### Message Bubble
```jsx
<div className="flex justify-end max-w-4xl mx-auto w-full px-2 sm:px-0">
  <div className="max-w-[85%] sm:max-w-[80%] bg-[#18181B] border border-white/5 p-3 sm:p-4 rounded-lg sm:rounded-2xl text-xs sm:text-sm">
    {/* Container padding on phones: 12px, desktop: 16px */}
    {/* Message max-width: 85% on mobile (uses more space), 80% on desktop */}
    {/* Text: 12px on mobile, 14px on desktop */}
    {/* Border radius: smaller on mobile (lg) larger on desktop (2xl) */}
  </div>
</div>
```

### Input Area
```jsx
<div className="absolute bottom-0 left-0 w-full p-2 sm:p-4 bg-gradient-to-t from-[#0B0B0C]">
  <div className="max-w-4xl mx-auto px-2 sm:px-0 relative group">
    <div className="relative bg-[#0E0E11] border border-white/10 rounded-lg sm:rounded-xl p-2 sm:p-3 flex items-end gap-2 sm:gap-3">
      {/* Padding: 8px mobile, 16px desktop */}
      {/* Gap: 8px mobile, 12px desktop */}
      {/* Border radius: sm on mobile, larger on desktop */}
      
      <button className="p-1 sm:p-1.5 text-slate-500">
        <Paperclip size={14} className="sm:w-4 sm:h-4" />
      </button>
      
      <textarea
        className="text-xs sm:text-sm font-sans"
        style={{ minHeight: "32px" }} // smaller on mobile
      />
      
      <button className="w-8 h-8 sm:w-10 sm:h-10">
        <Send size={14} className="sm:w-4 sm:h-4" />
      </button>
    </div>
  </div>
</div>
```

### Modal Dialog
```jsx
<div className="fixed inset-0 bg-black/60 p-3 sm:p-4 z-50">
  <div className="bg-[#0E0E11] rounded-lg sm:rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
    {/* Padding: 12px mobile, 16px desktop */}
    {/* Border radius: smaller on mobile, larger on desktop */}
    {/* Max height ensures content fits in viewport with scrolling */}
    
    <form className="p-4 sm:p-6 space-y-4">
      <input
        className="text-xs sm:text-sm"
        style={{ fontSize: "16px" }} // prevents zoom on mobile
      />
    </form>
  </div>
</div>
```

### Layout Container
```jsx
<div className="flex flex-col md:flex-row h-screen w-screen overflow-hidden bg-[#0B0B0C]">
  {/* flex-col on mobile (stacked), md:flex-row on desktop (side-by-side) */}
  
  <div className="hidden md:flex">
    {/* Workspace Sidebar: hidden on mobile, visible on md+ */}
    <WorkspaceSidebar />
  </div>

  <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
    {/* Main content area */}
    
    <div className="hidden md:flex md:w-64">
      {/* Thread List: hidden on mobile, visible on md+ */}
      <ThreadList />
    </div>

    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Chat Canvas: full width on mobile, adjusted on desktop */}
      <ChatCanvas />
    </div>
  </div>
</div>
```

## Responsive Utilities Cheat Sheet

```
/* Sizing */
w-8 h-8        → 32px mobile
sm:w-10 sm:h-10 → 40px at 640px+

/* Padding */
p-2 sm:p-4     → 8px mobile, 16px at 640px+
px-3 sm:px-6   → 12px x mobile, 24px x at 640px+

/* Text Size */
text-xs sm:text-sm      → 12px mobile, 14px at 640px+
text-base sm:text-lg    → 16px mobile, 18px at 640px+

/* Visibility */
hidden md:flex  → Hidden < 768px, visible ≥ 768px
md:hidden       → Visible < 768px, hidden ≥ 768px

/* Gap/Spacing */
gap-2 sm:gap-3  → 8px mobile, 12px at 640px+

/* Border Radius */
rounded-lg sm:rounded-xl → 8px mobile, 12px at 640px+

/* Width Constraint */
max-w-[85%] sm:max-w-[80%] → 85% mobile, 80% at 640px+
```

## Breakpoint Reference

```javascript
// Tailwind CSS breakpoints (used in DevOS)
const breakpoints = {
  default: '0px',      // Mobile first
  sm: '640px',         // Small devices
  md: '768px',         // Medium devices (tablets)
  lg: '1024px',        // Large devices (desktops)
  xl: '1280px',        // Extra large
  '2xl': '1536px'      // 2X extra large
}
```

## Common Mobile Issues & Fixes

### Issue: Input causes zoom on mobile
```jsx
// ❌ Bad - 14px font allows zoom
<input className="text-xs" />

// ✅ Good - 16px prevents zoom
<input className="text-xs sm:text-sm" style={{ fontSize: "16px" }} />
```

### Issue: Text too cramped on mobile
```jsx
// ❌ Bad - No responsive padding
<div className="p-4">

// ✅ Good - Tighter on mobile
<div className="p-2 sm:p-4">
```

### Issue: Buttons hard to tap on mobile
```jsx
// ❌ Bad - Too small on mobile
<button className="w-6 h-6">

// ✅ Good - 32px minimum on mobile
<button className="w-8 h-8 sm:w-10 sm:h-10">
```

### Issue: Sidebar always visible on mobile
```jsx
// ❌ Bad - Always visible
<div><WorkspaceSidebar /></div>

// ✅ Good - Hidden on mobile
<div className="hidden md:flex"><WorkspaceSidebar /></div>
```

## Testing Responsive Styles

```javascript
// Browser DevTools - Toggle device toolbar
// Keyboard shortcut: Ctrl+Shift+M (Windows/Linux) or Cmd+Shift+M (Mac)

// Test specific breakpoint widths:
// 375px (iPhone SE)
// 390px (iPhone 12/13/14)
// 768px (iPad)
// 1024px (iPad Pro)
// 1440px (Desktop)
```

## Performance Tips

✅ **Good**: Use media queries instead of JavaScript
✅ **Good**: Use class names for responsive values
✅ **Good**: Tailwind handles media query optimization
✅ **Avoid**: Multiple `@media` queries in CSS
✅ **Avoid**: JavaScript window.matchMedia listeners for simple layouts

## Reference

- [Tailwind CSS Responsive Design](https://tailwindcss.com/docs/responsive-design)
- [MDN Media Queries](https://developer.mozilla.org/en-US/docs/Web/CSS/Media_Queries)
- [Mobile First Design](https://www.uxmatters.com/articles/Mobile-First-Design)
