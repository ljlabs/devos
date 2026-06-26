/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { DatabaseSchema, Workspace, Thread, Message, SecurityRule, MessageType } from "./src/types";

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const DB_FILE = path.join(process.cwd(), "db.json");

app.use(express.json());

// Initialize SQLite/JSON file Database with Seed Data
const defaultDb: DatabaseSchema = {
  workspaces: [
    { id: "ws-auth", name: "frontend-auth", path: "/Users/developer/projects/frontend-auth" },
    { id: "ws-api", name: "api-gateway", path: "/Users/developer/projects/api-gateway" },
    { id: "ws-docs", name: "docs-site", path: "/Users/developer/projects/docs-site" }
  ],
  threads: [
    {
      id: "thread-jwt",
      workspaceId: "ws-auth",
      title: "Implement JWT",
      targetFile: "/src/auth/jwt.ts",
      status: "running",
      activeSymbols: [
        { type: "f", name: "signToken" },
        { type: "f", name: "verifyToken" }
      ],
      dependencies: ["express@4.18.2", "jsonwebtoken@9.0.0"]
    },
    {
      id: "thread-refactor",
      workspaceId: "ws-auth",
      title: "Refactor API",
      targetFile: "/src/api/routes.js",
      status: "awaiting_permission",
      activeSymbols: [
        { type: "C", name: "UserController" },
        { type: "f", name: "getAllUsers" },
        { type: "M", name: "db.connect" }
      ],
      dependencies: ["express@4.18.2", "jsonwebtoken@9.0.0", "mongoose@7.0.3"]
    },
    {
      id: "thread-readme",
      workspaceId: "ws-auth",
      title: "Write README",
      targetFile: "/README.md",
      status: "idle",
      activeSymbols: [],
      dependencies: []
    },
    {
      id: "thread-gateway-router",
      workspaceId: "ws-api",
      title: "Setup Gateway Router",
      targetFile: "/router.js",
      status: "idle",
      activeSymbols: [
        { type: "C", name: "GatewayRouter" }
      ],
      dependencies: ["express@4.18.2", "http-proxy-middleware@2.0.6"]
    },
    {
      id: "thread-docs-deploy",
      workspaceId: "ws-docs",
      title: "Deploy to Vercel",
      targetFile: "/.vercel/project.json",
      status: "idle",
      activeSymbols: [],
      dependencies: []
    }
  ],
  messages: [
    {
      id: "msg-1",
      threadId: "thread-refactor",
      type: "user_message" as MessageType,
      sender: "user",
      timestamp: new Date(Date.now() - 120000).toISOString(),
      text: "Hey Claude, can you clean up the routes in `/src/api/routes.js`? The GET endpoints are getting cluttered and I want to separate the logic into a controller.",
      codeBlock: null,
      logs: null,
      pendingAction: null
    },
    {
      id: "msg-2",
      threadId: "thread-refactor",
      type: "agent_message" as MessageType,
      sender: "agent",
      timestamp: new Date(Date.now() - 90000).toISOString(),
      text: "I've analyzed the current structure. I'll move the business logic into `UserController.js` and update the routes file. Here is the proposed change for the router file:",
      codeBlock: {
        filePath: "src/api/routes.js",
        content: `// Old messy inline routes removed\nrouter.get('/users', UserController.getAllUsers);\nrouter.get('/users/:id', UserController.getUserById);\nrouter.post('/users/register', UserController.createUser);\n\n// New controller-based approach applied...`
      },
      logs: null,
      pendingAction: null
    },
    {
      id: "msg-3",
      threadId: "thread-refactor",
      type: "tool_call" as MessageType,
      sender: "agent",
      timestamp: new Date(Date.now() - 80000).toISOString(),
      text: "",
      toolName: "npm run lint",
      toolCommand: "npm run lint",
      logs: null,
      pendingAction: null
    },
    {
      id: "msg-4",
      threadId: "thread-refactor",
      type: "tool_result" as MessageType,
      sender: "agent",
      timestamp: new Date(Date.now() - 75000).toISOString(),
      text: "",
      toolCallId: "msg-3",
      logs: {
        command: "npm run lint",
        output: `> dev-workspace@2.4.0 lint\n> eslint . --ext .js,.jsx,.ts,.tsx\n\n/src/api/routes.js\n  14:5  warning  'express' is defined but never used  no-unused-vars\n  32:12 warning  'req' is defined but never used      no-unused-vars\n\n✖ 0 errors, 2 warnings`
      },
      pendingAction: null
    },
    {
      id: "msg-5",
      threadId: "thread-refactor",
      type: "security_permission" as MessageType,
      sender: "agent",
      timestamp: new Date(Date.now() - 60000).toISOString(),
      text: "",
      pendingAction: {
        command: "rm -rf dist && npm run build",
        approved: null
      }
    }
  ],
  rules: [
    {
      id: "rule-1",
      commandPattern: "npm run lint",
      action: "allow",
      createdAt: new Date().toISOString()
    }
  ]
};

