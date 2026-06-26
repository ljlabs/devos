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
}

export interface DatabaseSchema {
  workspaces: Workspace[];
  threads: Thread[];
  messages: Message[];
}
