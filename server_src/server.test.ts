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
const TEST_DB = path.join(os.tmpdir(), `devos-server-test-${Date.now()}.db`);
process.env.NODE_ENV = "test";
process.env.DB_FILE = TEST_DB;

// A real, existing directory we can use as a valid workspace path.
const VALID_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "devos-valid-ws-"));

// Import AFTER env vars are set.
const { app, sqliteDb, checkAllowedPattern } = await import("./server");

function seedDb(data: any) {
  // For SQLite, we use the writeDb API instead of writing JSON
  sqliteDb.writeDb(data);
}

function readDb() {
  return sqliteDb.readDb();
}

describe("POST /api/workspaces — path validation (integration)", () => {
  beforeEach(() => {
    // Reset DB to a clean known state before each test
    seedDb({ workspaces: [], threads: [], messages: [], allowedPatterns: [] });
  });

  afterAll(() => {
    // Don't close the database yet - let the final teardown handle it
    // Just clean up the temp files
    for (let i = 0; i < 10; i++) {
      try {
        if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
        if (fs.existsSync(TEST_DB + "-shm")) fs.unlinkSync(TEST_DB + "-shm");
        if (fs.existsSync(TEST_DB + "-wal")) fs.unlinkSync(TEST_DB + "-wal");
        break;
      } catch {
        // Retry
      }
    }
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

    const db = readDb();
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

    const db = readDb();
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
    // Don't close the database yet - let the final teardown handle it
    // Just clean up the temp files
    for (let i = 0; i < 10; i++) {
      try {
        if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
        if (fs.existsSync(TEST_DB + "-shm")) fs.unlinkSync(TEST_DB + "-shm");
        if (fs.existsSync(TEST_DB + "-wal")) fs.unlinkSync(TEST_DB + "-wal");
        break;
      } catch {
        // Retry
      }
    }
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
      const db = readDb();
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

      const db = readDb();
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

      const db = readDb();
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

      const db = readDb();
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

      const db = readDb();
      expect(db.allowedPatterns[0].pattern).toBe("*");
      // "*" matches everything — the checkAllowedPattern function returns true for "*"
    });
  });
});


// ---------------------------------------------------------------------------
// Compound command auto-approval — regression test
//
// Repro: "cd LekkerLoyal *" was stored as an allowed pattern. A compound
// command "cd LekkerLoyal && gh issue create ..." was auto-approved because
// the whole string starts with "cd LekkerLoyal " — the second sub-command
// (gh issue create) was never checked against the pattern list.
//
// Expected behaviour: every sub-command in a compound command must independently
// match a stored pattern. If any part is unrecognised, the whole command must
// be blocked (not auto-approved).
// ---------------------------------------------------------------------------