function readDb(): DatabaseSchema {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb, null, 2));
      return defaultDb;
    }
    const data = fs.readFileSync(DB_FILE, "utf-8");
    return JSON.parse(data);
  } catch (e) {
    console.error("Error reading db.json, returning default database", e);
    return defaultDb;
  }
}

function writeDb(data: DatabaseSchema) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("Error writing db.json", e);
  }
}

// --- SANDBOX AND WORKSPACE FILE SYSTEM HANDLERS ---
import { exec, spawn, ChildProcess } from "child_process";
import readline from "readline";

const WORKSPACES_DIR = path.join(process.cwd(), "sandbox_workspaces");

// Initialize sandbox workspaces root folder
if (!fs.existsSync(WORKSPACES_DIR)) {
  fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
}

// Function to initialize seed files for workspaces
function ensureWorkspaceFolder(workspaceId: string, name: string) {
  const wsPath = path.join(WORKSPACES_DIR, workspaceId);
  if (!fs.existsSync(wsPath)) {
    fs.mkdirSync(wsPath, { recursive: true });
  }

  // Populate seed files if folder is empty
  const files = fs.readdirSync(wsPath);
  if (files.length === 0) {
    if (workspaceId === "ws-auth" || name === "frontend-auth") {
      // Create frontend-auth files
      fs.mkdirSync(path.join(wsPath, "src", "auth"), { recursive: true });
      fs.mkdirSync(path.join(wsPath, "src", "api"), { recursive: true });

      fs.writeFileSync(
        path.join(wsPath, "package.json"),
        JSON.stringify({
          name: "frontend-auth",
          version: "1.0.0",
          scripts: {
            build: "echo 'Building frontend auth...' && mkdir -p dist && echo 'dist content' > dist/bundle.js",
            test: "echo 'Running unit tests...' && echo 'PASS src/auth/jwt.test.ts' && echo 'PASS src/api/routes.test.ts'",
            lint: "echo 'No lint warnings detected'"
          },
          dependencies: {
            express: "^4.18.2",
            jsonwebtoken: "^9.0.0"
          }
        }, null, 2)
      );

      fs.writeFileSync(
        path.join(wsPath, "README.md"),
        `# Frontend Auth Microservice\n\nThis workspace contains the authentication flow handles and JWT routes.\n\n## Available commands:\n- \`npm run build\`\n- \`npm test\`\n`
      );

      fs.writeFileSync(
        path.join(wsPath, "src/auth/jwt.ts"),
        `import jwt from 'jsonwebtoken';\n\nconst SECRET = 'devos-super-secret-key';\n\nexport function signToken(payload: any): string {\n  return jwt.sign(payload, SECRET, { expiresIn: '1h' });\n}\n\nexport function verifyToken(token: string): any {\n  return jwt.verify(token, SECRET);\n}\n`
      );

      fs.writeFileSync(
        path.join(wsPath, "src/api/routes.js"),
        `const express = require('express');\nconst router = express.Router();\n\nrouter.get('/users', (req, res) => {\n  res.json([{ id: 1, name: 'Alice' }]);\n});\n\nmodule.exports = router;\n`
      );
    } else if (workspaceId === "ws-api" || name === "api-gateway") {
      // Create api-gateway files
      fs.mkdirSync(path.join(wsPath, "src"), { recursive: true });

      fs.writeFileSync(
        path.join(wsPath, "package.json"),
        JSON.stringify({
          name: "api-gateway",
          version: "1.0.0",
          scripts: {
            build: "echo 'Building gateway...'",
            test: "echo 'Running gateway tests...'"
          },
          dependencies: {
            express: "^4.18.2",
            "http-proxy-middleware": "^2.0.6"
          }
        }, null, 2)
      );

      fs.writeFileSync(
        path.join(wsPath, "README.md"),
        `# API Gateway\n\nRoutes incoming traffic to specialized microservices.\n`
      );

      fs.writeFileSync(
        path.join(wsPath, "router.js"),
        `const express = require('express');\nconst app = express();\n\nconsole.log('GatewayRouter initialized...');\n`
      );
    } else if (workspaceId === "ws-docs" || name === "docs-site") {
      // Create docs-site files
      fs.writeFileSync(
        path.join(wsPath, "package.json"),
        JSON.stringify({
          name: "docs-site",
          version: "1.0.0",
          dependencies: {}
        }, null, 2)
      );

      fs.writeFileSync(
        path.join(wsPath, "README.md"),
        `# Documentation Portal\n\nStatic docs site deployment workspace.\n`
      );

      fs.mkdirSync(path.join(wsPath, ".vercel"), { recursive: true });
      fs.writeFileSync(
        path.join(wsPath, ".vercel/project.json"),
        JSON.stringify({ projectId: "prj_devos_docs" }, null, 2)
      );
    } else {
      // General workspace files
      fs.writeFileSync(
        path.join(wsPath, "package.json"),
        JSON.stringify({
          name: name.toLowerCase().replace(/\s+/g, "-"),
          version: "1.0.0",
          dependencies: {}
        }, null, 2)
      );

      fs.writeFileSync(
        path.join(wsPath, "README.md"),
        `# ${name}\n\nCreated dynamically via DevOS Workspace Manager.\n`
      );
    }
  }
}

