/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Workspace {
  id: string;
  name: string;
  path: string;
}

export interface Thread {
  id: string;
  workspaceId: string;
  title: string;
  sessionId?: string;
  status: 'thinking' | 'running' | 'awaiting_permission' | 'idle';

  // Current permission request (from ACP) — populated when ACP sends session/request_permission
  pendingPermissionId?: number;
  pendingPermissionOptions?: Array<{
    kind: string;
    name: string;
    optionId: string;
  }>;

  // Non-end_turn stopReason from last turn (e.g. "error", "cancelled")
  lastError?: string;
}

export type ACPMessageMethod = 
  | 'session/update'
  | 'session/request_permission'
  | 'session/prompt'
  | 'initialize'
  | string;

/**
 * Raw ACP message stored as-is in db.json.
 * This is the source of truth for all conversation state.
 */
export interface Message {
  id: string;
  threadId: string;
  timestamp: string;

  // The raw, unmodified ACP message (JSON-RPC request/response/notification)
  raw: any;

  // Convenience field: the ACP method or message type
  type?: ACPMessageMethod | 'response' | 'unknown';

  // Client-side only: true while waiting for server acknowledgment
  pending?: boolean;
}

/**
 * Workspace-scoped permission patterns for "allow similar" behavior.
 * Variants allow fine-grained control over what "similar" means.
 * 
 * Example for Python web-search tool:
 * - "exact": Full command (specific search terms) - rarely reused
 * - "tool": "python.exe main.py *" - any args to the tool
 * - "category": "python.exe *" - any python tool in that directory
 */
export interface AllowSimilarPattern {
  variant: "exact" | "tool" | "category" | "workspace" | "wildcard" | "execute" | "write" | "edit" | "multiedit" | "read"; // Which parts to match
  pattern: string;  // The actual pattern (with * for wildcards)
  toolName?: string; // Optional: specific tool this applies to
  createdAt: string;
}

export interface DatabaseSchema {
  workspaces: Workspace[];
  threads: Thread[];
  messages: Message[];

  // New: Per-workspace "allow similar" patterns with variants
  allowedPatterns?: AllowSimilarPattern[];
}

// ---------------------------------------------------------------------------
// File Explorer / IDE types
// ---------------------------------------------------------------------------

export type IdePanel = "chat" | "files" | "editor";

/**
 * File or directory entry returned by the file explorer API.
 */
export interface FileEntry {
  name: string;
  path: string;       // relative to workspace root (forward slashes)
  type: "file" | "directory";
  size?: number;       // bytes, only for files
  modified?: string;   // ISO timestamp
}

/**
 * File content returned by the file read API.
 */
export interface FileContent {
  path: string;
  content: string;
  size: number;
  lines: number;
  truncated?: boolean;
}
