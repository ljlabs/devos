import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import fs from "fs";
import path from "path";
import os from "os";
import { listDirectory, readFile, writeFile, moveEntry } from "../../server_src/files";

const TEST_DIR = path.join(os.tmpdir(), `devos-test-files-${Date.now()}`);

beforeAll(() => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  // Create a sample file for testing
  fs.writeFileSync(path.join(TEST_DIR, "sample.txt"), "hello world", "utf-8");
  fs.mkdirSync(path.join(TEST_DIR, "src"), { recursive: true });
  fs.writeFileSync(path.join(TEST_DIR, "src", "index.ts"), "console.log('hi');", "utf-8");
});

afterAll(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("writeFile()", () => {
  beforeEach(() => {
    // Clean up any test files between tests
    const testFile = path.join(TEST_DIR, "test-write.txt");
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
  });

  it("writes a new file and reads it back", () => {
    const result = writeFile(TEST_DIR, "test-write.txt", "new content");
    expect(result.path).toBe("test-write.txt");
    expect(result.content).toBe("new content");
    expect(result.lines).toBe(1);

    const read = readFile(TEST_DIR, "test-write.txt");
    expect(read.content).toBe("new content");
  });

  it("overwrites an existing file", () => {
    writeFile(TEST_DIR, "test-write.txt", "first");
    const result = writeFile(TEST_DIR, "test-write.txt", "second");
    expect(result.content).toBe("second");

    const read = readFile(TEST_DIR, "test-write.txt");
    expect(read.content).toBe("second");
  });

  it("rejects path traversal (../../etc/passwd)", () => {
    expect(() => writeFile(TEST_DIR, "../../etc/passwd", "evil")).toThrow("traversal");
    expect(fs.existsSync(path.resolve(TEST_DIR, "../../etc/passwd"))).toBe(false);
  });

  it("rejects path traversal (../outside/file.txt)", () => {
    expect(() => writeFile(TEST_DIR, "../outside/file.txt", "evil")).toThrow("traversal");
  });

  it("creates intermediate directories", () => {
    const result = writeFile(TEST_DIR, "deep/nested/dir/file.txt", "nested content");
    expect(result.path).toBe("deep/nested/dir/file.txt");
    expect(result.lines).toBe(1);

    // Verify the file exists on disk
    const absPath = path.join(TEST_DIR, "deep", "nested", "dir", "file.txt");
    expect(fs.existsSync(absPath)).toBe(true);
    expect(fs.readFileSync(absPath, "utf-8")).toBe("nested content");

    // Cleanup
    fs.rmSync(path.join(TEST_DIR, "deep"), { recursive: true, force: true });
  });

  it("handles empty content", () => {
    const result = writeFile(TEST_DIR, "test-write.txt", "");
    expect(result.content).toBe("");
    expect(result.lines).toBe(1); // "".split("\n") = [""], length 1
    expect(result.size).toBe(0);
  });

  it("handles UTF-8 special characters", () => {
    const content = "Hello 🌍 — café résumé 中文";
    const result = writeFile(TEST_DIR, "test-write.txt", content);
    expect(result.content).toBe(content);

    const read = readFile(TEST_DIR, "test-write.txt");
    expect(read.content).toBe(content);
  });

  it("counts lines correctly", () => {
    const content = "line1\nline2\nline3";
    const result = writeFile(TEST_DIR, "test-write.txt", content);
    expect(result.lines).toBe(3);
  });
});

describe("File write API route", () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    // Simulate the write route from server.ts
    app.put("/api/workspaces/:workspaceId/files/write", (req, res) => {
      try {
        // Mock workspace lookup — TEST_DIR is our workspace
        if (req.params.workspaceId === "not-found") {
          return res.status(404).json({ error: "workspace not found" });
        }
        if (!req.body.path || typeof req.body.path !== "string") {
          return res.status(400).json({ error: "path is required" });
        }
        if (req.body.content === undefined || typeof req.body.content !== "string") {
          return res.status(400).json({ error: "content is required" });
        }
        const result = writeFile(TEST_DIR, req.body.path, req.body.content);
        res.json(result);
      } catch (e: any) {
        res.status(400).json({ error: e.message });
      }
    });
  });

  it("returns 404 for non-existent workspace", async () => {
    const res = await request(app)
      .put("/api/workspaces/not-found/files/write")
      .send({ path: "test.txt", content: "hi" });
    expect(res.status).toBe(404);
  });

  it("returns 400 when path is missing", async () => {
    const res = await request(app)
      .put("/api/workspaces/test/files/write")
      .send({ content: "hi" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("path");
  });

  it("returns 400 when content is missing", async () => {
    const res = await request(app)
      .put("/api/workspaces/test/files/write")
      .send({ path: "test.txt" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("content");
  });

  it("returns 400 for path traversal", async () => {
    const res = await request(app)
      .put("/api/workspaces/test/files/write")
      .send({ path: "../../etc/passwd", content: "evil" });
    expect(res.status).toBe(400);
  });

  it("writes and returns file content", async () => {
    const res = await request(app)
      .put("/api/workspaces/test/files/write")
      .send({ path: "api-test.txt", content: "written via API" });
    expect(res.status).toBe(200);
    expect(res.body.content).toBe("written via API");
    expect(res.body.path).toBe("api-test.txt");

    // Cleanup
    fs.unlinkSync(path.join(TEST_DIR, "api-test.txt"));
  });
});

describe("moveEntry()", () => {
  beforeEach(() => {
    // Create fresh test structure before each test
    const testSubdir = path.join(TEST_DIR, "move-test");
    if (fs.existsSync(testSubdir)) {
      fs.rmSync(testSubdir, { recursive: true, force: true });
    }
    fs.mkdirSync(testSubdir, { recursive: true });
    fs.writeFileSync(path.join(testSubdir, "file.txt"), "content", "utf-8");
    fs.mkdirSync(path.join(testSubdir, "src"), { recursive: true });
    fs.mkdirSync(path.join(testSubdir, "dest"), { recursive: true });
  });

  afterEach(() => {
    const testSubdir = path.join(TEST_DIR, "move-test");
    if (fs.existsSync(testSubdir)) {
      fs.rmSync(testSubdir, { recursive: true, force: true });
    }
  });

  it("moves a file to a folder", () => {
    const testSubdir = path.join(TEST_DIR, "move-test");
    const result = moveEntry(testSubdir, "file.txt", "dest");
    
    expect(result.path).toBe("dest/file.txt");
    expect(result.type).toBe("file");
    expect(fs.existsSync(path.join(testSubdir, "dest", "file.txt"))).toBe(true);
    expect(fs.existsSync(path.join(testSubdir, "file.txt"))).toBe(false);
  });

  it("moves a file out of a folder to root", () => {
    const testSubdir = path.join(TEST_DIR, "move-test");
    fs.writeFileSync(path.join(testSubdir, "src", "index.ts"), "export default;", "utf-8");
    
    const result = moveEntry(testSubdir, "src/index.ts", "");
    
    expect(result.path).toBe("index.ts");
    expect(fs.existsSync(path.join(testSubdir, "index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(testSubdir, "src", "index.ts"))).toBe(false);
  });

  it("moves a folder to another folder", () => {
    const testSubdir = path.join(TEST_DIR, "move-test");
    
    const result = moveEntry(testSubdir, "src", "dest");
    
    expect(result.path).toBe("dest/src");
    expect(result.type).toBe("directory");
    expect(fs.existsSync(path.join(testSubdir, "dest", "src"))).toBe(true);
    expect(fs.existsSync(path.join(testSubdir, "src"))).toBe(false);
  });

  it("rejects path traversal in source", () => {
    const testSubdir = path.join(TEST_DIR, "move-test");
    expect(() => moveEntry(testSubdir, "../../etc/passwd", "dest")).toThrow("traversal");
  });

  it("rejects path traversal in destination", () => {
    const testSubdir = path.join(TEST_DIR, "move-test");
    expect(() => moveEntry(testSubdir, "file.txt", "../../etc")).toThrow("traversal");
  });

  it("rejects moving a folder into itself", () => {
    const testSubdir = path.join(TEST_DIR, "move-test");
    // Create the nested path first
    fs.mkdirSync(path.join(testSubdir, "src", "nested"), { recursive: true });
    
    expect(() => moveEntry(testSubdir, "src", "src/nested")).toThrow("into itself");
  });

  it("rejects moving to a file that already exists", () => {
    const testSubdir = path.join(TEST_DIR, "move-test");
    fs.writeFileSync(path.join(testSubdir, "dest", "file.txt"), "existing", "utf-8");
    
    expect(() => moveEntry(testSubdir, "file.txt", "dest")).toThrow("Already exists");
  });

  it("rejects moving from non-existent source", () => {
    const testSubdir = path.join(TEST_DIR, "move-test");
    expect(() => moveEntry(testSubdir, "nonexistent.txt", "dest")).toThrow("not found");
  });

  it("rejects moving to non-existent destination directory", () => {
    const testSubdir = path.join(TEST_DIR, "move-test");
    expect(() => moveEntry(testSubdir, "file.txt", "nonexistent")).toThrow("not found");
  });

  it("preserves file content when moving", () => {
    const testSubdir = path.join(TEST_DIR, "move-test");
    const originalContent = "original content here";
    fs.writeFileSync(path.join(testSubdir, "file.txt"), originalContent, "utf-8");
    
    moveEntry(testSubdir, "file.txt", "dest");
    
    const movedContent = fs.readFileSync(path.join(testSubdir, "dest", "file.txt"), "utf-8");
    expect(movedContent).toBe(originalContent);
  });

  it("falls back to copy+delete when renameSync throws EPERM (Windows cross-volume)", () => {
    const testSubdir = path.join(TEST_DIR, "move-test");
    fs.writeFileSync(path.join(testSubdir, "file.txt"), "eperm test", "utf-8");

    // Simulate Windows EPERM by monkey-patching fs.renameSync to throw once
    const origRename = fs.renameSync.bind(fs);
    let called = false;
    vi.spyOn(fs, "renameSync").mockImplementation((...args) => {
      if (!called) {
        called = true;
        const err: any = new Error("EPERM: operation not permitted");
        err.code = "EPERM";
        throw err;
      }
      return origRename(...args);
    });

    const result = moveEntry(testSubdir, "file.txt", "dest");
    vi.mocked(fs.renameSync).mockRestore();

    expect(result.path).toBe("dest/file.txt");
    expect(fs.existsSync(path.join(testSubdir, "dest", "file.txt"))).toBe(true);
    expect(fs.existsSync(path.join(testSubdir, "file.txt"))).toBe(false);
    const content = fs.readFileSync(path.join(testSubdir, "dest", "file.txt"), "utf-8");
    expect(content).toBe("eperm test");
  });
});

describe("File move API route", () => {
  let app: express.Express;
  const testSubdir = path.join(TEST_DIR, "api-move-test");

  beforeEach(() => {
    app = express();
    app.use(express.json());

    // Mirror the real server.ts validation — empty string destParentPath is valid (workspace root)
    app.post("/api/workspaces/:workspaceId/files/move", (req, res) => {
      try {
        if (req.params.workspaceId === "not-found") {
          return res.status(404).json({ error: "workspace not found" });
        }
        const { sourcePath, destParentPath } = req.body;
        if (!sourcePath || typeof sourcePath !== "string") {
          return res.status(400).json({ error: "sourcePath (string) required" });
        }
        // Empty string is valid — it means workspace root
        if (destParentPath === undefined || destParentPath === null || typeof destParentPath !== "string") {
          return res.status(400).json({ error: "destParentPath (string) required" });
        }
        const movedEntry = moveEntry(testSubdir, sourcePath, destParentPath);
        res.json({ ok: true, entry: movedEntry });
      } catch (e: any) {
        if (e.message.includes("traversal")) return res.status(400).json({ error: e.message });
        if (e.message.includes("not found")) return res.status(404).json({ error: e.message });
        res.status(500).json({ error: e.message });
      }
    });

    // Fresh test workspace before each test
    if (fs.existsSync(testSubdir)) fs.rmSync(testSubdir, { recursive: true, force: true });
    fs.mkdirSync(testSubdir, { recursive: true });
    fs.writeFileSync(path.join(testSubdir, "file.txt"), "content", "utf-8");
    fs.mkdirSync(path.join(testSubdir, "dest"), { recursive: true });
    fs.mkdirSync(path.join(testSubdir, "src"), { recursive: true });
    fs.writeFileSync(path.join(testSubdir, "src", "nested.txt"), "nested", "utf-8");
  });

  // cleanup after each (imported at file top)
  afterAll(() => {
    if (fs.existsSync(testSubdir)) fs.rmSync(testSubdir, { recursive: true, force: true });
  });

  it("returns 404 for non-existent workspace", async () => {
    const res = await request(app)
      .post("/api/workspaces/not-found/files/move")
      .send({ sourcePath: "file.txt", destParentPath: "dest" });
    expect(res.status).toBe(404);
  });

  it("returns 400 when sourcePath is missing", async () => {
    const res = await request(app)
      .post("/api/workspaces/test/files/move")
      .send({ destParentPath: "dest" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("sourcePath");
  });

  it("returns 400 when destParentPath is omitted entirely", async () => {
    const res = await request(app)
      .post("/api/workspaces/test/files/move")
      .send({ sourcePath: "file.txt" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("destParentPath");
  });

  it("accepts empty string destParentPath (move to workspace root)", async () => {
    const res = await request(app)
      .post("/api/workspaces/test/files/move")
      .send({ sourcePath: "src/nested.txt", destParentPath: "" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.entry.path).toBe("nested.txt");
    expect(fs.existsSync(path.join(testSubdir, "nested.txt"))).toBe(true);
    expect(fs.existsSync(path.join(testSubdir, "src", "nested.txt"))).toBe(false);
  });

  it("returns 400 for path traversal in sourcePath", async () => {
    const res = await request(app)
      .post("/api/workspaces/test/files/move")
      .send({ sourcePath: "../../etc/passwd", destParentPath: "dest" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for path traversal in destParentPath", async () => {
    const res = await request(app)
      .post("/api/workspaces/test/files/move")
      .send({ sourcePath: "file.txt", destParentPath: "../../evil" });
    expect(res.status).toBe(400);
  });

  it("moves a file to a subdirectory", async () => {
    const res = await request(app)
      .post("/api/workspaces/test/files/move")
      .send({ sourcePath: "file.txt", destParentPath: "dest" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.entry.path).toBe("dest/file.txt");
    expect(fs.existsSync(path.join(testSubdir, "dest", "file.txt"))).toBe(true);
    expect(fs.existsSync(path.join(testSubdir, "file.txt"))).toBe(false);
  });

  it("returns 404 when source file does not exist", async () => {
    const res = await request(app)
      .post("/api/workspaces/test/files/move")
      .send({ sourcePath: "ghost.txt", destParentPath: "dest" });
    expect(res.status).toBe(404);
  });
});
