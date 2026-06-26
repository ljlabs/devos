import test from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import http from "http";

delete process.env.HTTP_PROXY;
delete process.env.http_proxy;
delete process.env.HTTPS_PROXY;
delete process.env.https_proxy;

const DB_FILE = path.join(process.cwd(), "db.json");

// Helper to clean up state or back up db.json
let dbBackup: string | null = null;

test.before(() => {
  if (fs.existsSync(DB_FILE)) {
    dbBackup = fs.readFileSync(DB_FILE, "utf-8");
  }
});

test.after(async () => {
  if (dbBackup !== null) {
    fs.writeFileSync(DB_FILE, dbBackup, "utf-8");
  }
  const serverModule = await import("./server.ts");
  if (serverModule.runningServer) {
    serverModule.runningServer.close();
  }
});

function makeRequest(options: http.RequestOptions, body?: any): Promise<{ status: number, body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch (e) {}
        resolve({ status: res.statusCode || 0, body: parsed });
      });
    });
    req.on("error", reject);
    if (body) {
      req.setHeader("Content-Type", "application/json");
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

test("Feature Test Suite: DevOS Core Services", async (t) => {
  const PORT = 5687;
  const baseUrl = `http://127.0.0.1:${PORT}`;

  process.env.PORT = String(PORT);
  process.env.NODE_ENV = "test";
  
  // Clean db for test run
  const testDb = {
    workspaces: [],
    threads: [],
    messages: [],
    rules: []
  };
  fs.writeFileSync(DB_FILE, JSON.stringify(testDb, null, 2));

  // Dynamically load the server
  await import("./server.ts");
  await new Promise((resolve) => setTimeout(resolve, 2500));

  await t.test("Verify Workspace Creation", async () => {
    try {
      const res = await makeRequest({
        host: "127.0.0.1",
        port: PORT,
        path: "/api/workspaces",
        method: "POST"
      }, { name: "test-auth-service", path: "/test/path" });
      
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.name, "test-auth-service");
      assert.ok(res.body.id.startsWith("ws-"));

      // Verify DB contains it
      const db = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
      assert.strictEqual(db.workspaces.length, 1);
      assert.strictEqual(db.workspaces[0].name, "test-auth-service");
    } catch (e: any) {
      console.error("Verify Workspace Creation failed with:", e);
      throw e;
    }
  });

  await t.test("Verify Thread Creation", async () => {
    try {
      const db = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
      const wsId = db.workspaces[0].id;

      const res = await makeRequest({
        host: "127.0.0.1",
        port: PORT,
        path: `/api/workspaces/${wsId}/threads`,
        method: "POST"
      }, { title: "Implement Auth Middleware" });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.title, "Implement Auth Middleware");
      assert.strictEqual(res.body.workspaceId, wsId);

      // Verify DB
      const freshDb = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
      assert.strictEqual(freshDb.threads.length, 1);
      assert.strictEqual(freshDb.threads[0].title, "Implement Auth Middleware");
    } catch (e: any) {
      console.error("Verify Thread Creation failed with:", e);
      throw e;
    }
  });

  await t.test("Verify Security Rule Configuration", async () => {
    const res = await makeRequest({
      host: "127.0.0.1",
      port: PORT,
      path: "/api/rules",
      method: "POST"
    }, { commandPattern: "npm run test" });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.commandPattern, "npm run test");

    // Verify DB
    const db = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
    assert.strictEqual(db.rules.length, 1);
    assert.strictEqual(db.rules[0].commandPattern, "npm run test");
  });

  await t.test("Verify Action Approvals and Denials Interface", async () => {
    const db = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
    const threadId = db.threads[0].id;

    // Seed a pending action
    db.messages.push({
      id: "msg-pending",
      threadId: threadId,
      sender: "agent",
      timestamp: new Date().toISOString(),
      text: "Pending command check",
      codeBlock: null,
      logs: null,
      pendingAction: {
        command: "npm run build",
        approved: null
      }
    });
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

    const res = await makeRequest({
      host: "127.0.0.1",
      port: PORT,
      path: `/api/threads/${threadId}/approve`,
      method: "POST"
    });
    assert.strictEqual(res.status, 200);

    const freshDb = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
    const lastMsg = freshDb.messages.find((m: any) => m.id === "msg-pending");
    assert.strictEqual(lastMsg.pendingAction.approved, true);
  });
});