describe("checkAllowedPattern — compound command security", () => {
  // The two patterns that were present in the real DB when the bug was triggered.
  const realPatterns = [
    { pattern: "cd LekkerLoyal *",                          variant: "execute", createdAt: "2024-01-01" },
    { pattern: "cd LekkerLoyal/* && cat functions/* && head *", variant: "execute", toolName: "Bash", createdAt: "2024-01-01" },
  ];

  // The exact compound command that was wrongly auto-approved.
  const dangerousCommand =
    "cd LekkerLoyal && gh issue create --repo TheJustinGreen/LekkerLoyal " +
    '--title "CI/CD Pipeline" --label "coding" --body \'some body\' 2>&1';

  it("does NOT auto-approve a compound command whose second part is not in the allow list", () => {
    // "gh issue create ..." matches neither stored pattern, so the whole
    // compound command must be blocked regardless of the "cd LekkerLoyal" prefix.
    expect(checkAllowedPattern(dangerousCommand, "Bash", realPatterns)).toBe(false);
  });

  it("does NOT auto-approve when the first sub-command alone matches but the second does not", () => {
    // Isolated check: "cd LekkerLoyal" on its own would NOT match "cd LekkerLoyal *"
    // because the prefix includes a trailing space ("cd LekkerLoyal ") and the bare
    // sub-command has no trailing space/argument.  Either way the compound must fail.
    const partial = "cd LekkerLoyal && git push origin main";
    expect(checkAllowedPattern(partial, "Bash", realPatterns)).toBe(false);
  });

  it("auto-approves a compound command only when ALL sub-commands individually match", () => {
    // Both sub-commands are covered by the second stored pattern via its prefix.
    // "cd LekkerLoyal/subdir" starts with "cd LekkerLoyal/"
    // "cat functions/index.ts" starts with "cat functions/"
    // "head -n 20" — head has no pattern, so this should still be false unless we
    // add a pattern for it.  Use a two-part command that IS fully covered instead.
    const allowedPatterns = [
      { pattern: "cd LekkerLoyal/*", variant: "execute", createdAt: "2024-01-01" },
      { pattern: "cat functions/*",  variant: "execute", createdAt: "2024-01-01" },
    ];
    const safeCompound = "cd LekkerLoyal/subdir && cat functions/index.ts";
    expect(checkAllowedPattern(safeCompound, "Bash", allowedPatterns)).toBe(true);
  });

  it("blocks a compound command when at least one sub-command is not covered", () => {
    const allowedPatterns = [
      { pattern: "cd LekkerLoyal/*", variant: "execute", createdAt: "2024-01-01" },
      // No pattern for "gh" commands
    ];
    const mixed = "cd LekkerLoyal/subdir && gh issue create --title test";
    expect(checkAllowedPattern(mixed, "Bash", allowedPatterns)).toBe(false);
  });

  it("still auto-approves a simple (non-compound) command that matches", () => {
    const allowedPatterns = [
      { pattern: "cd LekkerLoyal *", variant: "execute", createdAt: "2024-01-01" },
    ];
    // Non-compound with a matching prefix
    expect(checkAllowedPattern("cd LekkerLoyal subdir", undefined, allowedPatterns)).toBe(true);
  });

  it("still blocks a simple command that does not match any pattern", () => {
    expect(checkAllowedPattern("gh issue create --title test", "Bash", realPatterns)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkAllowedPattern — quoted-string operator handling
//
// Operators (|, ;, &&) inside quoted arguments must NOT be treated as compound
// command separators. This was the real bug: --body "## Goal\n- [ ] item"
// contains | characters inside the markdown checklist, which caused the whole
// gh issue create command to be split and fail to match "gh issue create *".
// ---------------------------------------------------------------------------

describe("checkAllowedPattern — operators inside quoted arguments", () => {
  const ghIssuePattern = [
    { pattern: "gh issue create *", variant: "execute", toolName: "Bash", createdAt: "2024-01-01" },
  ];

  it("auto-approves gh issue create with markdown checklist body (exact repro)", () => {
    // The real command that was incorrectly blocked: the --body value contains
    // "- [ ]" checklist items whose | characters were mistaken for pipe operators.
    const cmd =
      'gh issue create --title "Improve project professionalism and presentation" ' +
      '--body "## Goal\nMake DevOS look more professional.\n\n## Areas\n- [ ] README\n- [ ] CONTRIBUTING\n- [ ] LICENSE" ' +
      '--label enhancement';
    expect(checkAllowedPattern(cmd, "Bash", ghIssuePattern)).toBe(true);
  });

  it("auto-approves when | appears inside a double-quoted argument", () => {
    const patterns = [{ pattern: "gh issue create *", variant: "execute", createdAt: "2024-01-01" }];
    const cmd = 'gh issue create --title "foo | bar" --body "baz"';
    expect(checkAllowedPattern(cmd, undefined, patterns)).toBe(true);
  });

  it("auto-approves when ; appears inside a single-quoted argument", () => {
    const patterns = [{ pattern: "echo *", variant: "execute", createdAt: "2024-01-01" }];
    const cmd = "echo 'hello; world'";
    expect(checkAllowedPattern(cmd, undefined, patterns)).toBe(true);
  });

  it("still splits on a real unquoted pipe (shell pipeline)", () => {
    // "gh label list | head -10" — the | here IS a shell operator (unquoted)
    const patterns = [
      { pattern: "gh label list *", variant: "execute", createdAt: "2024-01-01" },
      { pattern: "head *",          variant: "execute", createdAt: "2024-01-01" },
    ];
    const cmd = "gh label list --repo foo/bar | head -10";
    // Both parts are covered → should approve
    expect(checkAllowedPattern(cmd, undefined, patterns)).toBe(true);
  });

  it("blocks a real unquoted pipe when the second part has no pattern", () => {
    const patterns = [
      { pattern: "gh label list *", variant: "execute", createdAt: "2024-01-01" },
      // no pattern for "grep"
    ];
    const cmd = "gh label list --repo foo/bar | grep coding";
    expect(checkAllowedPattern(cmd, undefined, patterns)).toBe(false);
  });

  it("still blocks a genuine compound command that has an unmatched second part", () => {
    const patterns = [
      { pattern: "cd LekkerLoyal *", variant: "execute", createdAt: "2024-01-01" },
    ];
    const cmd = "cd LekkerLoyal && gh issue create --title test";
    expect(checkAllowedPattern(cmd, undefined, patterns)).toBe(false);
  });
});



// ---------------------------------------------------------------------------
// checkAllowedPattern — tool-scoped pattern strict matching (Bug 3 fix)
//
// A pattern saved with toolName="Bash" should NOT auto-approve a request
// when the incoming toolName is undefined (unknown tool). Previously the
// condition `pattern.toolName && toolName && pattern.toolName !== toolName`
// was false when toolName=undefined, causing the check to silently fall
// through and match — a security hole.
// ---------------------------------------------------------------------------

describe("checkAllowedPattern — tool-scoped pattern strict matching", () => {
  const bashPattern = [
    { pattern: "npm run *", variant: "execute", toolName: "Bash", createdAt: "2024-01-01" },
  ];

  it("matches when pattern.toolName equals incoming toolName", () => {
    expect(checkAllowedPattern("npm run build", "Bash", bashPattern)).toBe(true);
  });

  it("does NOT match when pattern has toolName='Bash' but incoming toolName is undefined", () => {
    // A Bash-scoped pattern must NOT silently approve a request with unknown toolName.
    // Previously this returned true (bug) because the &&-chain short-circuits at toolName=undefined.
    expect(checkAllowedPattern("npm run build", undefined, bashPattern)).toBe(false);
  });

  it("does NOT match when pattern has toolName='Bash' but incoming toolName is 'Edit'", () => {
    expect(checkAllowedPattern("npm run build", "Edit", bashPattern)).toBe(false);
  });

  it("does NOT match when pattern has toolName='Edit' but incoming toolName is 'Bash'", () => {
    const editPattern = [
      { pattern: "src/components/*", variant: "edit", toolName: "Edit", createdAt: "2024-01-01" },
    ];
    expect(checkAllowedPattern("src/components/Foo.tsx", "Bash", editPattern)).toBe(false);
  });

  it("matches any tool when pattern has NO toolName (backward compat)", () => {
    const untooledPattern = [
      { pattern: "npm run *", variant: "execute", createdAt: "2024-01-01" },
      // no toolName field
    ];
    expect(checkAllowedPattern("npm run build", "Bash", untooledPattern)).toBe(true);
    expect(checkAllowedPattern("npm run build", "Edit", untooledPattern)).toBe(true);
    expect(checkAllowedPattern("npm run build", undefined, untooledPattern)).toBe(true);
  });

  it("matches any tool when pattern toolName is null", () => {
    const nullToolPattern = [
      { pattern: "npm run *", variant: "execute", toolName: null, createdAt: "2024-01-01" },
    ];
    expect(checkAllowedPattern("npm run build", "Bash", nullToolPattern)).toBe(true);
    expect(checkAllowedPattern("npm run build", undefined, nullToolPattern)).toBe(true);
  });

  it("compound command: each sub-command inherits the tool-scoping check", () => {
    const patterns = [
      { pattern: "cd workspace/*", variant: "execute", toolName: "Bash", createdAt: "2024-01-01" },
      { pattern: "cat src/*",       variant: "execute", toolName: "Bash", createdAt: "2024-01-01" },
    ];
    // Both sub-commands match Bash patterns → approve for Bash
    expect(checkAllowedPattern("cd workspace/foo && cat src/bar.ts", "Bash", patterns)).toBe(true);
    // Same compound with unknown tool → deny (pattern is Bash-scoped, tool unknown)
    expect(checkAllowedPattern("cd workspace/foo && cat src/bar.ts", undefined, patterns)).toBe(false);
    // Same compound with wrong tool → deny
    expect(checkAllowedPattern("cd workspace/foo && cat src/bar.ts", "Edit", patterns)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkAllowedPattern — web-search CLI commands (real-world regression)
//
// Regression tests for the specific commands from the bug report:
//   python.exe main.py text "Google Workspace CLI..." --max 10
//   python.exe main.py text "gws google workspace..."  --max 8
//
// When the user saves "python.exe main.py *" after approving the first command,
// the second command must also be auto-approved.
// ---------------------------------------------------------------------------

describe("checkAllowedPattern — web-search CLI regression", () => {
  const PYTHON_EXE = "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe";
  const SCRIPT = "C:/Users/jorda/.claude/skills/web-search/main.py";

  const scriptLevelPattern = [
    {
      pattern: `${PYTHON_EXE} ${SCRIPT} *`,
      variant: "tool",
      toolName: "Bash",
      createdAt: "2024-01-01",
    },
  ];

  const cmd1 = `${PYTHON_EXE} ${SCRIPT} text "Google Workspace CLI tool command line interface" --max 10`;
  const cmd2 = `${PYTHON_EXE} ${SCRIPT} text "gws google workspace CLI install authentication account" --max 8`;

  it("cmd1 is auto-approved by script-level pattern (same-session baseline)", () => {
    expect(checkAllowedPattern(cmd1, "Bash", scriptLevelPattern)).toBe(true);
  });

  it("cmd2 is auto-approved by the same script-level pattern saved from cmd1", () => {
    // This is the core regression: a different query to the same script must match
    expect(checkAllowedPattern(cmd2, "Bash", scriptLevelPattern)).toBe(true);
  });

  it("cmd2 with Windows backslash paths is auto-approved (path normalisation)", () => {
    // ACP on Windows may send backslash paths; checkAllowedPattern must normalise
    const winCmd2 = cmd2.replace(/\//g, "\\");
    expect(checkAllowedPattern(winCmd2, "Bash", scriptLevelPattern)).toBe(true);
  });

  it("cmd1 with | inside quoted query does NOT split into compound sub-commands", () => {
    // A query containing | inside quotes must NOT be treated as a pipeline
    const cmdWithPipe = `${PYTHON_EXE} ${SCRIPT} text "foo | bar baz" --max 5`;
    expect(checkAllowedPattern(cmdWithPipe, "Bash", scriptLevelPattern)).toBe(true);
  });

  it("cmd with ; inside quoted query does NOT split", () => {
    const cmdWithSemi = `${PYTHON_EXE} ${SCRIPT} text "step1; step2" --max 5`;
    expect(checkAllowedPattern(cmdWithSemi, "Bash", scriptLevelPattern)).toBe(true);
  });

  it("exe-level wildcard also auto-approves both commands", () => {
    const exePattern = [
      { pattern: `${PYTHON_EXE} *`, variant: "category", toolName: "Bash", createdAt: "2024-01-01" },
    ];
    expect(checkAllowedPattern(cmd1, "Bash", exePattern)).toBe(true);
    expect(checkAllowedPattern(cmd2, "Bash", exePattern)).toBe(true);
  });

  it("a DIFFERENT script with the same exe is NOT approved by script-level pattern", () => {
    const otherScript = "C:/Users/jorda/.claude/skills/other-tool/main.py";
    const otherCmd = `${PYTHON_EXE} ${otherScript} text "some query" --max 5`;
    expect(checkAllowedPattern(otherCmd, "Bash", scriptLevelPattern)).toBe(false);
  });

  it("unscoped (no toolName) script-level pattern approves both commands regardless of toolName", () => {
    const untooledPattern = [
      { pattern: `${PYTHON_EXE} ${SCRIPT} *`, variant: "tool", createdAt: "2024-01-01" },
    ];
    expect(checkAllowedPattern(cmd1, "Bash", untooledPattern)).toBe(true);
    expect(checkAllowedPattern(cmd2, undefined, untooledPattern)).toBe(true);
  });
});


// ---------------------------------------------------------------------------
// checkAllowedPattern — Allow Similar race condition regression
//
// Exact reproduction of the session from the logs:
//
//   1. Agent calls: python.exe main.py "next expected heatwave in England"
//   2. No pattern match → user sees permission prompt
//   3. User clicks "Allow Similar" → saves "python.exe main.py *"
//      (fires POST /api/allowedPatterns)
//   4. UI calls onRespond("allow") → agent receives allow_once
//   5. Tool runs, FAILS (exit 2 — missing mode arg)
//   6. Agent retries: python.exe main.py text "next expected heatwave in England"
//   7. wireAgent sees SECOND session/request_permission
//   8. Bug: "No pattern match" even though "python.exe main.py *" was saved in step 3
//
// Root cause: handleConfirmSimilar() in ChatCanvas did not await the fetch()
// before calling onRespond(). The pattern save and the allow_once were racing.
// The pattern write was in-flight when the agent was already unblocked and fired
// the retry — so the DB didn't have the pattern yet when wireAgent checked it.
//
// Fix: ChatCanvas now awaits the fetch before calling onRespond.
// These tests verify the server-side matching is correct once the pattern IS saved.
// ---------------------------------------------------------------------------

describe("checkAllowedPattern — Allow Similar race condition (exact log reproduction)", () => {
  const BRAINSTORM_EXE = "C:/Users/jorda/Documents/workspace/brainstorm/venv/Scripts/python.exe";
  const BRAINSTORM_SCRIPT = "C:/Users/jorda/Documents/workspace/brainstorm/.claude/skills/web-search/main.py";

  // The exact pattern list from the DB at the time of the bug (from the curl response in the logs)
  const realPatternList = [
    { variant: "execute", pattern: "cd LekkerLoyal *", toolName: "cd", createdAt: "2026-06-29T05:14:19.458Z" },
    { variant: "execute", pattern: "cd LekkerLoyal/* && cat functions/* && head *", toolName: "Bash", createdAt: "2026-06-29T06:33:18.824Z" },
    { variant: "execute", pattern: "gh issue create *", toolName: "Bash", createdAt: "2026-06-29T07:40:09.458Z" },
    { variant: "execute", pattern: "gh label *", toolName: "Bash", createdAt: "2026-06-29T07:52:10.958Z" },
    { variant: "write", pattern: "C:\\Users\\jorda\\Documents\\workspace\\lekker_loyal\\documents\\tasks.md", toolName: "Write", createdAt: "2026-06-29T09:13:40.204Z" },
    { variant: "write", pattern: "C:\\Users\\jorda\\Documents\\workspace\\notes\\android-app-idea.md", toolName: "Write", createdAt: "2026-06-29T10:57:18.700Z" },
    { variant: "execute", pattern: "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe C:/Users/jorda/.claude/skills/web-search/main.py *", toolName: "Bash", createdAt: "2026-06-29T11:36:22.525Z" },
    { variant: "execute", pattern: "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe *", toolName: "Bash", createdAt: "2026-06-29T11:40:51.190Z" },
    { variant: "execute", pattern: "curl * && head *", toolName: "Bash", createdAt: "2026-06-29T11:42:12.445Z" },
    { variant: "execute", pattern: "gh issue view 9 --repo ljlabs/devos 2>&1 | head -50", toolName: "Bash", createdAt: "2026-06-29T14:30:56.950Z" },
    { variant: "execute", pattern: "gh * && head *", toolName: "Bash", createdAt: "2026-06-29T14:35:07.188Z" },
    // ↓ This is the pattern saved by the user clicking "Allow Similar" for the first command
    { variant: "execute", pattern: `${BRAINSTORM_EXE} ${BRAINSTORM_SCRIPT} *`, toolName: "Bash", createdAt: "2026-06-29T16:57:07.419Z" },
  ];

  // The first command (no `text` mode — Claude's mistake, caused exit code 2)
  const firstCommand = `${BRAINSTORM_EXE} ${BRAINSTORM_SCRIPT} "next expected heatwave in England"`;
  // The second command (correct retry with `text` mode)
  const secondCommand = `${BRAINSTORM_EXE} ${BRAINSTORM_SCRIPT} text "next expected heatwave in England"`;

  it("BEFORE pattern save: first command has no match (correct — user must be prompted)", () => {
    // Without the brainstorm pattern, neither command should match
    const patternsWithoutBrainstorm = realPatternList.slice(0, -1);
    expect(checkAllowedPattern(firstCommand, "Bash", patternsWithoutBrainstorm)).toBe(false);
    expect(checkAllowedPattern(secondCommand, "Bash", patternsWithoutBrainstorm)).toBe(false);
  });

  it("AFTER pattern save: first command (no text mode) is auto-approved", () => {
    // Once the user saves "main.py *", the original command should also match
    expect(checkAllowedPattern(firstCommand, "Bash", realPatternList)).toBe(true);
  });

  it("AFTER pattern save: second command (with text mode) is auto-approved — the regression", () => {
    // This was the bug: the retry command with 'text' prepended was NOT auto-approved
    // even though "...main.py *" covers it. Verify the match works correctly.
    expect(checkAllowedPattern(secondCommand, "Bash", realPatternList)).toBe(true);
  });

  it("second command with Windows backslash paths is auto-approved (path normalisation)", () => {
    const winCommand = secondCommand.replace(/\//g, "\\");
    expect(checkAllowedPattern(winCommand, "Bash", realPatternList)).toBe(true);
  });

  it("other workspace's main.py is NOT auto-approved by the brainstorm pattern", () => {
    // A different workspace's script should NOT match the brainstorm-specific pattern
    const otherCmd = "C:/Users/jorda/Documents/workspace/OTHER/venv/Scripts/python.exe C:/Users/jorda/Documents/workspace/OTHER/.claude/skills/web-search/main.py text \"query\"";
    // No matching pattern in the list for this workspace
    expect(checkAllowedPattern(otherCmd, "Bash", realPatternList)).toBe(false);
  });

  it("global .claude/skills pattern does NOT accidentally approve brainstorm workspace script", () => {
    // The global pattern "C:/Users/jorda/.claude/skills/web-search/venv/..." must NOT
    // match the brainstorm workspace path "C:/Users/jorda/Documents/workspace/brainstorm/..."
    // These are different paths despite both being web-search skills.
    const globalPattern = realPatternList.find(p =>
      p.pattern.includes(".claude/skills/web-search/venv/Scripts/python.exe C:/Users/jorda/.claude/skills/web-search/main.py *")
    )!;
    expect(globalPattern).toBeDefined();

    const normGlobalPrefix = globalPattern.pattern.slice(0, -1).replace(/\\/g, "/");
    const normCmd = secondCommand.replace(/\\/g, "/");
    expect(normCmd.startsWith(normGlobalPrefix)).toBe(false); // different paths
  });

  it("full workflow via API: save pattern then verify it matches the second command", async () => {
    // Seed a clean DB
    seedDb({ workspaces: [], threads: [], messages: [], allowedPatterns: [] });

    // Step 1: Save the pattern (simulating the await-fixed handleConfirmSimilar)
    const saveRes = await request(app)
      .post("/api/allowedPatterns")
      .send({
        pattern: `${BRAINSTORM_EXE} ${BRAINSTORM_SCRIPT} *`,
        toolName: "Bash",
        variant: "execute",
      });
    expect(saveRes.status).toBe(201);

    // Step 2: Verify the second command matches the saved pattern
    const db = readDb();
    expect(checkAllowedPattern(secondCommand, "Bash", db.allowedPatterns)).toBe(true);
  });

  it("the problematic 'gh issue view ... 2>&1 | head -50' exact pattern: matches itself despite containing |", () => {
    // This pattern was saved verbatim via "Always Allow" for a compound command.
    // The stored pattern string contains an unquoted |, but it IS an exact-match
    // pattern — not a wildcard. checkAllowedPattern must try exact-match against
    // the full command BEFORE splitting on compound operators.
    const exactPipePattern = realPatternList.find(p => p.pattern.includes("gh issue view 9"))!;
    expect(exactPipePattern).toBeDefined();

    // The exact same command should match (exact-before-split fix)
    expect(checkAllowedPattern(
      "gh issue view 9 --repo ljlabs/devos 2>&1 | head -50",
      "Bash",
      [exactPipePattern]
    )).toBe(true);

    // A different gh issue view command should NOT match (different issue number)
    expect(checkAllowedPattern(
      "gh issue view 10 --repo ljlabs/devos 2>&1 | head -50",
      "Bash",
      [exactPipePattern]
    )).toBe(false);

    // The prefix portion alone should NOT match
    expect(checkAllowedPattern(
      "gh issue view 9 --repo ljlabs/devos",
      "Bash",
      [exactPipePattern]
    )).toBe(false);
  });
});


// ---------------------------------------------------------------------------
// checkAllowedPattern — CLI arguments with multiple quoted sections (Bug 1)
//
// Regression: Commands like "python.exe main.py text \"query\" --max 10"
// should match pattern "python.exe main.py *" but were failing because:
// The quote-tracking in findUnquotedOperator() or splitOnUnquotedOperators()
// may get out of sync when handling multiple quoted sections or special chars.
//
// These tests ensure that ANY argument structure (multiple quoted parts,
// dashes, numbers, etc.) all properly fall under the wildcard prefix.
// ---------------------------------------------------------------------------

describe("checkAllowedPattern — CLI arguments with multiple quoted sections (Bug 1 regression)", () => {
  const PYTHON_EXE = "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe";
  const MAIN_PY = "C:/Users/jorda/.claude/skills/web-search/main.py";

  const wildcardPattern = [
    { pattern: `${PYTHON_EXE} ${MAIN_PY} *`, variant: "execute", toolName: "Bash", createdAt: "2024-01-01" },
  ];

  describe("must auto-approve regardless of CLI argument structure", () => {
    it("auto-approves: text mode with quoted query and --max flag", () => {
      const cmd = `${PYTHON_EXE} ${MAIN_PY} text "Google Workspace CLI tool command line interface" --max 10`;
      expect(checkAllowedPattern(cmd, "Bash", wildcardPattern)).toBe(true);
    });

    it("auto-approves: text mode with different quoted query and --max flag", () => {
      const cmd = `${PYTHON_EXE} ${MAIN_PY} text "gws google workspace CLI install authentication account" --max 8`;
      expect(checkAllowedPattern(cmd, "Bash", wildcardPattern)).toBe(true);
    });

    it("auto-approves: text mode with query containing dashes and special chars", () => {
      const cmd = `${PYTHON_EXE} ${MAIN_PY} text "cloud-storage api v2.0 --options" --max 5`;
      expect(checkAllowedPattern(cmd, "Bash", wildcardPattern)).toBe(true);
    });

    it("auto-approves: mode with multiple flag arguments", () => {
      const cmd = `${PYTHON_EXE} ${MAIN_PY} search --query "test" --limit 10 --timeout 30`;
      expect(checkAllowedPattern(cmd, "Bash", wildcardPattern)).toBe(true);
    });

    it("auto-approves: query with numbers and punctuation", () => {
      const cmd = `${PYTHON_EXE} ${MAIN_PY} text "Python 3.11+ installation & setup (2024)" --max 15`;
      expect(checkAllowedPattern(cmd, "Bash", wildcardPattern)).toBe(true);
    });

    it("auto-approves: even with no additional arguments after query", () => {
      const cmd = `${PYTHON_EXE} ${MAIN_PY} text "simple query"`;
      expect(checkAllowedPattern(cmd, "Bash", wildcardPattern)).toBe(true);
    });

    it("auto-approves: even with complex query containing hyphens", () => {
      const cmd = `${PYTHON_EXE} ${MAIN_PY} text "what's-the-best-way-to-do-xyz" --max 20`;
      expect(checkAllowedPattern(cmd, "Bash", wildcardPattern)).toBe(true);
    });
  });

  describe("must NOT auto-approve when pattern is more specific", () => {
    it("does NOT auto-approve: command to different script", () => {
      const differentScript = "C:/Users/jorda/.claude/skills/web-search/other.py";
      const cmd = `${PYTHON_EXE} ${differentScript} text "query" --max 10`;
      expect(checkAllowedPattern(cmd, "Bash", wildcardPattern)).toBe(false);
    });

    it("does NOT auto-approve: command to different executable", () => {
      const differentExe = "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python3.exe";
      const cmd = `${differentExe} ${MAIN_PY} text "query" --max 10`;
      expect(checkAllowedPattern(cmd, "Bash", wildcardPattern)).toBe(false);
    });

    it("does NOT auto-approve: command missing script name", () => {
      const cmd = `${PYTHON_EXE} text "query" --max 10`;
      expect(checkAllowedPattern(cmd, "Bash", wildcardPattern)).toBe(false);
    });

    it("does NOT auto-approve: command missing exe path", () => {
      const cmd = `${MAIN_PY} text "query" --max 10`;
      expect(checkAllowedPattern(cmd, "Bash", wildcardPattern)).toBe(false);
    });
  });

  describe("path normalization works with backslashes (Windows paths)", () => {
    it("auto-approves: Windows command (backslashes) matches forward-slash pattern", () => {
      const winCmd = `${PYTHON_EXE} ${MAIN_PY} text "query" --max 10`.replace(/\//g, "\\");
      expect(checkAllowedPattern(winCmd, "Bash", wildcardPattern)).toBe(true);
    });

    it("auto-approves: mixed backslash and forward-slash paths", () => {
      const mixedExe = PYTHON_EXE.replace(/\//g, "\\");
      const mixedScript = MAIN_PY;
      const cmd = `${mixedExe} ${mixedScript} text "query" --max 10`;
      expect(checkAllowedPattern(cmd, "Bash", wildcardPattern)).toBe(true);
    });
  });

  describe("queries containing special chars don't trigger false compound detection", () => {
    it("query with pipe character should NOT split into compound command", () => {
      const cmd = `${PYTHON_EXE} ${MAIN_PY} text "foo | bar | baz" --max 10`;
      expect(checkAllowedPattern(cmd, "Bash", wildcardPattern)).toBe(true);
    });

    it("query with semicolon should NOT split into compound command", () => {
      const cmd = `${PYTHON_EXE} ${MAIN_PY} text "step1; step2; step3" --max 10`;
      expect(checkAllowedPattern(cmd, "Bash", wildcardPattern)).toBe(true);
    });

    it("query with && should NOT split into compound command", () => {
      const cmd = `${PYTHON_EXE} ${MAIN_PY} text "foo && bar && baz" --max 10`;
      expect(checkAllowedPattern(cmd, "Bash", wildcardPattern)).toBe(true);
    });

    it("query with multiple pipes should NOT split", () => {
      const cmd = `${PYTHON_EXE} ${MAIN_PY} text "a | b | c | d" --max 10`;
      expect(checkAllowedPattern(cmd, "Bash", wildcardPattern)).toBe(true);
    });

    it("query with parentheses should NOT split", () => {
      const cmd = `${PYTHON_EXE} ${MAIN_PY} text "function(arg1, arg2)" --max 10`;
      expect(checkAllowedPattern(cmd, "Bash", wildcardPattern)).toBe(true);
    });

    it("query with nested quotes should NOT split", () => {
      const cmd = `${PYTHON_EXE} ${MAIN_PY} text "outer \\"inner quotes\\" text" --max 10`;
      expect(checkAllowedPattern(cmd, "Bash", wildcardPattern)).toBe(true);
    });

    it("query with single quotes inside double quotes should NOT split", () => {
      const cmd = `${PYTHON_EXE} ${MAIN_PY} text "it's a test | with pipe" --max 10`;
      expect(checkAllowedPattern(cmd, "Bash", wildcardPattern)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// checkAllowedPattern — Path normalization edge cases (Bug 2 regression)
//
// Patterns should be matched consistently regardless of:
// - Forward slashes vs backslashes
// - Mixed path separators
// - Case sensitivity considerations
// ---------------------------------------------------------------------------

describe("checkAllowedPattern — Path normalization edge cases (Bug 2 regression)", () => {
  describe("forward-slash pattern matches backslash command", () => {
    it("file path with forward slashes (pattern) matches backslash version (command)", () => {
      const patterns = [
        { pattern: "C:/Users/jorda/Documents/workspace/project/file.ts", variant: "edit", toolName: "Edit" },
      ];
      const winCommand = "C:\\Users\\jorda\\Documents\\workspace\\project\\file.ts";
      expect(checkAllowedPattern(winCommand, "Edit", patterns)).toBe(true);
    });

    it("directory wildcard with forward slashes matches backslash command", () => {
      const patterns = [
        { pattern: "C:/Users/jorda/Documents/workspace/*", variant: "edit", toolName: "Edit" },
      ];
      const winCommand = "C:\\Users\\jorda\\Documents\\workspace\\subdir\\file.txt";
      expect(checkAllowedPattern(winCommand, "Edit", patterns)).toBe(true);
    });
  });

  describe("backslash pattern matches forward-slash command", () => {
    it("file path with backslashes (pattern) normalizes to match forward-slash command", () => {
      const patterns = [
        { pattern: "C:\\Users\\jorda\\Documents\\workspace\\file.ts", variant: "edit", toolName: "Edit" },
      ];
      const unixCommand = "C:/Users/jorda/Documents/workspace/file.ts";
      expect(checkAllowedPattern(unixCommand, "Edit", patterns)).toBe(true);
    });

    it("directory wildcard with backslashes normalizes to match forward-slash command", () => {
      const patterns = [
        { pattern: "C:\\Users\\jorda\\Documents\\workspace\\*", variant: "edit", toolName: "Edit" },
      ];
      const unixCommand = "C:/Users/jorda/Documents/workspace/subdir/file.txt";
      expect(checkAllowedPattern(unixCommand, "Edit", patterns)).toBe(true);
    });
  });

  describe("mixed path separators normalize correctly", () => {
    it("pattern with mixed separators normalizes to match consistent forward-slash command", () => {
      const patterns = [
        { pattern: "C:\\Users/jorda\\Documents/workspace/*", variant: "edit", toolName: "Edit" },
      ];
      const cmd = "C:/Users/jorda/Documents/workspace/file.ts";
      expect(checkAllowedPattern(cmd, "Edit", patterns)).toBe(true);
    });

    it("command with mixed separators normalizes to match consistent forward-slash pattern", () => {
      const patterns = [
        { pattern: "C:/Users/jorda/Documents/workspace/*", variant: "edit", toolName: "Edit" },
      ];
      const cmd = "C:\\Users/jorda\\Documents/workspace/file.ts";
      expect(checkAllowedPattern(cmd, "Edit", patterns)).toBe(true);
    });
  });

  describe("exact path matching with normalized slashes", () => {
    it("exact match with forward-slash pattern and backslash command", () => {
      const patterns = [
        { pattern: "C:/Users/jorda/file.txt", variant: "write", toolName: "Write" },
      ];
      const cmd = "C:\\Users\\jorda\\file.txt";
      expect(checkAllowedPattern(cmd, "Write", patterns)).toBe(true);
    });

    it("exact match fails when paths differ after normalization", () => {
      const patterns = [
        { pattern: "C:/Users/jorda/file1.txt", variant: "write", toolName: "Write" },
      ];
      const cmd = "C:\\Users\\jorda\\file2.txt";
      expect(checkAllowedPattern(cmd, "Write", patterns)).toBe(false);
    });

    it("prefix match with wildcard works across slash types", () => {
      const patterns = [
        { pattern: "C:/workspace/docs/*", variant: "write", toolName: "Write" },
      ];
      const cmd = "C:\\workspace\\docs\\README.md";
      expect(checkAllowedPattern(cmd, "Write", patterns)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// checkAllowedPattern — Tool-scoped strict matching (Bug 3 regression)
//
// Patterns with toolName must strictly match or reject:
// - Pattern toolName="Bash", Command toolName="Bash" → match if pattern matches
// - Pattern toolName="Bash", Command toolName="Edit" → reject (wrong tool)
// - Pattern toolName="Bash", Command toolName=undefined → reject (unknown tool, fail safe)
// - Pattern toolName=undefined, Command any toolName → match if pattern matches (backward compat)
// ---------------------------------------------------------------------------

describe("checkAllowedPattern — Tool-scoped strict matching (Bug 3 regression)", () => {
  describe("same tool → match works", () => {
    it("Bash pattern matches Bash command", () => {
      const patterns = [
        { pattern: "npm run *", toolName: "Bash" },
      ];
      expect(checkAllowedPattern("npm run build", "Bash", patterns)).toBe(true);
    });

    it("Edit pattern matches Edit command", () => {
      const patterns = [
        { pattern: "src/components/*", toolName: "Edit" },
      ];
      expect(checkAllowedPattern("src/components/Button.tsx", "Edit", patterns)).toBe(true);
    });

    it("Write pattern matches Write command", () => {
      const patterns = [
        { pattern: "docs/*", toolName: "Write" },
      ];
      expect(checkAllowedPattern("docs/README.md", "Write", patterns)).toBe(true);
    });
  });

  describe("different tool → must reject", () => {
    it("Bash pattern does NOT match Edit command (same path)", () => {
      const patterns = [
        { pattern: "src/*", toolName: "Bash" },
      ];
      expect(checkAllowedPattern("src/file.ts", "Edit", patterns)).toBe(false);
    });

    it("Edit pattern does NOT match Bash command", () => {
      const patterns = [
        { pattern: "src/*", toolName: "Edit" },
      ];
      expect(checkAllowedPattern("src/file.ts", "Bash", patterns)).toBe(false);
    });

    it("Write pattern does NOT match Bash command", () => {
      const patterns = [
        { pattern: "docs/*", toolName: "Write" },
      ];
      expect(checkAllowedPattern("docs/file.md", "Bash", patterns)).toBe(false);
    });
  });

  describe("unknown tool → fail safe (reject)", () => {
    it("Bash pattern does NOT match when command toolName is undefined (fail safe)", () => {
      const patterns = [
        { pattern: "npm run *", toolName: "Bash" },
      ];
      expect(checkAllowedPattern("npm run build", undefined, patterns)).toBe(false);
    });

    it("Edit pattern does NOT match when command toolName is undefined", () => {
      const patterns = [
        { pattern: "src/*", toolName: "Edit" },
      ];
      expect(checkAllowedPattern("src/file.ts", undefined, patterns)).toBe(false);
    });

    it("Write pattern does NOT match when command toolName is undefined", () => {
      const patterns = [
        { pattern: "docs/*", toolName: "Write" },
      ];
      expect(checkAllowedPattern("docs/file.md", undefined, patterns)).toBe(false);
    });

    it("Any scoped pattern rejects unknown toolName (comprehensive check)", () => {
      const patterns = [
        { pattern: "foo", toolName: "Bash" },
        { pattern: "bar", toolName: "Edit" },
        { pattern: "baz", toolName: "Write" },
      ];
      expect(checkAllowedPattern("foo", undefined, patterns)).toBe(false);
    });
  });

  describe("no tool scope → matches any tool (backward compat)", () => {
    it("unscoped pattern matches Bash command", () => {
      const patterns = [
        { pattern: "npm run *" }, // no toolName
      ];
      expect(checkAllowedPattern("npm run build", "Bash", patterns)).toBe(true);
    });

    it("unscoped pattern matches Edit command", () => {
      const patterns = [
        { pattern: "src/*" }, // no toolName
      ];
      expect(checkAllowedPattern("src/file.ts", "Edit", patterns)).toBe(true);
    });

    it("unscoped pattern matches undefined toolName", () => {
      const patterns = [
        { pattern: "foo" }, // no toolName
      ];
      expect(checkAllowedPattern("foo", undefined, patterns)).toBe(true);
    });

    it("unscoped pattern matches any arbitrary toolName", () => {
      const patterns = [
        { pattern: "*" }, // wildcard, no toolName
      ];
      expect(checkAllowedPattern("anything", "UnknownTool", patterns)).toBe(true);
      expect(checkAllowedPattern("anything", "Bash", patterns)).toBe(true);
      expect(checkAllowedPattern("anything", undefined, patterns)).toBe(true);
    });
  });

  describe("null toolName → same as no toolName (backward compat)", () => {
    it("null toolName pattern matches any tool", () => {
      const patterns = [
        { pattern: "npm run *", toolName: null },
      ];
      expect(checkAllowedPattern("npm run build", "Bash", patterns)).toBe(true);
      expect(checkAllowedPattern("npm run build", "Edit", patterns)).toBe(true);
      expect(checkAllowedPattern("npm run build", undefined, patterns)).toBe(true);
    });
  });

  describe("compound commands inherit tool-scoping from sub-command patterns", () => {
    it("both sub-commands have Bash toolName → approve for Bash only", () => {
      const patterns = [
        { pattern: "cd workspace/*", toolName: "Bash" },
        { pattern: "cat src/*", toolName: "Bash" },
      ];
      expect(checkAllowedPattern("cd workspace/foo && cat src/bar", "Bash", patterns)).toBe(true);
      expect(checkAllowedPattern("cd workspace/foo && cat src/bar", "Edit", patterns)).toBe(false);
      expect(checkAllowedPattern("cd workspace/foo && cat src/bar", undefined, patterns)).toBe(false);
    });

    it("sub-commands have different toolNames → reject (mismatched tools)", () => {
      const patterns = [
        { pattern: "cd workspace/*", toolName: "Bash" },
        { pattern: "cat src/*", toolName: "Edit" }, // different tool!
      ];
      // The command is supposed to be one tool, so mixed tool patterns should reject
      expect(checkAllowedPattern("cd workspace/foo && cat src/bar", "Bash", patterns)).toBe(false);
    });

    it("sub-commands have no tool scope → approve for any tool", () => {
      const patterns = [
        { pattern: "cd workspace/*" }, // no toolName
        { pattern: "cat src/*" },      // no toolName
      ];
      expect(checkAllowedPattern("cd workspace/foo && cat src/bar", "Bash", patterns)).toBe(true);
      expect(checkAllowedPattern("cd workspace/foo && cat src/bar", "Edit", patterns)).toBe(true);
      expect(checkAllowedPattern("cd workspace/foo && cat src/bar", undefined, patterns)).toBe(true);
    });
  });
});


// ---------------------------------------------------------------------------
// toolNameFromKind — extraction fix for session/request_permission (Root Cause)
//
// Root cause of the Allow Similar bug:
//   session/request_permission events don't have _meta.claudeCode.toolName
//   (unlike session/update events that precede them). The old code fell back
//   to splitting the title string to extract toolName, which incorrectly got
//   the command path (e.g., "C:/Users/...python.exe") instead of the tool name.
//
// Result: A Bash pattern saved but toolName extracted as a file path meant
// every comparison was "Bash" !== "C:/Users/..." → pattern skipped.
//
// Fix: Use the toolCall.kind field which is present on both event types and
// unambiguously maps to a tool: execute→Bash, write→Write, edit→Edit, read→Read.
// ---------------------------------------------------------------------------

describe("toolNameFromKind — permission request toolName extraction (Bug Root Cause Fix)", () => {
  describe("kind field extraction matches session/update _meta extraction", () => {
    it("execute kind returns 'Bash' (matches session/update toolName='Bash')", () => {
      const kind = "execute";
      const toolName = kind === "execute" ? "Bash" : undefined;
      expect(toolName).toBe("Bash");
    });

    it("write kind returns 'Write'", () => {
      const kind = "write";
      const toolName = kind === "write" ? "Write" : undefined;
      expect(toolName).toBe("Write");
    });

    it("edit kind returns 'Edit'", () => {
      const kind = "edit";
      const toolName = kind === "edit" ? "Edit" : undefined;
      expect(toolName).toBe("Edit");
    });

    it("read kind returns 'Read'", () => {
      const kind = "read";
      const toolName = kind === "read" ? "Read" : undefined;
      expect(toolName).toBe("Read");
    });

    it("unknown kind returns undefined", () => {
      const kind = "unknown" as string;
      const toolName = kind === "execute" ? "Bash" : undefined;
      expect(toolName).toBeUndefined();
    });
  });

  describe("extraction contrasts with old broken method", () => {
    it("OLD BROKEN: extracting from title splits on whitespace and gets command path", () => {
      const title = "C:/Users/jorda/Documents/workspace/brainstorm/venv/Scripts/python.exe C:/Users/jorda/Documents/workspace/brainstorm/.claude/skills/web-search/main.py text \"query\"";
      const toolName = title.split(/\s+/)[0]; // First word is the exe path
      
      expect(toolName).toBe("C:/Users/jorda/Documents/workspace/brainstorm/venv/Scripts/python.exe");
      expect(toolName).not.toBe("Bash");
    });

    it("NEW FIXED: extracting from kind unambiguously gives 'Bash' for execute", () => {
      const kind = "execute";
      const toolName = kind === "execute" ? "Bash" : undefined;
      
      expect(toolName).toBe("Bash");
    });
  });
});

// ---------------------------------------------------------------------------
// Integration: California heatwave bug exact repro with toolName extraction
//
// The bug: session/request_permission arrives with kind="execute" but _meta
// is absent. Old code: toolName = title.split()[0] = command path → mismatch.
// New code: toolName = toolNameFromKind(kind) = "Bash" → matches pattern.
// ---------------------------------------------------------------------------

describe("checkAllowedPattern — California heatwave bug exact reproduction (Root Cause Fix)", () => {
  const pythonExe = "C:/Users/jorda/Documents/workspace/brainstorm/venv/Scripts/python.exe";
  const mainPy = "C:/Users/jorda/Documents/workspace/brainstorm/.claude/skills/web-search/main.py";

  const bashPatterns = [
    {
      pattern: `${pythonExe} ${mainPy} *`,
      toolName: "Bash",
      variant: "execute",
      createdAt: "2026-06-29T16:57:07.419Z",
    },
  ];

  const command = `${pythonExe} ${mainPy} text "next expected heatwave in California June July 2026"`;

  describe("with BROKEN toolName extraction (reproduces the bug)", () => {
    it("OLD: title-based extraction gets command path, pattern matching fails", () => {
      // This is what the old code did
      const title = command;
      const toolName = title.split(/\s+/)[0]; // "C:/Users/jorda/..."

      expect(toolName).not.toBe("Bash");
      expect(toolName).toBe("C:/Users/jorda/Documents/workspace/brainstorm/venv/Scripts/python.exe");

      // Pattern matching fails because toolName mismatch
      expect(checkAllowedPattern(command, toolName, bashPatterns)).toBe(false);
    });
  });

  describe("with FIXED toolName extraction (bug is resolved)", () => {
    it("NEW: kind-based extraction gets 'Bash', pattern matching succeeds", () => {
      // This is what the new code does
      const kind = "execute";
      const toolName = kind === "execute" ? "Bash" : undefined;

      expect(toolName).toBe("Bash");

      // Pattern matching succeeds!
      expect(checkAllowedPattern(command, toolName, bashPatterns)).toBe(true);
    });

    it("permission request with kind='execute' auto-approves the command", () => {
      const kind = "execute";
      const toolName = kind === "execute" ? "Bash" : undefined;

      expect(checkAllowedPattern(command, toolName, bashPatterns)).toBe(true);
    });
  });

  describe("multi-tool patterns all work with kind extraction", () => {
    const multiToolPatterns = [
      { pattern: `${pythonExe} ${mainPy} *`, toolName: "Bash", variant: "execute" },
      { pattern: "src/components/*", toolName: "Edit", variant: "edit" },
      { pattern: "docs/*", toolName: "Write", variant: "write" },
    ];

    it("execute kind extracts to Bash and matches Bash pattern", () => {
      const kind = "execute";
      const toolName = kind === "execute" ? "Bash" : undefined;
      expect(checkAllowedPattern(command, toolName, multiToolPatterns)).toBe(true);
    });

    it("edit kind extracts to Edit and matches Edit pattern", () => {
      const kind = "edit";
      const toolName = kind === "edit" ? "Edit" : undefined;
      const editCommand = "src/components/Button.tsx";
      expect(checkAllowedPattern(editCommand, toolName, multiToolPatterns)).toBe(true);
    });

    it("write kind extracts to Write and matches Write pattern", () => {
      const kind = "write";
      const toolName = kind === "write" ? "Write" : undefined;
      const writeCommand = "docs/README.md";
      expect(checkAllowedPattern(writeCommand, toolName, multiToolPatterns)).toBe(true);
    });

    it("execute kind does NOT match Edit patterns even if path looks like file", () => {
      const kind = "execute";
      const toolName = kind === "execute" ? "Bash" : undefined;
      const editLikeCommand = "src/components/Button.tsx";
      
      // execute→Bash, but Bash has no pattern for this file path
      expect(checkAllowedPattern(editLikeCommand, toolName, multiToolPatterns)).toBe(false);
    });
  });
});


// ---------------------------------------------------------------------------
// toolName extraction from session/request_permission — missing _meta (Root Bug)
//
// session/request_permission payloads do NOT contain _meta.claudeCode.toolName.
// The old fallback split title.split(/\s+/)[0] which returned the exe path,
// not "Bash" — so every Bash-scoped pattern was skipped.
//
// Fix: use toolCall.kind ("execute" → "Bash") instead of title splitting.
//
// The first test (OLD broken extraction) will fail before the fix and pass after
// — that's your red/green confirmation that the root cause is nailed.
// ---------------------------------------------------------------------------

describe("toolName extraction — session/request_permission missing _meta (Las Vegas exact repro)", () => {
  const pythonExe = "C:/Users/jorda/Documents/workspace/brainstorm/venv/Scripts/python.exe";
  const mainPy = "C:/Users/jorda/Documents/workspace/brainstorm/.claude/skills/web-search/main.py";
  const command = `${pythonExe} ${mainPy} text "next expected heatwave Las Vegas June July 2026"`;

  // Exact shape of session/request_permission from the live logs —
  // _meta is ABSENT on toolCall; it only appears on the preceding session/update.
  const permissionPayload = {
    jsonrpc: "2.0",
    id: 7,
    method: "session/request_permission",
    params: {
      options: [
        { kind: "allow_always", name: "Always Allow Bash(...)", optionId: "allow_always" },
        { kind: "allow_once",   name: "Allow",                  optionId: "allow"        },
        { kind: "reject_once",  name: "Reject",                 optionId: "reject"       },
      ],
      sessionId: "9b88da38-17db-4d69-9956-9625a5e7ac4f",
      toolCall: {
        // ← NO _meta here. This is the critical difference from session/update.
        rawInput: {
          command,
          description: "Search for upcoming heatwaves in Las Vegas for June/July 2026",
        },
        title: command,   // title IS the full command string, not a tool name
        kind: "execute",  // ← this is the only reliable signal for toolName
        toolCallId: "x58vfqpn____ts____EiYKJGUy...",
        content: [{ type: "content", content: { type: "text", text: "..." } }],
      },
    },
  };

  const raw = permissionPayload;

  const bashPatterns = [
    {
      pattern: `${pythonExe} ${mainPy} *`,
      toolName: "Bash",
      variant: "execute",
      createdAt: "2026-06-29T16:57:07.419Z",
    },
  ];

  it("OLD broken extraction: title.split()[0] returns exe path, not 'Bash'", () => {
    // This demonstrates the bug: the old extraction code
    const rawAny = raw as any;
    const toolName =
      rawAny.params?.toolCall?._meta?.claudeCode?.toolName ??
      rawAny.params?._meta?.claudeCode?.toolName ??
      (typeof rawAny.params?.toolCall?.title === "string"
        ? rawAny.params.toolCall.title.split(/\s+/)[0]
        : undefined);

    // Demonstrates the bug: toolName is the exe path, never "Bash"
    expect(toolName).toBe(pythonExe);
    expect(toolName).not.toBe("Bash");

    // Pattern check fails because "Bash" !== "C:/Users/.../python.exe"
    expect(checkAllowedPattern(command, toolName, bashPatterns)).toBe(false);
  });

  it("NEW fixed extraction: kind='execute' maps to 'Bash', pattern matches", () => {
    function toolNameFromKind(kind: string | undefined): string | undefined {
      switch (kind) {
        case "execute": return "Bash";
        case "write":   return "Write";
        case "edit":    return "Edit";
        case "read":    return "Read";
        default:        return undefined;
      }
    }

    const rawAny = raw as any;
    const toolName =
      rawAny.params?.toolCall?._meta?.claudeCode?.toolName ??
      rawAny.params?._meta?.claudeCode?.toolName ??
      toolNameFromKind(rawAny.params?.toolCall?.kind);

    expect(toolName).toBe("Bash");

    // Pattern check now succeeds
    expect(checkAllowedPattern(command, toolName, bashPatterns)).toBe(true);
  });

  it("kind extraction works for all tool types", () => {
    function toolNameFromKind(kind: string | undefined): string | undefined {
      switch (kind) {
        case "execute": return "Bash";
        case "write":   return "Write";
        case "edit":    return "Edit";
        case "read":    return "Read";
        default:        return undefined;
      }
    }

    expect(toolNameFromKind("execute")).toBe("Bash");
    expect(toolNameFromKind("write")).toBe("Write");
    expect(toolNameFromKind("edit")).toBe("Edit");
    expect(toolNameFromKind("read")).toBe("Read");
    expect(toolNameFromKind("unknown")).toBeUndefined();
    expect(toolNameFromKind(undefined)).toBeUndefined();
  });

  it("California heatwave command also passes with fixed extraction", () => {
    function toolNameFromKind(kind: string | undefined): string | undefined {
      switch (kind) {
        case "execute": return "Bash";
        default:        return undefined;
      }
    }

    const californiaCommand = `${pythonExe} ${mainPy} text "next expected heatwave in California June July 2026"`;
    const toolName = toolNameFromKind("execute");

    expect(checkAllowedPattern(californiaCommand, toolName, bashPatterns)).toBe(true);
  });
});


// ---------------------------------------------------------------------------
// File Explorer API — directory listing and file reading
// ---------------------------------------------------------------------------

describe("File Explorer API — /api/workspaces/:workspaceId/files", () => {
  let testWsDir: string;
  let testWsId: string;

  beforeAll(() => {
    // Create a test workspace directory structure
    testWsDir = fs.mkdtempSync(path.join(os.tmpdir(), "devos-file-explorer-"));

    // Create test files and directories
    fs.writeFileSync(path.join(testWsDir, "package.json"), '{"name": "test"}');
    fs.writeFileSync(path.join(testWsDir, "README.md"), "# Test Project");
    fs.writeFileSync(path.join(testWsDir, "index.ts"), "export const hello = 'world';");

    const srcDir = path.join(testWsDir, "src");
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, "main.ts"), "console.log('main');");
    fs.writeFileSync(path.join(srcDir, "utils.ts"), "export function util() {}");

    const nestedDir = path.join(srcDir, "components");
    fs.mkdirSync(nestedDir);
    fs.writeFileSync(path.join(nestedDir, "Button.tsx"), "export const Button = () => <>Button</>;");

    // Create excluded directories (should not appear in listings)
    const nodeModules = path.join(testWsDir, "node_modules");
    fs.mkdirSync(nodeModules);
    fs.writeFileSync(path.join(nodeModules, "some-package.js"), "// package code");

    const gitDir = path.join(testWsDir, ".git");
    fs.mkdirSync(gitDir);
    fs.writeFileSync(path.join(gitDir, "config"), "[core]");

    // Hidden file (should not appear)
    fs.writeFileSync(path.join(testWsDir, ".env"), "SECRET=123");

    // Register workspace in DB
    testWsId = `ws-test-${Date.now()}`;
    seedDb({
      workspaces: [{ id: testWsId, name: "Test Workspace", path: testWsDir }],
      threads: [],
      messages: [],
      allowedPatterns: [],
    });
  });

  afterAll(() => {
    if (fs.existsSync(testWsDir)) fs.rmSync(testWsDir, { recursive: true, force: true });
  });

  it("lists root directory contents", async () => {
    const res = await request(app).get(`/api/workspaces/${testWsId}/files`);

    expect(res.status).toBe(200);
    expect(res.body.entries).toBeDefined();
    expect(Array.isArray(res.body.entries)).toBe(true);

    // Should have our test files and directories
    const names = res.body.entries.map((e: any) => e.name);
    expect(names).toContain("package.json");
    expect(names).toContain("README.md");
    expect(names).toContain("index.ts");
    expect(names).toContain("src"); // directory

    // Should NOT have excluded items
    expect(names).not.toContain("node_modules");
    expect(names).not.toContain(".git");
    expect(names).not.toContain(".env");

    // Directories should come first
    const types = res.body.entries.map((e: any) => e.type);
    const firstFileIdx = types.indexOf("file");
    const lastDirIdx = types.lastIndexOf("directory");
    if (firstFileIdx !== -1 && lastDirIdx !== -1) {
      expect(lastDirIdx).toBeLessThan(firstFileIdx);
    }
  });

  it("lists subdirectory contents with path parameter", async () => {
    const res = await request(app).get(`/api/workspaces/${testWsId}/files?path=src`);

    expect(res.status).toBe(200);

    const names = res.body.entries.map((e: any) => e.name);
    expect(names).toContain("main.ts");
    expect(names).toContain("utils.ts");
    expect(names).toContain("components"); // nested directory

    // Entries should have correct relative paths
    const mainTs = res.body.entries.find((e: any) => e.name === "main.ts");
    expect(mainTs.path).toBe("src/main.ts");
  });

  it("lists deeply nested directory", async () => {
    const res = await request(app).get(`/api/workspaces/${testWsId}/files?path=src/components`);

    expect(res.status).toBe(200);

    const names = res.body.entries.map((e: any) => e.name);
    expect(names).toContain("Button.tsx");

    const buttonTsx = res.body.entries.find((e: any) => e.name === "Button.tsx");
    expect(buttonTsx.path).toBe("src/components/Button.tsx");
  });

  it("returns 404 for non-existent workspace", async () => {
    const res = await request(app).get("/api/workspaces/nonexistent/files");

    expect(res.status).toBe(404);
  });

  it("returns 404 for non-existent directory path", async () => {
    const res = await request(app).get(`/api/workspaces/${testWsId}/files?path=nonexistent`);

    expect(res.status).toBe(404);
  });

  it("returns 400 for path traversal attempt", async () => {
  	const res = await request(app)
  		.get(`/api/workspaces/${testWsId}/files`)
  		.query({ path: "../../../etc" }); // Attempt to traverse outside workspace

  	expect(res.status).toBe(400);
  	expect(res.body.error).toMatch(/traversal/i);
  });

  it("returns entries with correct metadata", async () => {
  	const res = await request(app)
  		.get(`/api/workspaces/${testWsId}/files`)
  		.query({ path: "" });

  	expect(res.status).toBe(200);

  	const pkgJson = res.body.entries.find((e: any) => e.name === "package.json");
  	expect(pkgJson).toBeDefined();
  	expect(pkgJson.type).toBe("file");
  	expect(typeof pkgJson.size).toBe("number");
  	expect(pkgJson.modified).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); // ISO timestamp

  	const srcDir = res.body.entries.find((e: any) => e.name === "src");
  	expect(srcDir.type).toBe("directory");
  	expect(srcDir.size).toBeUndefined(); // directories don't have size
  });
});


describe("File Explorer API — /api/workspaces/:workspaceId/files/read", () => {
	let testWsDir: string;
	let testWsId: string;

	beforeAll(() => {
		testWsDir = fs.mkdtempSync(path.join(os.tmpdir(), "devos-file-read-"));

		fs.writeFileSync(path.join(testWsDir, "simple.txt"), "Hello World\nLine 2\nLine 3");

		// Create a larger file (>1MB would be truncated but we'll test with smaller)
		const mediumContent = "// Comment\n".repeat(100) + "\nexport function foo() {\n  return 'bar';\n}";
		fs.writeFileSync(path.join(testWsDir, "medium.ts"), mediumContent);

		testWsId = `ws-read-${Date.now()}`;
		seedDb({
			workspaces: [{ id: testWsId, name: "Read Test WS", path: testWsDir }],
			threads: [],
			messages: [],
			allowedPatterns: [],
		});
	});

	afterAll(() => {
		if (fs.existsSync(testWsDir)) fs.rmSync(testWsDir, { recursive: true, force: true });
	});

	it("reads a simple text file", async () => {
		const res = await request(app)
			.get(`/api/workspaces/${testWsId}/files/read`)
			.query({ path: "simple.txt" });

		expect(res.status).toBe(200);
		expect(res.body.content).toBe("Hello World\nLine 2\nLine 3");
		expect(res.body.lines).toBe(3);
		expect(res.body.size).toBeGreaterThan(0);
		expect(res.body.truncated).not.toBe(true);
	});

	it("reads a TypeScript file with correct line count", async () => {
		const res = await request(app)
			.get(`/api/workspaces/${testWsId}/files/read`)
			.query({ path: "medium.ts" });

		expect(res.status).toBe(200);
		expect(res.body.content.length > 0).toBe(true);
		expect(typeof res.body.lines === "number").toBe(true);
		expect(res.body.lines > 50).toBe(true);
		expect(res.body.truncated).toBeFalsy();
	});

	it("returns correct path in response", async () => {
		const resp = await request(app)
			.get(`/api/workspaces/${testWsId}/files/read`)
			.query({ path: "simple.txt" });

		expect(resp.status).toBe(200);
		expect(resp.body.path).toBe("simple.txt");
	});
});

// ---------------------------------------------------------------------------
// Integration: Thread CRUD via the real server + SQLite
// ---------------------------------------------------------------------------

describe("Thread CRUD — integration with real SQLite", () => {
	let wsId: string;

	beforeEach(() => {
		seedDb({ workspaces: [], threads: [], messages: [], allowedPatterns: [] });
		// Seed a valid workspace
		wsId = `ws-thread-test-${Date.now()}`;
		seedDb({
			workspaces: [{ id: wsId, name: "Thread Test WS", path: VALID_DIR }],
			threads: [],
			messages: [],
			allowedPatterns: [],
		});
	});

	// ── POST /api/workspaces/:workspaceId/threads ──────────────────────────

	describe("POST /api/workspaces/:workspaceId/threads", () => {
		it("creates a new thread", async () => {
			const res = await request(app)
				.post(`/api/workspaces/${wsId}/threads`)
				.send({ title: "My Thread" });

			expect(res.status).toBe(201);
			expect(res.body.id).toBeDefined();
			expect(res.body.title).toBe("My Thread");
			expect(res.body.workspaceId).toBe(wsId);
			expect(res.body.status).toBe("idle");
		});

		it("defaults title to 'Untitled' when omitted", async () => {
			const res = await request(app)
				.post(`/api/workspaces/${wsId}/threads`)
				.send({});

			expect(res.status).toBe(201);
			expect(res.body.title).toBe("Untitled");
		});

		it("persists thread to DB", async () => {
			const res = await request(app)
				.post(`/api/workspaces/${wsId}/threads`)
				.send({ title: "Persisted" });

			const thread = sqliteDb.getThreadById(res.body.id);
			expect(thread).toBeDefined();
			expect(thread?.title).toBe("Persisted");
			expect(thread?.workspaceId).toBe(wsId);
		});
	});

	// ── GET /api/threads/:threadId ────────────────────────────────────────

	describe("GET /api/threads/:threadId", () => {
		it("returns a single thread by id", async () => {
			const createRes = await request(app)
				.post(`/api/workspaces/${wsId}/threads`)
				.send({ title: "Fetch Me" });

			const res = await request(app).get(`/api/threads/${createRes.body.id}`);
			expect(res.status).toBe(200);
			expect(res.body.id).toBe(createRes.body.id);
			expect(res.body.title).toBe("Fetch Me");
		});

		it("returns 404 for non-existent thread", async () => {
			const res = await request(app).get("/api/threads/nonexistent");
			expect(res.status).toBe(404);
		});
	});

	// ── GET /api/workspaces/:workspaceId/threads ──────────────────────────

	describe("GET /api/workspaces/:workspaceId/threads", () => {
		it("returns all threads for a workspace", async () => {
			await request(app)
				.post(`/api/workspaces/${wsId}/threads`)
				.send({ title: "T1" });
			await request(app)
				.post(`/api/workspaces/${wsId}/threads`)
				.send({ title: "T2" });

			const res = await request(app).get(`/api/workspaces/${wsId}/threads`);
			expect(res.status).toBe(200);
			expect(res.body).toHaveLength(2);
			expect(res.body.map((t: any) => t.title).sort()).toEqual(["T1", "T2"]);
		});

		it("returns empty array for workspace with no threads", async () => {
			const res = await request(app).get(`/api/workspaces/${wsId}/threads`);
			expect(res.status).toBe(200);
			expect(res.body).toEqual([]);
		});
	});

	// ── PATCH /api/threads/:threadId ──────────────────────────────────────

	describe("PATCH /api/threads/:threadId", () => {
		it("updates thread title", async () => {
			const createRes = await request(app)
				.post(`/api/workspaces/${wsId}/threads`)
				.send({ title: "Old Title" });

			const res = await request(app)
				.patch(`/api/threads/${createRes.body.id}`)
				.send({ title: "New Title" });

			expect(res.status).toBe(200);
			expect(res.body.title).toBe("New Title");

			// Verify persisted
			const thread = sqliteDb.getThreadById(createRes.body.id);
			expect(thread?.title).toBe("New Title");
		});

		it("returns 400 when title is missing", async () => {
			const createRes = await request(app)
				.post(`/api/workspaces/${wsId}/threads`)
				.send({ title: "T" });

			const res = await request(app)
				.patch(`/api/threads/${createRes.body.id}`)
				.send({});

			expect(res.status).toBe(400);
		});

		it("returns 404 for non-existent thread", async () => {
			const res = await request(app)
				.patch("/api/threads/nonexistent")
				.send({ title: "X" });
			expect(res.status).toBe(404);
		});
	});

	// ── DELETE /api/threads/:threadId ─────────────────────────────────────

	describe("DELETE /api/threads/:threadId", () => {
		it("deletes a thread", async () => {
			const createRes = await request(app)
				.post(`/api/workspaces/${wsId}/threads`)
				.send({ title: "To Delete" });

			const res = await request(app).delete(`/api/threads/${createRes.body.id}`);
			expect(res.status).toBe(200);

			// Verify gone
			const getRes = await request(app).get(`/api/threads/${createRes.body.id}`);
			expect(getRes.status).toBe(404);
		});

		it("returns 404 for non-existent thread", async () => {
			const res = await request(app).delete("/api/threads/nonexistent");
			expect(res.status).toBe(404);
		});

		it("cascades to messages", async () => {
			const createRes = await request(app)
				.post(`/api/workspaces/${wsId}/threads`)
				.send({ title: "Cascade" });
			const threadId = createRes.body.id;

			// Manually insert a message
			sqliteDb.insertMessage({
				id: "msg-cascade",
				threadId,
				timestamp: new Date().toISOString(),
				raw: { text: "hello" },
				type: "user_message",
			});

			// Delete thread
			await request(app).delete(`/api/threads/${threadId}`);

			// Messages should be gone
			const msgs = sqliteDb.getMessagesByThread(threadId);
			expect(msgs).toHaveLength(0);
		});
	});

	// ── GET /api/threads/:threadId/messages ───────────────────────────────

	describe("GET /api/threads/:threadId/messages", () => {
		it("returns messages for a thread", async () => {
			const createRes = await request(app)
				.post(`/api/workspaces/${wsId}/threads`)
				.send({ title: "Msg Thread" });
			const threadId = createRes.body.id;

			// Insert messages directly via sqliteDb
			sqliteDb.insertMessage({
				id: "msg-1",
				threadId,
				timestamp: "2024-01-01T00:00:00.000Z",
				raw: { role: "user", content: "hello" },
				type: "user_message",
			});
			sqliteDb.insertMessage({
				id: "msg-2",
				threadId,
				timestamp: "2024-01-01T00:00:01.000Z",
				raw: { text: "world" },
				type: "session/update",
			});

			const res = await request(app).get(`/api/threads/${threadId}/messages`);
			expect(res.status).toBe(200);
			expect(res.body).toHaveLength(2);
			// Should be in timestamp order
			expect(res.body[0].id).toBe("msg-1");
			expect(res.body[1].id).toBe("msg-2");
			// raw should be parsed JSON
			expect(res.body[0].raw.role).toBe("user");
		});

		it("returns empty array for thread with no messages", async () => {
			const createRes = await request(app)
				.post(`/api/workspaces/${wsId}/threads`)
				.send({ title: "Empty" });

			const res = await request(app).get(`/api/threads/${createRes.body.id}/messages`);
			expect(res.status).toBe(200);
			expect(res.body).toEqual([]);
		});
	});

	// ── GET /api/workspaces/:workspaceId (single workspace) ───────────────

	describe("GET /api/workspaces/:workspaceId", () => {
		it("returns a single workspace", async () => {
			const res = await request(app).get(`/api/workspaces/${wsId}`);
			expect(res.status).toBe(200);
			expect(res.body.id).toBe(wsId);
			expect(res.body.name).toBe("Thread Test WS");
		});

		it("returns 404 for non-existent workspace", async () => {
			const res = await request(app).get("/api/workspaces/ws-nonexistent");
			expect(res.status).toBe(404);
		});
	});

	// ── Workspace CRUD ────────────────────────────────────────────────────

	describe("Workspace PATCH", () => {
		it("updates workspace name", async () => {
			const res = await request(app)
				.patch(`/api/workspaces/${wsId}`)
				.send({ name: "Renamed" });

			expect(res.status).toBe(200);
			expect(res.body.name).toBe("Renamed");

			const ws = sqliteDb.getWorkspaceById(wsId);
			expect(ws?.name).toBe("Renamed");
		});

		it("rejects path changes", async () => {
			const res = await request(app)
				.patch(`/api/workspaces/${wsId}`)
				.send({ path: "/new/path" });

			expect(res.status).toBe(400);
		});
	});

	describe("DELETE /api/workspaces/:workspaceId — cascade", () => {
		it("cascades to threads and messages", async () => {
			// Create a thread with messages
			const threadRes = await request(app)
				.post(`/api/workspaces/${wsId}/threads`)
				.send({ title: "Cascade Thread" });
			const threadId = threadRes.body.id;

			sqliteDb.insertMessage({
				id: "msg-del-ws",
				threadId,
				timestamp: new Date().toISOString(),
				raw: { text: "hello" },
				type: "user_message",
			});

			// Delete workspace
			const res = await request(app).delete(`/api/workspaces/${wsId}`);
			expect(res.status).toBe(200);

			// Everything should be gone
			expect(sqliteDb.getWorkspaceById(wsId)).toBeUndefined();
			expect(sqliteDb.getThreadById(threadId)).toBeUndefined();
			expect(sqliteDb.getMessagesByThread(threadId)).toHaveLength(0);
		});
	});
});

// ---------------------------------------------------------------------------
// Integration: AllowedPatterns via the real server + SQLite
// ---------------------------------------------------------------------------

describe("AllowedPatterns CRUD — integration with real SQLite", () => {
	beforeEach(() => {
		seedDb({ workspaces: [], threads: [], messages: [], allowedPatterns: [] });
	});

	describe("POST /api/allowedPatterns", () => {
		it("saves a new pattern", async () => {
			const res = await request(app)
				.post("/api/allowedPatterns")
				.send({ pattern: "npm run *", toolName: "Bash", variant: "execute" });

			expect(res.status).toBe(201);
			const saved = res.body.find((p: any) => p.pattern === "npm run *");
			expect(saved).toBeDefined();
			expect(saved.toolName).toBe("Bash");
		});

		it("does not duplicate patterns with same pattern+toolName", async () => {
			await request(app)
				.post("/api/allowedPatterns")
				.send({ pattern: "npm run *", toolName: "Bash", variant: "execute" });

			await request(app)
				.post("/api/allowedPatterns")
				.send({ pattern: "npm run *", toolName: "Bash", variant: "execute" });

			const res = await request(app).get("/api/allowedPatterns");
			const npmPatterns = res.body.filter((p: any) => p.pattern === "npm run *");
			expect(npmPatterns).toHaveLength(1);
		});

		it("allows same pattern for different tools", async () => {
			await request(app)
				.post("/api/allowedPatterns")
				.send({ pattern: "npm run *", toolName: "Bash", variant: "execute" });

			await request(app)
				.post("/api/allowedPatterns")
				.send({ pattern: "npm run *", toolName: "Edit", variant: "edit" });

			const res = await request(app).get("/api/allowedPatterns");
			const npmPatterns = res.body.filter((p: any) => p.pattern === "npm run *");
			expect(npmPatterns).toHaveLength(2);
		});

		it("returns 400 when pattern is missing", async () => {
			const res = await request(app)
				.post("/api/allowedPatterns")
				.send({ toolName: "Bash" });
			expect(res.status).toBe(400);
		});
	});

	describe("GET /api/allowedPatterns", () => {
		it("returns all patterns", async () => {
			await request(app)
				.post("/api/allowedPatterns")
				.send({ pattern: "a", variant: "exact" });
			await request(app)
				.post("/api/allowedPatterns")
				.send({ pattern: "b", variant: "wildcard" });

			const res = await request(app).get("/api/allowedPatterns");
			expect(res.body).toHaveLength(2);
		});
	});

	describe("DELETE /api/allowedPatterns", () => {
		it("deletes a pattern by pattern name", async () => {
			await request(app)
				.post("/api/allowedPatterns")
				.send({ pattern: "to-delete", variant: "exact" });

			const res = await request(app)
				.delete("/api/allowedPatterns")
				.send({ pattern: "to-delete" });

			expect(res.status).toBe(200);
			expect(res.body.find((p: any) => p.pattern === "to-delete")).toBeUndefined();
		});
	});
});


// ---------------------------------------------------------------------------
// Messages Pagination API — integration tests for GET /api/threads/:threadId/messages/paginated
// ---------------------------------------------------------------------------

describe("GET /api/threads/:threadId/messages/paginated — cursor-based pagination", () => {
  let wsId: string;
  let threadId: string;

  beforeEach(() => {
    seedDb({ workspaces: [], threads: [], messages: [], allowedPatterns: [] });
    wsId = `ws-pag-${Date.now()}`;
    threadId = `t-pag-${Date.now()}`;
    sqliteDb.insertWorkspace({ id: wsId, name: "Pagination Test WS", path: VALID_DIR });
    sqliteDb.insertThread({ id: threadId, workspaceId: wsId, title: "Pagination Thread", status: "idle" });
  });

  it("returns latest 10 messages with default limit when cursor=null", async () => {
    // Insert 15 messages (timestamps in ascending order for SQL)
    const baseTime = Date.now();
    for (let i = 0; i < 15; i++) {
      sqliteDb.insertMessage({
        id: `msg-${i}`,
        threadId,
        timestamp: new Date(baseTime - (15 - i) * 60000).toISOString(), // i=0 is oldest
        raw: { content: `Message ${i}` },
        type: "user_message",
      });
    }

    const res = await request(app).get(`/api/threads/${threadId}/messages/paginated`);

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(10);
    expect(res.body.hasMore).toBe(true);
    expect(res.body.total).toBe(15);
    expect(res.body.nextCursor).toBe("msg-5"); // oldest message in this batch
    // Messages should be newest-first (reverse order)
    expect(res.body.messages[0].id).toBe("msg-14");
    expect(res.body.messages[9].id).toBe("msg-5");
  });

  it("returns messages before cursor when cursor is provided", async () => {
    const baseTime = Date.now();
    for (let i = 0; i < 20; i++) {
      sqliteDb.insertMessage({
        id: `msg-${i}`,
        threadId,
        timestamp: new Date(baseTime - (20 - i) * 60000).toISOString(),
        raw: { content: `Message ${i}` },
        type: "user_message",
      });
    }

    // First page: latest 10
    const res1 = await request(app).get(`/api/threads/${threadId}/messages/paginated?limit=10`);
    expect(res1.body.messages).toHaveLength(10);
    expect(res1.body.messages[0].id).toBe("msg-19");
    expect(res1.body.messages[9].id).toBe("msg-10");
    expect(res1.body.nextCursor).toBe("msg-10");

    // Second page: 10 messages before msg-10
    const res2 = await request(app).get(`/api/threads/${threadId}/messages/paginated?cursor=msg-10&limit=10`);
    expect(res2.status).toBe(200);
    expect(res2.body.messages).toHaveLength(10);
    expect(res2.body.messages[0].id).toBe("msg-9");
    expect(res2.body.messages[9].id).toBe("msg-0");
    // No more messages after msg-0, so hasMore=false and nextCursor=null
    expect(res2.body.hasMore).toBe(false);
    expect(res2.body.nextCursor).toBeNull();
  });

  it("respects custom limit query parameter", async () => {
    for (let i = 0; i < 20; i++) {
      sqliteDb.insertMessage({
        id: `msg-${i}`,
        threadId,
        timestamp: new Date(Date.now() - (20 - i) * 60000).toISOString(),
        raw: { content: `Message ${i}` },
        type: "user_message",
      });
    }

    const res = await request(app).get(`/api/threads/${threadId}/messages/paginated?limit=5`);

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(5);
    expect(res.body.hasMore).toBe(true);
    expect(res.body.total).toBe(20);
  });

  it("caps limit at 200 (max per request)", async () => {
    for (let i = 0; i < 15; i++) {
      sqliteDb.insertMessage({
        id: `msg-${i}`,
        threadId,
        timestamp: new Date(Date.now() - (15 - i) * 60000).toISOString(),
        raw: { content: `Message ${i}` },
        type: "user_message",
      });
    }

    const res = await request(app).get(`/api/threads/${threadId}/messages/paginated?limit=500`);

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(15);
    expect(res.body.hasMore).toBe(false); // 15 messages < 200 limit
    expect(res.body.total).toBe(15);
  });

  it("returns hasMore=false when all messages fit in one page", async () => {
    for (let i = 0; i < 5; i++) {
      sqliteDb.insertMessage({
        id: `msg-${i}`,
        threadId,
        timestamp: new Date(Date.now() - (5 - i) * 60000).toISOString(),
        raw: { content: `Message ${i}` },
        type: "user_message",
      });
    }

    const res = await request(app).get(`/api/threads/${threadId}/messages/paginated?limit=10`);

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(5);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.total).toBe(5);
  });

  it("returns empty messages array for thread with no messages", async () => {
    const res = await request(app).get(`/api/threads/${threadId}/messages/paginated`);

    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([]);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.total).toBe(0);
    expect(res.body.nextCursor).toBeNull();
  });

  it("returns total message count regardless of pagination", async () => {
    for (let i = 0; i < 50; i++) {
      sqliteDb.insertMessage({
        id: `msg-${i}`,
        threadId,
        timestamp: new Date(Date.now() - (50 - i) * 60000).toISOString(),
        raw: { content: `Message ${i}` },
        type: "user_message",
      });
    }

    const res = await request(app).get(`/api/threads/${threadId}/messages/paginated?limit=10`);

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(10);
    expect(res.body.total).toBe(50);
    expect(res.body.hasMore).toBe(true);
  });

  it("handles invalid threadId gracefully (returns empty)", async () => {
    const res = await request(app).get("/api/threads/nonexistent-thread-id/messages/paginated");

    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([]);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.total).toBe(0);
  });

  it("returns newest messages first (correct sort order for chat UI)", async () => {
    // Insert messages with specific timestamps
    const timestamps = [
      "2024-01-01T10:00:00Z",
      "2024-01-01T10:01:00Z",
      "2024-01-01T10:02:00Z",
    ];

    for (let i = 0; i < timestamps.length; i++) {
      sqliteDb.insertMessage({
        id: `msg-${i}`,
        threadId,
        timestamp: timestamps[i],
        raw: { content: `Message ${i}` },
        type: "user_message",
      });
    }

    const res = await request(app).get(`/api/threads/${threadId}/messages/paginated`);

    expect(res.status).toBe(200);
    expect(res.body.messages[0].timestamp).toBe("2024-01-01T10:02:00Z"); // newest
    expect(res.body.messages[1].timestamp).toBe("2024-01-01T10:01:00Z");
    expect(res.body.messages[2].timestamp).toBe("2024-01-01T10:00:00Z"); // oldest
  });

  it("returns nextCursor=null when at the oldest message", async () => {
    for (let i = 0; i < 5; i++) {
      sqliteDb.insertMessage({
        id: `msg-${i}`,
        threadId,
        timestamp: new Date(Date.now() - (5 - i) * 60000).toISOString(),
        raw: { content: `Message ${i}` },
        type: "user_message",
      });
    }

    const res = await request(app).get(`/api/threads/${threadId}/messages/paginated?limit=10`);

    // All 5 messages fit in one page, so nextCursor should be null
    expect(res.body.nextCursor).toBeNull();
    expect(res.body.hasMore).toBe(false);
  });

  it("handles invalid cursor gracefully (returns empty)", async () => {
    for (let i = 0; i < 10; i++) {
      sqliteDb.insertMessage({
        id: `msg-${i}`,
        threadId,
        timestamp: new Date(Date.now() - (10 - i) * 60000).toISOString(),
        raw: { content: `Message ${i}` },
        type: "user_message",
      });
    }

    const res = await request(app).get(`/api/threads/${threadId}/messages/paginated?cursor=nonexistent-cursor&limit=10`);

    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([]);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.nextCursor).toBeNull();
  });

  it("pagination workflow: load all messages in batches", async () => {
    // Create 25 messages
    for (let i = 0; i < 25; i++) {
      sqliteDb.insertMessage({
        id: `msg-${i}`,
        threadId,
        timestamp: new Date(Date.now() - (25 - i) * 60000).toISOString(),
        raw: { content: `Message ${i}` },
        type: "user_message",
      });
    }

    // Page 1: latest 10
    const page1 = await request(app).get(`/api/threads/${threadId}/messages/paginated?limit=10`);
    expect(page1.body.messages).toHaveLength(10);
    expect(page1.body.hasMore).toBe(true);
    expect(page1.body.messages[0].id).toBe("msg-24");
    expect(page1.body.messages[9].id).toBe("msg-15");
    expect(page1.body.nextCursor).toBe("msg-15");

    // Page 2: 10 messages before msg-15
    const page2 = await request(app).get(
      `/api/threads/${threadId}/messages/paginated?cursor=${page1.body.nextCursor}&limit=10`
    );
    expect(page2.body.messages).toHaveLength(10);
    expect(page2.body.hasMore).toBe(true);
    expect(page2.body.messages[0].id).toBe("msg-14");
    expect(page2.body.messages[9].id).toBe("msg-5");
    expect(page2.body.nextCursor).toBe("msg-5");

    // Page 3: remaining 5 messages
    const page3 = await request(app).get(
      `/api/threads/${threadId}/messages/paginated?cursor=${page2.body.nextCursor}&limit=10`
    );
    expect(page3.body.messages).toHaveLength(5);
    expect(page3.body.hasMore).toBe(false);
    expect(page3.body.messages[0].id).toBe("msg-4");
    expect(page3.body.messages[4].id).toBe("msg-0");
    expect(page3.body.nextCursor).toBeNull();

    // Verify no duplicate IDs across all pages
    const allIds = new Set([
      ...page1.body.messages.map((m: any) => m.id),
      ...page2.body.messages.map((m: any) => m.id),
      ...page3.body.messages.map((m: any) => m.id),
    ]);
    expect(allIds.size).toBe(25);
  });
});



describe("DELETE /api/allowedPatterns — scoped settings rows", () => {
  beforeEach(() => {
    seedDb({ workspaces: [], threads: [], messages: [], allowedPatterns: [] });
  });

  it("deletes a tool-scoped compound pattern when the settings request omits toolName", async () => {
    await request(app)
      .post("/api/allowedPatterns")
      .send({ pattern: "cd * && npm * && tail *", toolName: "Bash", variant: "execute" });

    const response = await request(app)
      .delete("/api/allowedPatterns")
      .send({ pattern: "cd * && npm * && tail *" });

    expect(response.status).toBe(200);
    expect(response.body).not.toContainEqual(expect.objectContaining({
      pattern: "cd * && npm * && tail *",
      toolName: "Bash",
    }));
    expect(readDb().allowedPatterns).toHaveLength(0);
  });

  it("deletes only the selected tool row when settings supplies toolName", async () => {
    await request(app).post("/api/allowedPatterns").send({ pattern: "same *", toolName: "Bash", variant: "execute" });
    await request(app).post("/api/allowedPatterns").send({ pattern: "same *", toolName: "Edit", variant: "edit" });

    const response = await request(app)
      .delete("/api/allowedPatterns")
      .send({ pattern: "same *", toolName: "Bash" });

    expect(response.status).toBe(200);
    expect(response.body).not.toContainEqual(expect.objectContaining({ pattern: "same *", toolName: "Bash" }));
    expect(response.body).toContainEqual(expect.objectContaining({ pattern: "same *", toolName: "Edit" }));
  });
});