function getWorkspaceFilesContent(workspaceId: string): { filePath: string; content: string }[] {
  const wsPath = path.join(WORKSPACES_DIR, workspaceId);
  const result: { filePath: string; content: string }[] = [];

  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      const relPath = path.relative(wsPath, fullPath);

      // Skip common ignores
      if (
        file === "node_modules" ||
        file === "dist" ||
        file === ".git" ||
        file === "package-lock.json"
      ) {
        continue;
      }

      if (stat.isDirectory()) {
        walk(fullPath);
      } else {
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          // Only add text/source files
          if (content.length < 50000) { // Limit size of single file to parse
            result.push({ filePath: relPath, content });
          }
        } catch (e) {
          // ignore binary files or read errors
        }
      }
    }
  }

  if (fs.existsSync(wsPath)) {
    walk(wsPath);
  }
  return result;
}

function writeWorkspaceFile(workspaceId: string, filePath: string, content: string) {
  const wsPath = path.join(WORKSPACES_DIR, workspaceId);
  const fullPath = path.join(wsPath, filePath);
  
  // Make sure directory exists
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf-8");
}

function extractSymbolsFromCode(content: string): { type: "C" | "f" | "M"; name: string }[] {
  const symbols: { type: "C" | "f" | "M"; name: string }[] = [];
  
  // Regex for classes
  const classRegex = /class\s+([A-Za-z0-9_$]+)/g;
  let match;
  while ((match = classRegex.exec(content)) !== null) {
    if (symbols.length < 10) {
      symbols.push({ type: "C", name: match[1] });
    }
  }

  // Regex for function declarations
  const funcRegex = /function\s+([A-Za-z0-9_$]+)/g;
  while ((match = funcRegex.exec(content)) !== null) {
    if (symbols.length < 10) {
      symbols.push({ type: "f", name: match[1] });
    }
  }

  // Regex for arrow function variables
  const arrowFuncRegex = /const\s+([A-Za-z0-9_$]+)\s*=\s*(async\s*)?\([^)]*\)\s*=>/g;
  while ((match = arrowFuncRegex.exec(content)) !== null) {
    if (symbols.length < 10) {
      symbols.push({ type: "f", name: match[1] });
    }
  }

  // Regex for Express routes or similar controller endpoints
  const routeRegex = /(router|app)\.(get|post|put|delete)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  while ((match = routeRegex.exec(content)) !== null) {
    if (symbols.length < 10) {
      symbols.push({ type: "M", name: `${match[2].toUpperCase()} ${match[3]}` });
    }
  }

  return symbols;
}

function updateThreadMetadata(threadId: string) {
  const db = readDb();
  const thread = db.threads.find(t => t.id === threadId);
  if (!thread) return;

  const wsPath = path.join(WORKSPACES_DIR, thread.workspaceId);
  
  // Read package.json dependencies
  const packageJsonPath = path.join(wsPath, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      const deps = pkg.dependencies ? Object.entries(pkg.dependencies).map(([name, version]) => `${name}@${(version as string).replace(/[^0-9.]/g, '')}`) : [];
      thread.dependencies = deps;
    } catch (e) {
      console.error("Error reading package.json dependencies", e);
    }
  }

  // Scan files for symbols
  const files = getWorkspaceFilesContent(thread.workspaceId);
  const allSymbols: { type: "C" | "f" | "M"; name: string }[] = [];
  for (const file of files) {
    if (file.filePath.endsWith(".ts") || file.filePath.endsWith(".js")) {
      const fileSymbols = extractSymbolsFromCode(file.content);
      allSymbols.push(...fileSymbols);
    }
  }
  
  // Keep unique symbols up to 10
  const uniqueSymbols = allSymbols.filter(
    (sym, index, self) => self.findIndex(s => s.name === sym.name && s.type === sym.type) === index
  ).slice(0, 10);
  
  thread.activeSymbols = uniqueSymbols;

  writeDb(db);
}

