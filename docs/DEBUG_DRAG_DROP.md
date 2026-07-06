# Debugging Drag-and-Drop File Browser

## Quick Fix If onMoveEntry is false

If your console shows `[FilesPanel] rendered with onMoveEntry=false`:

**The parent component isn't passing the move handler!**

Check that your component:
1. Defines `handleMoveEntry` callback
2. Passes it to `<FilesPanel onMoveEntry={handleMoveEntry} />`

Example:
```typescript
const handleMoveEntry = useCallback(async (sourcePath: string, destParentPath: string) => {
  const res = await fetch(`/api/workspaces/${workspaceId}/files/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourcePath, destParentPath }),
  });
  // ... refresh directories ...
}, [workspaceId, fetchDirectory]);

<FilesPanel ... onMoveEntry={handleMoveEntry} />
```

---

## Opening the Browser Console

To see drag-and-drop logs, open the browser developer console:

- **Chrome/Edge/Firefox**: `F12` or `Ctrl+Shift+I` (Windows/Linux) or `Cmd+Option+I` (Mac)
- **Safari**: `Cmd+Option+U`
- Navigate to the **Console** tab

## Console Log Output

When dragging and dropping files, you'll see detailed logs like:

### Example: Dragging a file named `hello.txt` into a folder named `src`

**Desktop Console Output:**

```
[FilesPanel] rendered with onMoveEntry=true
[FileTreeItem] mounted/updated: hello.txt (dir=false, expanded=false, dragOver=false)
[FileTreeItem] mounted/updated: src (dir=true, expanded=false, dragOver=false)

// User starts dragging hello.txt
[FileExplorer] dragStart on: hello.txt (file)
[FileExplorer] dataTransfer effectAllowed set to: move
[FileExplorer] setData: path=hello.txt, type=file

// User drags over src folder
[FileExplorer] dragOver on: src (isDirectory=true)
[FileExplorer] dropEffect set to: move
[FileExplorer] setIsDragOver(true) for: src
[FileExplorer] starting 800ms hover timer for auto-expand: src

// Wait 800ms... folder auto-expands
[FileExplorer] hover timeout fired - expanding: src
[FileTreeItem] mounted/updated: src (dir=true, expanded=true, dragOver=true)

// User drops file on src
[FileExplorer] drop on: src (isDirectory=true)
[FileExplorer] drop: sourcePath=hello.txt, destPath=src
[FileExplorer] onMoveEntry available: true
[FileExplorer] executing move: hello.txt → src

// Move handler is called
[WorkspaceIdeView] handleMoveEntry called: hello.txt → src
[WorkspaceIdeView] move API response status: 200
[WorkspaceIdeView] move successful, refreshing directories
[WorkspaceIdeView] refreshing source root
[WorkspaceIdeView] refreshing destination: src
```

## Troubleshooting Common Issues

### Issue: Drag events not firing

**Check in console:**
```
[FileExplorer] dragStart on: file.txt (file)
```

**If you don't see this:**
- Make sure you're dragging on an actual file/folder entry, not empty space
- Check that `draggable={!inlineEdit}` is working (not in edit mode)
- Try right-clicking on the item to confirm it's a valid entry

### Issue: Folder not auto-expanding on hover

**Check in console:**
```
[FileExplorer] dragOver on: my-folder (isDirectory=true)
[FileExplorer] starting 800ms hover timer for auto-expand: my-folder
[FileExplorer] hover timeout fired - expanding: my-folder
```

**If you see the first two lines but NOT the third:**
- You moved the mouse away before 800ms elapsed
- Try hovering for a full second without moving
- The timeout message should appear when you've waited long enough

**If you don't see any dragOver logs:**
- You may be dragging over a file instead of a folder
- Check that the console shows `isDirectory=true` for the target

### Issue: Drop not executing (no file movement)

**Check in console:**
```
[FileExplorer] drop on: my-folder (isDirectory=true)
[FileExplorer] drop: sourcePath=hello.txt, destPath=my-folder
[FileExplorer] onMoveEntry available: true
[FileExplorer] executing move: hello.txt → my-folder
[WorkspaceIdeView] handleMoveEntry called: hello.txt → my-folder
[WorkspaceIdeView] move API response status: 200
```

**If you see "onMoveEntry available: false":**
- The move handler wasn't passed to FileExplorer
- Check that FilesPanel is receiving `onMoveEntry` from parent component

**If you see "move API response status: 404 or 500":**
- Server-side error occurred
- Check server logs for error details
- Verify workspace ID is correct

**If you don't see the handleMoveEntry log:**
- onMoveEntry callback might not be bound correctly
- Check parent component (WorkspaceIdeView or MobileIdeView)

### Issue: Drag leaves folder but doesn't clear highlight

**Check in console:**
```
[FileExplorer] dragLeave on: my-folder
[FileExplorer] dragLeave matches itemRef, clearing hover state for: my-folder
```

**If you see "dragLeave on different element":**
- The drag event is propagating through child elements
- This is expected behavior, highlight will clear on next dragLeave that matches

## Testing Tips

### Manual Testing Checklist

1. **Create test files and folders:**
   - Open file browser
   - Use "+" button to create test files: `test1.txt`, `test2.txt`
   - Use "+" button to create test folder: `test-folder`

2. **Test basic drag-drop:**
   - Drag `test1.txt` to `test-folder`
   - Watch console for: dragStart → dragOver → drop
   - Verify file moves in UI

3. **Test hover expansion:**
   - Create nested folder: `test-folder/sub-folder`
   - Drag `test2.txt` onto `test-folder` (collapsed)
   - Wait 800ms and watch folder expand
   - Drop the file into sub-folder

4. **Test multiple moves:**
   - Move file from root to folder: `test1.txt` → `test-folder/`
   - Then move from folder back to root: `test-folder/test1.txt` → root
   - Check console for smooth operation

5. **Test error handling:**
   - Try to drag a file onto itself (should ignore)
   - Check console for: "source and dest are same, ignoring"

## Network Debugging

If move operations fail silently:

1. Open **Network** tab in developer tools
2. Drag and drop a file
3. Look for `POST` request to `/api/workspaces/*/files/move`
4. Click on the request and check:
   - **Request**: Body should contain `sourcePath` and `destParentPath`
   - **Response**: Should be `{ ok: true, entry: {...} }`
   - **Status**: Should be 200

### Example Network Request

```json
POST /api/workspaces/ws-1/files/move

Request Body:
{
  "sourcePath": "hello.txt",
  "destParentPath": "src"
}

Response:
{
  "ok": true,
  "entry": {
    "name": "hello.txt",
    "path": "src/hello.txt",
    "type": "file",
    "size": 100,
    "modified": "2025-01-15T10:30:00Z"
  }
}
```

## Performance Monitoring

Drag-and-drop operations should be fast. Check console for timing:

```
[FileExplorer] dragStart on: file.txt (file)
// ... drag events ...
[WorkspaceIdeView] move successful, refreshing directories  // <-- happens in milliseconds
```

If it takes >500ms, there may be a network or state update delay.

## Enabling/Disabling Debug Logs

Currently all logs are always on. To disable in production:

Option 1 (Conditional logging):
```typescript
const DEBUG = process.env.NODE_ENV === 'development';
if (DEBUG) console.log(...);
```

Option 2 (Add logLevel):
```typescript
const LOG_LEVEL = 'debug'; // or 'silent'
if (LOG_LEVEL === 'debug') console.log(...);
```

Let us know which approach you prefer and we can implement it globally.
