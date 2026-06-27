# UI Rendering Guide for ACP Messages

## Overview

The ChatCanvas component renders raw ACP messages as interactive speech bubbles. This guide shows what each message type looks like and how it's rendered.

## Message Types

### 1. User Message

**ACP Structure:**
```json
{
  "role": "user",
  "content": "edit tmp.md and write hello world"
}
```

**Rendering:**
- Right-aligned bubble with dark gray background
- Contains the user's text
- Timestamp in bottom right
- No interactive elements

**Example:**
```
                                    ┌─────────────────────────┐
                                    │ edit tmp.md and write   │
                                    │ hello world             │
                                    │            19:37        │
                                    └─────────────────────────┘
```

---

### 2. Agent Text Response

**ACP Structure:**
```json
{
  "method": "session/update",
  "params": {
    "update": {
      "content": [
        {
          "type": "text",
          "text": "I'll read the file first, then write hello world to it"
        }
      ]
    }
  }
}
```

**Rendering:**
- Left-aligned bubble with dark background and white border
- Bot icon on the left
- "CLAUDE AI AGENT" label with timestamp
- Contains the agent's response text

**Example:**
```
┌─────────────────────────────────────────┐
│ 🤖 CLAUDE AI AGENT              19:37   │
├─────────────────────────────────────────┤
│ I'll read the file first, then write    │
│ hello world to it                       │
└─────────────────────────────────────────┘
```

---

### 3. Tool Call (Pending)

**ACP Structure:**
```json
{
  "method": "session/update",
  "params": {
    "update": {
      "toolCallId": "call_29ef7fd415b6468a8b76ebd7",
      "sessionUpdate": "tool_call",
      "status": "pending",
      "title": "Read C:\\Users\\jorda\\Documents\\workspace\\devos\\tmp.md",
      "kind": "read",
      "rawInput": {
        "file_path": "C:\\Users\\jorda\\Documents\\workspace\\devos\\tmp.md"
      }
    }
  }
}
```

**Rendering:**
- Left-aligned with terminal icon (pulsing/loading)
- Gray background
- Collapsible section showing the input parameters
- Automatically expanded to show what the tool is about to do

**Example:**
```
┌─────────────────────────────────────────┐
│ ⚡ READ: Read C:\Users\jorda\...tmp.md │
├─────────────────────────────────────────┤
│ {                                       │
│   "file_path": "C:\Users\jorda\..."     │
│ }                                       │
└─────────────────────────────────────────┘
```

---

### 4. Tool Result (Success)

**ACP Structure:**
```json
{
  "method": "session/update",
  "params": {
    "update": {
      "toolCallId": "call_29ef7fd415b6468a8b76ebd7",
      "sessionUpdate": "tool_call_update",
      "status": "succeeded",
      "title": "Read C:\\Users\\jorda\\Documents\\workspace\\devos\\tmp.md",
      "kind": "read",
      "rawOutput": "hello world\n"
    }
  }
}
```

**Rendering:**
- Left-aligned with terminal icon (emerald/success color)
- Shows output in a collapsible code block
- Indicates success status

**Example:**
```
┌─────────────────────────────────────────┐
│ ✓ READ: Success                         │
├─────────────────────────────────────────┤
│ hello world                             │
└─────────────────────────────────────────┘
```

---

### 5. Tool Result (Failed)

**ACP Structure:**
```json
{
  "method": "session/update",
  "params": {
    "update": {
      "toolCallId": "call_29ef7fd415b6468a8b76ebd7",
      "sessionUpdate": "tool_call_update",
      "status": "failed",
      "title": "Read C:\\Users\\jorda\\Documents\\workspace\\devos\\tmp.md",
      "kind": "read",
      "rawOutput": "<tool_use_error>File not found</tool_use_error>"
    }
  }
}
```

**Rendering:**
- Left-aligned with terminal icon (red/error color)
- Shows error message in code block
- Indicates failure status

**Example:**
```
┌─────────────────────────────────────────┐
│ ✗ READ: Failed                          │
├─────────────────────────────────────────┤
│ <tool_use_error>File not found</tool... │
└─────────────────────────────────────────┘
```

---

### 6. Permission Request