function executeTerminalCommand(workspaceId: string, command: string): Promise<string> {
  return new Promise((resolve) => {
    const wsPath = path.join(WORKSPACES_DIR, workspaceId);
    if (!fs.existsSync(wsPath)) {
      return resolve(`Error: Workspace directory ${workspaceId} does not exist.`);
    }

    // Set a timeout of 10 seconds for safety
    exec(command, { cwd: wsPath, timeout: 10000 }, (error, stdout, stderr) => {
      let output = "";
      if (stdout) output += stdout;
      if (stderr) output += stderr;
      if (error) {
        output += `\nCommand failed with exit code ${error.code || 1}\n${error.message}`;
      }
      resolve(output || "(No output from command)");
    });
  });
}

// Lazy Gemini API Client Initialization
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    return null;
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

// --- API ENDPOINTS ---

// Get workspaces
app.get("/api/workspaces", (req, res) => {
  const db = readDb();
  // Hydrate all workspace folders
  db.workspaces.forEach(ws => {
    ensureWorkspaceFolder(ws.id, ws.name);
  });
  res.json(db.workspaces);
});

// Create workspace
app.post("/api/workspaces", (req, res) => {
  const { name, path: wsPath } = req.body;
  if (!name) {
    return res.status(400).json({ error: "Workspace name is required" });
  }
  const db = readDb();
  const id = `ws-${Date.now()}`;
  const newWorkspace: Workspace = {
    id,
    name,
    path: wsPath || `/Users/developer/projects/${name}`
  };
  db.workspaces.push(newWorkspace);
  writeDb(db);
  
  ensureWorkspaceFolder(id, name);
  
  res.status(201).json(newWorkspace);
});

// Get threads for a workspace
app.get("/api/workspaces/:workspaceId/threads", (req, res) => {
  const { workspaceId } = req.params;
  const db = readDb();
  const threads = db.threads.filter(t => t.workspaceId === workspaceId);
  
  // Hydrate thread metadata dynamically before returning
  threads.forEach(t => {
    updateThreadMetadata(t.id);
  });
  
  const updatedDb = readDb();
  const updatedThreads = updatedDb.threads.filter(t => t.workspaceId === workspaceId);
  res.json(updatedThreads);
});

// Create a thread in a workspace
app.post("/api/workspaces/:workspaceId/threads", (req, res) => {
  const { workspaceId } = req.params;
  const { title } = req.body;
  if (!title) {
    return res.status(400).json({ error: "Thread title is required" });
  }
  const db = readDb();
  const id = `thread-${Date.now()}`;
  const newThread: Thread = {
    id,
    workspaceId,
    title,
    targetFile: "",
    status: "idle",
    activeSymbols: [],
    dependencies: []
  };
  db.threads.push(newThread);
  writeDb(db);
  
  // Run metadata extraction over empty/seed files
  updateThreadMetadata(id);
  
  const updatedDb = readDb();
  const hydratedThread = updatedDb.threads.find(t => t.id === id);
  res.status(201).json(hydratedThread || newThread);
});

// Get messages for a thread
app.get("/api/threads/:threadId/messages", (req, res) => {
  const { threadId } = req.params;
  const db = readDb();
  const messages = db.messages.filter(m => m.threadId === threadId);
  res.json(messages);
});

// Security Rule list
app.get("/api/rules", (req, res) => {
  const db = readDb();
  res.json(db.rules);
});

// Add Security rule
app.post("/api/rules", (req, res) => {
  const { commandPattern } = req.body;
  if (!commandPattern) {
    return res.status(400).json({ error: "commandPattern is required" });
  }
  const db = readDb();
  const id = `rule-${Date.now()}`;
  const newRule: SecurityRule = {
    id,
    commandPattern,
    action: "allow",
    createdAt: new Date().toISOString()
  };
  db.rules.push(newRule);
  writeDb(db);
  res.status(201).json(newRule);
});

