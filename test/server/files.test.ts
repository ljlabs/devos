import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import fs from "fs";
import path from "path";
import os from "os";
import { listDirectory, readFile, writeFile } from "../../server_src/files";

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
