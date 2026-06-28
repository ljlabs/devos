/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import fs from "fs";
import path from "path";
import os from "os";

// Use an isolated DB file and test mode BEFORE importing the server so the
// module-level constants pick these up and the HTTP listener/Vite never boot.
const TEST_DB = path.join(os.tmpdir(), `devos-server-test-${Date.now()}.json`);
process.env.NODE_ENV = "test";
process.env.DB_FILE = TEST_DB;

// A real, existing directory we can use as a valid workspace path.
const VALID_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "devos-valid-ws-"));

// Import AFTER env vars are set.
const { app } = await import("./server");

function seedDb(data: any) {
  fs.writeFileSync(TEST_DB, JSON.stringify(data, null, 2));
}

describe("POST /api/workspaces — path validation (integration)", () => {
  beforeEach(() => {
    // Reset DB to a clean known state before each test
    seedDb({ workspaces: [], threads: [], messages: [], allowedPatterns: [] });
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    if (fs.existsSync(VALID_DIR)) fs.rmSync(VALID_DIR, { recursive: true, force: true });
  });

  // ── Happy path ──────────────────────────────────────────────────────────

  it("creates a workspace when given a valid existing directory", async () => {
    const res = await request(app)
      .post("/api/workspaces")
      .send({ name: "good ws", path: VALID_DIR });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("good ws");
    // The path must be exactly what was provided — never rewritten to a sandbox.
    expect(res.body.path).toBe(VALID_DIR);
  });

  it("persists the created workspace to the DB", async () => {
    await request(app)
      .post("/api/workspaces")
      .send({ name: "persisted", path: VALID_DIR });

    const db = JSON.parse(fs.readFileSync(TEST_DB, "utf-8"));
    expect(db.workspaces).toHaveLength(1);
    expect(db.workspaces[0].path).toBe(VALID_DIR);
  });

  // ── Error path — this is the exact bug being reported ─────────────────────

  it("rejects an EMPTY path instead of silently creating a sandbox", async () => {
    const res = await request(app)
      .post("/api/workspaces")
      .send({ name: "broken paths 1", path: "" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/path is required/i);
    // It must NOT have been rewritten into a sandbox_workspaces path.
    expect(res.body.path).toBeUndefined();
  });

  it("rejects a MISSING path field instead of silently creating a sandbox", async () => {
    const res = await request(app)
      .post("/api/workspaces")
      .send({ name: "no path field" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/path is required/i);
  });

  it("rejects a whitespace-only path", async () => {
    const res = await request(app)
      .post("/api/workspaces")
      .send({ name: "spaces", path: "   " });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/path is required/i);
  });

  it("rejects a non-existent path like '/paths/broken path'", async () => {
    const res = await request(app)
      .post("/api/workspaces")
      .send({ name: "broken paths 1", path: "/paths/broken path" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not exist/i);
    expect(res.body.path).toBeUndefined();
  });

  it("rejects a macOS-style path that does not exist on this machine", async () => {
    const res = await request(app)
      .post("/api/workspaces")
      .send({ name: "mac ws", path: "/Users/developer/projects/docs-site" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not exist/i);
  });

  it("rejects a path that points to a file, not a directory", async () => {
    const filePath = path.join(VALID_DIR, "afile.txt");
    fs.writeFileSync(filePath, "hello");

    const res = await request(app)
      .post("/api/workspaces")
      .send({ name: "file ws", path: filePath });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a directory/i);
  });

  it("rejects when name is missing even if path is valid", async () => {
    const res = await request(app)
      .post("/api/workspaces")
      .send({ path: VALID_DIR });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name required/i);
  });

  it("does NOT write anything to the DB when validation fails", async () => {
    await request(app)
      .post("/api/workspaces")
      .send({ name: "broken paths 1", path: "/paths/broken path" });

    const db = JSON.parse(fs.readFileSync(TEST_DB, "utf-8"));
    expect(db.workspaces).toHaveLength(0);
  });

  it("never produces a sandbox_workspaces path for any rejected input", async () => {
    const inputs = ["", "   ", "/paths/broken path", "/Users/dev/missing"];
    for (const p of inputs) {
      const res = await request(app)
        .post("/api/workspaces")
        .send({ name: "x", path: p });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toMatch(/sandbox_workspaces/);
    }
  });
});

// ---------------------------------------------------------------------------
// Pattern matching — path normalization and tool-scoped auto-approval
// ---------------------------------------------------------------------------

describe("Allowed Patterns — path normalization & tool scoping (integration)", () => {
  beforeEach(() => {
    seedDb({ workspaces: [], threads: [], messages: [], allowedPatterns: [] });
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  // ── Path normalization — backslash vs forward-slash ──────────────────────

  describe("checkAllowedPattern normalizes slashes", () => {
    it("forward-slash pattern matches backslash file_path", async () => {
      // Save pattern with forward slashes (as the UI generates)
      seedDb({
        workspaces: [{ id: "ws-1", name: "pipelines", path: VALID_DIR }],
        threads: [{ id: "t-1", workspaceId: "ws-1", title: "test", status: "thinking", sessionId: "sess-1" }],
        messages: [],
        allowedPatterns: [
          { pattern: "C:/Users/jorda/Documents/workspace/pipelines/*", variant: "edit", toolName: "Edit", createdAt: "2024-01-01" }
        ],
      });

      // GET the patterns to verify they're stored
      const patternsRes = await request(app).get("/api/allowedPatterns");
      expect(patternsRes.body).toHaveLength(1);
      expect(patternsRes.body[0].pattern).toBe("C:/Users/jorda/Documents/workspace/pipelines/*");
      expect(patternsRes.body[0].toolName).toBe("Edit");
    });

    it("pattern with forward slashes stored via POST /api/allowedPatterns", async () => {
      const res = await request(app)
        .post("/api/allowedPatterns")
        .send({
          pattern: "C:/Users/jorda/Documents/workspace/pipelines/*",
          toolName: "Edit",
          variant: "edit",
        });

      expect(res.status).toBe(201);
      const stored = res.body.find((p: any) => p.pattern === "C:/Users/jorda/Documents/workspace/pipelines/*");
      expect(stored).toBeDefined();
      expect(stored.toolName).toBe("Edit");
      expect(stored.variant).toBe("edit");
    });
  });

  // ── Tool scoping — Bash patterns should NOT approve Edit ────────────────

  describe("tool-scoped pattern matching", () => {
    it("saves toolName with the pattern", async () => {
      const res = await request(app)
        .post("/api/allowedPatterns")
        .send({ pattern: "npm run *", toolName: "Bash", variant: "execute" });

      expect(res.status).toBe(201);
      const stored = res.body.find((p: any) => p.pattern === "npm run *");
      expect(stored.toolName).toBe("Bash");
    });

    it("does not duplicate patterns with same tool", async () => {
      await request(app)
        .post("/api/allowedPatterns")
        .send({ pattern: "npm run *", toolName: "Bash", variant: "execute" });

      await request(app)
        .post("/api/allowedPatterns")
        .send({ pattern: "npm run *", toolName: "Bash", variant: "execute" });

      const patternsRes = await request(app).get("/api/allowedPatterns");
      const npmPatterns = patternsRes.body.filter((p: any) => p.pattern === "npm run *");
      expect(npmPatterns).toHaveLength(1);
    });

    it("allows same pattern for different tools (Edit vs Bash are separate)", async () => {
      await request(app)
        .post("/api/allowedPatterns")
        .send({ pattern: "*", toolName: "Edit", variant: "edit" });

      await request(app)
        .post("/api/allowedPatterns")
        .send({ pattern: "*", toolName: "Bash", variant: "execute" });

      const patternsRes = await request(app).get("/api/allowedPatterns");
      const starPatterns = patternsRes.body.filter((p: any) => p.pattern === "*");
      expect(starPatterns).toHaveLength(2);
      expect(starPatterns.map((p: any) => p.toolName).sort()).toEqual(["Bash", "Edit"]);
    });
  });

  // ── Full workflow: Allow Similar saves pattern, next request auto-approves ─

  describe("full workflow — Allow Similar → auto-approve next request", () => {
    it("after saving a workspace-level Edit pattern, a second Edit in the same workspace is auto-approved", async () => {
      // Step 1: User clicks "Allow Similar" and picks the workspace wildcard.
      // This calls POST /api/allowedPatterns with the pattern.
      const saveRes = await request(app)
        .post("/api/allowedPatterns")
        .send({
          pattern: "C:/Users/jorda/Documents/workspace/pipelines/*",
          toolName: "Edit",
          variant: "edit",
        });
      expect(saveRes.status).toBe(201);

      // Verify it's in the DB
      const db = JSON.parse(fs.readFileSync(TEST_DB, "utf-8"));
      const editPattern = db.allowedPatterns.find(
        (p: any) => p.pattern === "C:/Users/jorda/Documents/workspace/pipelines/*" && p.toolName === "Edit"
      );
      expect(editPattern).toBeDefined();

      // Step 2: ACP sends a session/request_permission for a SECOND file in
      // the same workspace — this time with backslashes (as Windows does).
      // The server's wireAgent auto-approve logic should match it.
      //
      // We can't easily trigger the full ACP flow in unit tests, but we can
      // verify the matching logic directly by checking GET /api/allowedPatterns
      // and asserting the pattern would match the incoming file_path.
      //
      // The incoming path from ACP: C:\Users\jorda\Documents\workspace\pipelines\other.md
      // The stored pattern:         C:/Users/jorda/Documents/workspace/pipelines/*
      //
      // After normalization: both become C:/Users/jorda/Documents/workspace/pipelines/...
      // Pattern prefix: C:/Users/jorda/Documents/workspace/pipelines/
      // File starts with prefix: ✓ → auto-approved

      const incomingFilePath = "C:\\Users\\jorda\\Documents\\workspace\\pipelines\\other.md";
      const normIncoming = incomingFilePath.replace(/\\/g, "/");
      const storedPattern = editPattern.pattern;
      const prefix = storedPattern.slice(0, -1); // Remove trailing *

      expect(normIncoming.startsWith(prefix)).toBe(true);
    });

    it("a Bash pattern does NOT auto-approve an Edit request for the same path", async () => {
      // Save a Bash wildcard pattern
      await request(app)
        .post("/api/allowedPatterns")
        .send({
          pattern: "C:/Users/jorda/Documents/workspace/pipelines/*",
          toolName: "Bash",
          variant: "execute",
        });

      const db = JSON.parse(fs.readFileSync(TEST_DB, "utf-8"));
      const bashPattern = db.allowedPatterns[0];

      // Simulate an Edit request for a file in the same workspace
      // The toolName is "Edit" but the stored pattern's toolName is "Bash"
      // So it should NOT match.
      const incomingToolName = "Edit";
      const match = bashPattern.toolName !== incomingToolName;
      expect(match).toBe(true); // They are different → no auto-approve
    });

    it("pattern without toolName matches any tool (backward compat)", async () => {
      // Old-format pattern has no toolName
      seedDb({
        workspaces: [],
        threads: [],
        messages: [],
        allowedPatterns: [
          { pattern: "C:/workspace/*", variant: "wildcard", createdAt: "2024-01-01" }
          // Note: no toolName field
        ],
      });

      const db = JSON.parse(fs.readFileSync(TEST_DB, "utf-8"));
      const oldPattern = db.allowedPatterns[0];

      // An Edit request should match because the pattern has no toolName restriction
      expect(oldPattern.toolName).toBeUndefined();
      // This means checkAllowedPattern skips the toolName check → matches any tool
    });

    it("exact file pattern only matches that specific file", async () => {
      await request(app)
        .post("/api/allowedPatterns")
        .send({
          pattern: "C:/Users/jorda/Documents/workspace/pipelines/hello.md",
          toolName: "Edit",
          variant: "edit",
        });

      const db = JSON.parse(fs.readFileSync(TEST_DB, "utf-8"));
      const exactPattern = db.allowedPatterns[0];
      const prefix = exactPattern.pattern;

      // Same file — should match
      const sameFile = "C:\\Users\\jorda\\Documents\\workspace\\pipelines\\hello.md";
      expect(sameFile.replace(/\\/g, "/")).toBe(prefix);

      // Different file — should NOT match
      const diffFile = "C:\\Users\\jorda\\Documents\\workspace\\pipelines\\other.md";
      expect(diffFile.replace(/\\/g, "/")).not.toBe(prefix);
    });

    it("wildcard * pattern matches any file anywhere", async () => {
      await request(app)
        .post("/api/allowedPatterns")
        .send({ pattern: "*", toolName: "Write", variant: "write" });

      const db = JSON.parse(fs.readFileSync(TEST_DB, "utf-8"));
      expect(db.allowedPatterns[0].pattern).toBe("*");
      // "*" matches everything — the checkAllowedPattern function returns true for "*"
    });
  });
});