**ACP Structure:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "session/request_permission",
  "params": {
    "sessionId": "57080fd4-...",
    "options": [
      {
        "kind": "allow_always",
        "name": "Always Allow Read(//c/Users/jorda/Documents/workspace/devos/**)",
        "optionId": "allow_always"
      },
      {
        "kind": "allow_once",
        "name": "Allow",
        "optionId": "allow"
      },
      {
        "kind": "reject_once",
        "name": "Reject",
        "optionId": "reject"
      }
    ],
    "toolCall": {
      "toolCallId": "call_cd49cc255a734f4bac63f2f2",
      "title": "Read C:\\Users\\jorda\\Documents\\workspace\\devos\\tmp.md",
      "kind": "read",
      "locations": [
        {"path": "C:\\Users\\jorda\\Documents\\workspace\\devos\\tmp.md", "line": 1}
      ]
    }
  }
}
```

**Rendering:**
- Amber/warning color with dashed border
- Shows tool details (title, kind, paths)
- Dynamic buttons for each option in the `options` array
- Button styling varies by kind:
  - `allow_always`: Emerald/green (trusted)
  - `allow_once`: Amber/yellow
  - `reject_once`: Transparent with white border

**Example:**
```
┌─────────────────────────────────────────┐
│ ⚠️ Permission Required                  │
│ Read C:\Users\jorda\...\tmp.md          │
│ Kind: read                              │
│ Path: C:\Users\jorda\...\tmp.md         │
│                                         │
│ [Always Allow] [Allow] [Reject]         │
└─────────────────────────────────────────┘
```

---

## Grouped Message Sequences

Tool calls and results are shown sequentially in the chat as they arrive. Here's a typical flow:

### Read File Sequence

```
1. User: "edit tmp.md and write hello world"

2. Agent: "I'll read the file first, then write hello world to it"

3. Pending: READ: tmp.md (input shown)

4. Permission: Permission Required for READ (dynamic buttons)

5. User clicks "Allow"

6. Result: READ: Success (output shown)

7. Pending: WRITE: tmp.md (input shown)

8. Permission: Permission Required for WRITE (dynamic buttons)

9. User clicks "Allow"

10. Result: WRITE: Success (output shown)

11. Agent: "Done! I've written hello world to the file"
```

---

## Implementation Notes

### getMessageContent() Function

The ChatCanvas uses a helper function to parse raw ACP messages:

```typescript
function getMessageContent(msg: Message): { type: string; content: any } | null {
  const raw = msg.raw;
  
  // User message
  if (raw.role === "user" && raw.content) {
    return { type: "user", content: raw.content };
  }
  
  // Permission request
  if (msg.type === "session/request_permission") {
    return {
      type: "permission",
      content: {
        toolCall: raw.params?.toolCall,
        options: raw.params?.options,
        permissionId: raw.id,
      },
    };
  }
  
  // Tool event
  if (msg.type === "session/update") {
    const update = raw.params?.update;
    if (update) {
      return { type: "tool_event", content: update };
    }
  }
  
  // Text content
  if (msg.type === "session/update") {
    const update = raw.params?.update;
    if (update?.content) {
      return { type: "agent_text", content: update.content };
    }
  }
  
  return null;
}
```

### Key Properties Extracted

For **tool events**, the rendering extracts:
- `status`: "pending" | "succeeded" | "failed"
- `title`: Human-readable title
- `kind`: Tool type (read, write, bash, etc.)
- `rawInput`: Input to the tool (shown when pending)
- `rawOutput`: Output from the tool (shown when completed)

For **permissions**, the rendering extracts:
- `toolCall.title`: What's being requested
- `toolCall.kind`: Type of operation
- `toolCall.locations[]`: Affected files/paths
- `options[]`: Array of button options

Each option button's styling and label comes from:
- `kind`: Determines button color
- `name`: Button label text
- `optionId`: Sent back via `onPermissionResponse()`

---

## Styling Details

### Colors
- **Emerald/Green**: Agent text, success, allow_always buttons
- **Amber/Yellow**: Warnings, permissions, allow_once buttons
- **Red**: Errors, failures
- **Slate/Gray**: Results, metadata
- **Dark background**: #0E0E11, #18181B

### Animations
- Message bubbles fade in: `animate-fadeIn`
- Permission bubbles pulse: `animate-pulse`
- Tool icons animate when loading
- Scroll-to-bottom is smooth

---

## Expected User Flow

1. User types prompt and clicks Send
2. "thinking" status appears briefly
3. Agent text bubbles appear with interpretation
4. Tool call bubbles show what's about to happen
5. **Permission prompt appears with dynamic buttons**
6. User clicks a button
7. Tool executes and shows result
8. Agent responds with next steps or completion

The UI is now **completely driven by ACP messages**, with no local state translation.
