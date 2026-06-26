/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Workspace {
  id: string;
  name: string;
  path: string;
}

export interface SymbolInfo {
  type: 'C' | 'f' | 'M'; // Class, Function, Method
  name: string;
}

export interface Thread {
  id: string;
  workspaceId: string;
  title: string;
  targetFile?: string;
  status: 'thinking' | 'running' | 'awaiting_permission' | 'idle';
  activeSymbols: SymbolInfo[];
  dependencies: string[];
  sessionId?: string;
}

export interface CodeBlock {
  filePath: string;
  content: string;
}

export interface LogsInfo {
  command: string;
  output: string;
}

export interface PendingAction {
  command: string;
  approved: boolean | null; // null: pending, true: approved, false: denied
}

export type MessageType = 'user_message' | 'agent_message' | 'tool_call' | 'tool_result' | 'security_permission';

export interface Message {
  id: string;
  threadId: string;
  type: MessageType;
  sender: 'user' | 'agent';
  timestamp: string;
  text: string;
  
  // For user_message and agent_message
  codeBlock?: CodeBlock | null;
  
  // For tool_call
  toolName?: string;
  toolCommand?: string;
  
  // For tool_result
  logs?: LogsInfo | null;
  toolCallId?: string; // Links to the tool_call message
  
  // For security_permission
  pendingAction?: PendingAction | null;
}

export interface SecurityRule {
  id: string;
  commandPattern: string;
  action: 'allow';
  createdAt: string;
}

export interface DatabaseSchema {
  workspaces: Workspace[];
  threads: Thread[];
  messages: Message[];
  rules: SecurityRule[];
}