// Approve Pending Action
app.post("/api/threads/:threadId/approve", async (req, res) => {
  const { threadId } = req.params;
  const db = readDb();
  
  const thread = db.threads.find(t => t.id === threadId);
  if (!thread) {
    return res.status(404).json({ error: "Thread not found" });
  }

  // Find the last message that has a pendingAction
  const threadMessages = db.messages.filter(m => m.threadId === threadId);
  const permissionMsgs = threadMessages.filter(m => m.type === 'security_permission' && m.pendingAction !== null);
  
  if (permissionMsgs.length === 0) {
    return res.status(400).json({ error: "No pending action found for this thread" });
  }
  
  const lastMsg = permissionMsgs[permissionMsgs.length - 1];
  if (lastMsg.pendingAction) {
    lastMsg.pendingAction.approved = true;
  }
  
  thread.status = "running";
  writeDb(db);

  // Check if there is an active ACP agent process with a pending permission request
  const wsFullPath = path.join(WORKSPACES_DIR, thread.workspaceId);
  const acp = ACPManager.getInstance(threadId, wsFullPath);
  const resolver = acp.getPendingPermissionResolver();
  
  if (resolver) {
    console.log("Resuming ACP agent with USER APPROVAL");
    resolver(true);
    res.json({ success: true, message: "Action approved and sent to ACP agent." });
    return;
  }

  // Fallback to manual execution for simulated sessions
  setTimeout(async () => {
    const commandToRun = lastMsg.pendingAction?.command || "";
    let output = "";
    if (commandToRun && thread) {
      try {
        output = await executeTerminalCommand(thread.workspaceId, commandToRun);
        updateThreadMetadata(threadId);
      } catch (e: any) {
        output = `Execution failed: ${e.message}`;
      }
    } else {
      output = "No valid command found.";
    }

    const updatedDb = readDb();
    const t = updatedDb.threads.find(th => th.id === threadId);
    if (t) {
      t.status = "idle";
      
      // Emit tool_call message
      const toolCallMsg: Message = {
        id: `msg-toolcall-${Date.now()}`,
        threadId,
        type: "tool_call" as MessageType,
        sender: "agent",
        timestamp: new Date().toISOString(),
        text: "",
        toolName: "BASH: " + commandToRun.split(' ')[0],
        toolCommand: commandToRun,
        logs: null,
        pendingAction: null
      };
      
      // Emit tool_result message
      const toolResultMsg: Message = {
        id: `msg-result-${Date.now()}`,
        threadId,
        type: "tool_result" as MessageType,
        sender: "agent",
        timestamp: new Date(Date.now() + 100).toISOString(),
        text: "",
        toolCallId: toolCallMsg.id,
        logs: {
          command: commandToRun,
          output: output
        },
        pendingAction: null
      };
      
      updatedDb.messages.push(toolCallMsg);
      updatedDb.messages.push(toolResultMsg);
      writeDb(updatedDb);
    }
  }, 1000);

  res.json({ success: true, message: "Action approved and executing in background." });
});

// Deny Pending Action
app.post("/api/threads/:threadId/deny", (req, res) => {
  const { threadId } = req.params;
  const db = readDb();
  
  const thread = db.threads.find(t => t.id === threadId);
  if (!thread) {
    return res.status(404).json({ error: "Thread not found" });
  }

  const threadMessages = db.messages.filter(m => m.threadId === threadId);
  const permissionMsgs = threadMessages.filter(m => m.type === 'security_permission' && m.pendingAction !== null);
  
  if (permissionMsgs.length === 0) {
    return res.status(400).json({ error: "No pending action found for this thread" });
  }
  
  const lastMsg = permissionMsgs[permissionMsgs.length - 1];
  if (lastMsg.pendingAction) {
    lastMsg.pendingAction.approved = false;
  }
  
  thread.status = "idle";
  writeDb(db);

  // Check if there is an active ACP agent process with a pending permission request
  const wsFullPath = path.join(WORKSPACES_DIR, thread.workspaceId);
  const acp = ACPManager.getInstance(threadId, wsFullPath);
  const resolver = acp.getPendingPermissionResolver();
  
  if (resolver) {
    console.log("Resuming ACP agent with USER DENIAL");
    resolver(false);
    res.json({ success: true, message: "Action denied and sent to ACP agent." });
    return;
  }

  const cancelMsg: Message = {
    id: `msg-${Date.now()}`,
    threadId,
    type: "agent_message" as MessageType,
    sender: "agent",
    timestamp: new Date().toISOString(),
    text: `Understood. The execution of terminal command \`${lastMsg.pendingAction?.command}\` was denied by safety gatekeeping. Refusing to run. Please let me know what alternative changes we should apply.`,
    codeBlock: null,
    logs: null,
    pendingAction: null
  };
  
  db.messages.push(cancelMsg);
  writeDb(db);
  res.json({ success: true, message: "Action denied." });
});

class ACPManager {
  private static instances = new Map<string, ACPManager>();
  
  public static getInstance(threadId: string, workspacePath: string): ACPManager {
    let instance = this.instances.get(threadId);
    if (!instance) {
      instance = new ACPManager(threadId, workspacePath);
      this.instances.set(threadId, instance);
    }
    return instance;
  }

  public static removeInstance(threadId: string) {
    const instance = this.instances.get(threadId);
    if (instance) {
      instance.kill();
      this.instances.delete(threadId);
    }
  }

  private process: ChildProcess | null = null;
  private isInitialized = false;
  private messageCallback: ((data: any) => void) | null = null;
  private pendingRequests = new Map<number, { resolve: (res: any) => void, reject: (err: any) => void }>();
  private nextId = 1;
  private sessionId: string | null = null;
  private pendingPermissionResolver: ((approved: boolean) => void) | null = null;

