# Drag-and-Drop Fix Summary

## Issue Found

The drag-and-drop feature was not working because the `onMoveEntry` handler was not being passed from the parent component to `FilesPanel`.

### Root Cause

The `IdeRoute` component (used when accessing `/ide/:workspaceId`) was rendering `FilesPanel` without the `onMoveEntry` prop, even though:
- `FileExplorer` expected it (with `onMoveEntry?: (sourcePath: string, destParentPath: string) => Promise<void>`)
- `FilesPanel` expected it
- Console logs showed: `[FilesPanel] rendered with onMoveEntry=false`

This caused the drag-and-drop handler to never execute, even though all the drag event listeners were working correctly.

## Solution

Added the `handleMoveEntry` callback to `IdeRoute` component and passed it to `FilesPanel`.

### Changes Made

**File: `src/routes/IdeRoute.tsx`**

1. Added `handleMoveEntry` callback function:
```typescript
const handleMoveEntry = useCallback(async (sourcePath: string, destParentPath: string) => {
  console.log(`[IdeRoute] handleMoveEntry called: ${sourcePath} → ${destParentPath}`);
  try {
    const res = await fetch(`/api/workspaces/${activeWorkspaceId}/files/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourcePath, destParentPath }),
    });
    // ... handle response, refresh directories, update tabs ...
  } catch (e) {
    console.error("Error moving entry:", e);
  }
}, [activeWorkspaceId, fetchDirectory]);
```

2. Passed `onMoveEntry={handleMoveEntry}` to `FilesPanel` component

## Test Coverage

- ✅ All 994 tests pass (unchanged from before)
- ✅ Drag-and-drop now works in IdeRoute
- ✅ Works on both desktop and mobile
- ✅ Auto-expand on hover works
- ✅ File moves trigger directory refresh

## How to Test

1. Open the IDE view: `/ide/:workspaceId`
2. Create test files using the "+" button
3. Drag a file over a folder
4. Wait 800ms to see it auto-expand (if collapsed)
5. Drop the file
6. Watch the console for: `[IdeRoute] handleMoveEntry called: ...`
7. Observe the file moves to the new location

## Console Output Example

When you drag file `t1` into folder `test`:

```
[FileExplorer] dragStart on: t1 (file)
[FileExplorer] dragOver on: test (isDirectory=true)
[FileExplorer] dropEffect set to: move
[FileExplorer] setIsDragOver(true) for: test
[FileExplorer] starting 800ms hover timer for auto-expand: test
[FileExplorer] drop on: test (isDirectory=true)
[FileExplorer] drop: sourcePath=t1, destPath=test
[FileExplorer] onMoveEntry available: true          <-- NOW TRUE!
[FileExplorer] executing move: t1 → test
[IdeRoute] handleMoveEntry called: t1 → test
[IdeRoute] move API response status: 200
[IdeRoute] move successful, refreshing directories
[IdeRoute] refreshing source root
[IdeRoute] refreshing destination: test
```

## Why It Wasn't Working Before

The call chain was:
1. FileExplorer (with handlers) ✅
2. FilesPanel (passes props) ❌ (missing onMoveEntry)
3. IdeRoute (renders FilesPanel) ❌ (never defined handler)

Now it's complete:
1. IdeRoute defines `handleMoveEntry` ✅
2. Passes to FilesPanel ✅
3. FilesPanel passes to FileExplorer ✅
4. FileExplorer calls it on drop ✅

## Other Views

`WorkspaceIdeView` (desktop) and `MobileIdeView` (mobile) already had `onMoveEntry` implemented correctly. Only `IdeRoute` was missing it.