  constructor(private threadId: string, private workspacePath: string) {}

  public getSessionId(): string | null {
    return this.sessionId;
  }

  public setSessionId(sid: string) {
    this.sessionId = sid;
  }

  public getPendingPermissionResolver() {
    return this.pendingPermissionResolver;
  }

  private ensureProcess() {
    if (this.process) return;

    console.log(`Spawning ACP agent process in workspace: ${this.workspacePath}`);
    this.process = spawn("npx", ["-y", "@agentclientprotocol/claude-agent-acp"], {
      cwd: this.workspacePath,
      shell: true,
      env: { ...process.env }
    });

    const rl = readline.createInterface({
      input: this.process.stdout!,
      terminal: false
    });

    rl.on("line", (line) => {
      console.log(`[ACP Agent Output]: ${line}`);
      try {
        const msg = JSON.parse(line);
        this.handleMessage(msg);
      } catch (err) {
        console.error("Error parsing ACP message: ", line, err);
      }
    });

    this.process.stderr!.on("data", (data) => {
      console.error(`[ACP Agent Error]: ${data.toString()}`);
    });

    this.process.on("close", (code) => {
      console.log(`ACP agent process closed with code ${code}`);
      this.process = null;
      this.isInitialized = false;
    });
  }

  private handleMessage(msg: any) {
    if (msg.jsonrpc !== "2.0") return;

    if ("id" in msg) {
      if ("result" in msg || "error" in msg) {
        const pending = this.pendingRequests.get(msg.id);
        if (pending) {
          this.pendingRequests.delete(msg.id);
          if (msg.error) {
            pending.reject(msg.error);
          } else {
            pending.resolve(msg.result);
          }
        }
      } else {
        this.handleAgentRequest(msg);
      }
    } else {
      this.handleAgentNotification(msg);
    }
  }

  private handleAgentNotification(msg: any) {
    // Notifications have no id — they are one-way pushes from the agent.
    // session/update carries streaming chunks, tool activity, etc.
    if (msg.method === "session/update") {
      const update = msg.params?.update;
      
      // Persist agent message chunks directly to database
      if (update?.sessionUpdate === "agent_message_chunk") {
        const db = readDb();
        const messages = db.messages.filter(m => m.threadId === this.threadId && m.sender === "agent");
        const lastMsg = messages[messages.length - 1];
        if (lastMsg) {
          const content = update.content;
          if (content && content.type === "text") {
            lastMsg.text = (lastMsg.text === "Thinking..." ? "" : lastMsg.text) + content.text;
            writeDb(db);
          }
        }
      }
      
      // When a tool is about to be called, emit a tool_call message
      if (update?.sessionUpdate === "tool_call_started") {
        const db = readDb();
        const toolName = update.toolCall?.name || "unknown_tool";
        const toolType = toolName === "bash" ? "BASH" : toolName.toUpperCase();
        const toolInput = typeof update.toolCall?.input === 'object' 
          ? update.toolCall?.input?.command || JSON.stringify(update.toolCall?.input)
          : update.toolCall?.input || "";
        
        const toolCallMsg: Message = {
          id: `msg-toolcall-${Date.now()}-${Math.random()}`,
          threadId: this.threadId,
          type: "tool_call" as MessageType,
          sender: "agent",
          timestamp: new Date().toISOString(),
          text: "",
          toolName: `${toolType}: ${toolInput}`,
          toolCommand: typeof update.toolCall?.input === 'object' ? JSON.stringify(update.toolCall?.input) : toolInput,
          logs: null,
          pendingAction: null
        };
        db.messages.push(toolCallMsg);
        writeDb(db);
      }

      // When a tool completes, emit a tool_result message
      if (update?.sessionUpdate === "tool_result") {
        const db = readDb();
        const lastToolCall = db.messages
          .filter(m => m.threadId === this.threadId && m.type === 'tool_call')
          .slice(-1)[0];
        
        const toolResultMsg: Message = {
          id: `msg-result-${Date.now()}-${Math.random()}`,
          threadId: this.threadId,
          type: "tool_result" as MessageType,
          sender: "agent",
          timestamp: new Date().toISOString(),
          text: "",
          toolCallId: lastToolCall?.id,
          logs: {
            command: lastToolCall?.toolCommand || "tool_execution",
            output: JSON.stringify(update.result || {}, null, 2)
          },
          pendingAction: null
        };
        db.messages.push(toolResultMsg);
        writeDb(db);
      }
      
      if (this.messageCallback) {
        this.messageCallback(msg.params);
      }
    }
    // All other notifications (e.g. session/update with sessionUpdate) are informational.
  }

  private handleAgentRequest(req: any) {
    console.log(`[Agent Request Received]: ${req.method}`, JSON.stringify(req.params));
    
    if (req.method === "session/request_permission") {
      // Extract the command from the ACP toolCall payload - try multiple paths
      let command = req.params?.toolCall?.rawInput?.command ||
                    req.params?.permission?.command ||
                    req.params?.toolCall?.rawInput ||
                    "";
      
      // If command is still an object, stringify it
      if (typeof command === "object" && command !== null) {
        command = JSON.stringify(command);
      }
      
      // Fallback: if no command found, show the tool being called
      if (!command && req.params?.toolCall) {
        const toolName = req.params?.toolCall?.title || req.params?.toolCall?.kind || "unknown";
        command = `[${toolName}] Tool execution requested`;
      }
      
      const isAllowed = this.checkPermission(command);
      if (isAllowed) {
        // ACP expects an optionId from the options list, not a boolean
        this.sendResponse(req.id, { optionId: "allow" });
      } else {
        this.pendingPermissionResolver = (approved: boolean) => {
          this.sendResponse(req.id, { optionId: approved ? "allow" : "reject" });
          this.pendingPermissionResolver = null;
        };

        const db = readDb();
        const thread = db.threads.find(t => t.id === this.threadId);
        if (thread) {
          thread.status = "awaiting_permission";
        }
        
        const threadMessages = db.messages.filter(m => m.threadId === this.threadId);
        let lastMsg = threadMessages.reverse().find(m => m.sender === "agent");
        if (!lastMsg) {
          lastMsg = {
            id: `msg-agent-${Date.now()}`,
            threadId: this.threadId,
            type: "agent_message" as MessageType,
            sender: "agent",
            timestamp: new Date().toISOString(),
            text: `The agent is requesting permission to run a sensitive command.`,
            codeBlock: null,
            logs: null,
            pendingAction: null
          };
          db.messages.push(lastMsg);
        }
        lastMsg.pendingAction = {
          command,
          approved: null
        };
        writeDb(db);
      }
      return;
    }

    if (req.method === "terminal/create" || req.method === "terminal/output" || req.method === "terminal/wait_for_exit") {
      if (req.method === "terminal/create") {
        this.sendResponse(req.id, { terminalId: "term-1" });
      } else {
        this.sendResponse(req.id, {});
      }
      return;
    }

    this.sendResponse(req.id, {});
  }

  private checkPermission(command: string): boolean {
    const db = readDb();
    return db.rules.some(rule => {
      const pattern = rule.commandPattern;
      if (pattern === "*") return true;
      return command.includes(pattern);
    });
  }

  private sendRequest(method: string, params: any): Promise<any> {
    this.ensureProcess();
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pendingRequests.set(id, { resolve, reject });
      const msg = {
        jsonrpc: "2.0",
        id,
        method,
        params
      };
      this.process!.stdin!.write(JSON.stringify(msg) + "\n");
    });
  }

  private sendResponse(id: number, result: any) {
    if (!this.process) return;
    const msg = {
      jsonrpc: "2.0",
      id,
      result
    };
    this.process.stdin!.write(JSON.stringify(msg) + "\n");
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;
    this.ensureProcess();

    console.log("Initializing ACP session...");
    await this.sendRequest("initialize", {
      protocolVersion: 1,
      capabilities: {
        agent: {},
        filesystem: {},
        terminal: {}
      }
    });

    if (this.sessionId) {
      console.log(`Loading existing ACP session: ${this.sessionId}`);
      try {
        await this.sendRequest("session/load", { sessionId: this.sessionId });
        this.isInitialized = true;
        return;
      } catch (err) {
        console.error("Failed to load existing session, starting new session...", err);
      }
    }

    console.log("Creating new ACP session...");
    const sessionResult = await this.sendRequest("session/new", {
      cwd: this.workspacePath,
      mcpServers: []
    });

    this.sessionId = sessionResult.sessionId;
    this.isInitialized = true;
    console.log(`ACP session initialized with ID: ${this.sessionId}`);
  }

  public async sendPrompt(prompt: string, callback: (params: any) => void): Promise<any> {
    await this.initialize();
    this.messageCallback = callback;
    // ACP requires prompt to be an array of content blocks: { type: "text", text: "..." }
    return this.sendRequest("session/prompt", {
      sessionId: this.sessionId,
      prompt: [{ type: "text", text: prompt }]
    });
  }

  public kill() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.isInitialized = false;
  }
}

// Send message to thread & Trigger Claude ACP agent
app.post("/api/threads/:threadId/messages", async (req, res) => {
  const { threadId } = req.params;
  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: "Message text is required" });
  }

  const db = readDb();
  const thread = db.threads.find(t => t.id === threadId);
  if (!thread) {
    return res.status(404).json({ error: "Thread not found" });
  }

  const wsFullPath = path.join(WORKSPACES_DIR, thread.workspaceId);
  ensureWorkspaceFolder(thread.workspaceId, thread.workspaceId);

  // Create user message
  const userMsg: Message = {
    id: `msg-user-${Date.now()}`,
    threadId,
    type: "user_message" as MessageType,
    sender: "user",
    timestamp: new Date().toISOString(),
    text,
    codeBlock: null,
    logs: null,
    pendingAction: null
  };

  db.messages.push(userMsg);
  
  // Set thread status to thinking
  thread.status = "thinking";
  writeDb(db);

  // Start backplane process
  const agentMsgId = `msg-agent-${Date.now()}`;
  const agentMsg: Message = {
    id: agentMsgId,
    threadId,
    type: "agent_message" as MessageType,
    sender: "agent",
    timestamp: new Date().toISOString(),
    text: "Initializing Claude Agent...",
    codeBlock: null,
    logs: null,
    pendingAction: null
  };

  const initialDb = readDb();
  initialDb.messages.push(agentMsg);
  writeDb(initialDb);

  // Reply instantly with the user message per route contract
  res.json(userMsg);

  // Execute ACP interaction asynchronously
  (async () => {
    let accumulatedText = "";
    let currentLogs: any = null;
    let currentPendingAction: any = null;
    let codeBlock: any = null;

    try {
      const acp = ACPManager.getInstance(threadId, wsFullPath);
      if (thread.sessionId) {
        acp.setSessionId(thread.sessionId);
      }

      await acp.sendPrompt(text, (params: any) => {
        const update = params.update;
        if (!update) return;

        // ACP uses "sessionUpdate" as the discriminator field, not "kind"
        if (update.sessionUpdate === "agent_message_chunk") {
          const content = update.content;
          if (content && content.type === "text") {
            accumulatedText += content.text;
          }
        } else if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
          const call = update.sessionUpdate === "tool_call"
            ? { name: update._meta?.claudeCode?.toolName, input: update.rawInput }
            : { name: update._meta?.claudeCode?.toolName, input: update.rawInput };
          if (call && call.name) {
            const toolName = call.name;
            const command = call.input?.command ||
              (typeof call.input === "string" ? call.input : JSON.stringify(call.input));

            if (toolName === "Bash") {
              currentLogs = {
                command,
                output: update.sessionUpdate === "tool_call_update" && update.rawOutput
                  ? update.rawOutput
                  : "Executing..."
              };
            } else if (toolName === "Edit" || toolName === "Write" || toolName === "MultiEdit") {
              codeBlock = {
                filePath: call.input?.file_path || call.input?.path || "modified-file",
                content: call.input?.new_content || call.input?.content || ""
              };
            }
          }
        }

        const freshDb = readDb();
        const tMsg = freshDb.messages.find(m => m.id === agentMsgId);
        if (tMsg) {
          tMsg.text = accumulatedText || "Thinking...";
          tMsg.codeBlock = codeBlock;
          tMsg.logs = currentLogs;
          tMsg.pendingAction = currentPendingAction;
        }
        const tThread = freshDb.threads.find(t => t.id === threadId);
        if (tThread) {
          tThread.status = currentPendingAction ? "awaiting_permission" : "thinking";
        }
        writeDb(freshDb);
      });

      const finalDb = readDb();
      const fThread = finalDb.threads.find(t => t.id === threadId);
      if (fThread) {
        fThread.status = currentPendingAction ? "awaiting_permission" : "idle";
        const newSid = acp.getSessionId();
        if (newSid) {
          fThread.sessionId = newSid;
        }
      }

      const fMsg = finalDb.messages.find(m => m.id === agentMsgId);
      if (fMsg) {
        fMsg.text = accumulatedText || "Request finished.";
        fMsg.codeBlock = codeBlock;
        fMsg.logs = currentLogs;
        fMsg.pendingAction = currentPendingAction;
      }
      writeDb(finalDb);

      updateThreadMetadata(threadId);

    } catch (err: any) {
      console.error("ACP process error, falling back", err);
      const errDb = readDb();
      const fMsg = errDb.messages.find(m => m.id === agentMsgId);
      if (fMsg) {
        fMsg.text = `Error connecting to Claude Code ACP instance: ${err.message || err}`;
      }
      const fThread = errDb.threads.find(t => t.id === threadId);
      if (fThread) {
        fThread.status = "idle";
      }
      writeDb(errDb);
    }
  })();
});

export let runningServer: any = null;

async function startServer() {
  if (process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else if (process.env.NODE_ENV === "production") {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  runningServer = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
