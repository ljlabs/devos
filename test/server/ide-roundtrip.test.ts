import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { listDirectory, readFile, writeFile } from "../../server_src/files";

const TEST_DIR = path.join(os.tmpdir(), `devos-test-roundtrip-${Date.now()}`);

beforeAll(() => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  // Create initial file
  fs.writeFileSync(path.join(TEST_DIR, "hello.txt"), "original content", "utf-8");
});

afterAll(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("IDE round-trip: list → read → write → read", () => {
  it("lists root dir, reads a file, writes modified content, reads back", () => {
    // 1. List root
    const entries = listDirectory(TEST_DIR);
    expect(entries.some((e) => e.name === "hello.txt")).toBe(true);

    // 2. Read
    const original = readFile(TEST_DIR, "hello.txt");
    expect(original.content).toBe("original content");

    // 3. Write modified
    const modified = original.content + " — modified";
    const written = writeFile(TEST_DIR, "hello.txt", modified);
    expect(written.content).toBe(modified);

    // 4. Read back
    const final = readFile(TEST_DIR, "hello.txt");
    expect(final.content).toBe(modified);
  });

  it("creates a new file via write, verifies it appears in listing", () => {
    writeFile(TEST_DIR, "new-file.txt", "brand new");

    const entries = listDirectory(TEST_DIR);
    expect(entries.some((e) => e.name === "new-file.txt")).toBe(true);
  });

  it("writes to nested path and creates intermediate directories", () => {
    writeFile(TEST_DIR, "a/b/c/file.txt", "deeply nested");

    // Verify all intermediate dirs exist
    expect(fs.existsSync(path.join(TEST_DIR, "a"))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, "a", "b"))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, "a", "b", "c"))).toBe(true);

    const content = readFile(TEST_DIR, "a/b/c/file.txt");
    expect(content.content).toBe("deeply nested");
  });

  it("list → read → write → read preserves metadata", () => {
    const before = readFile(TEST_DIR, "hello.txt");
    writeFile(TEST_DIR, "hello.txt", "metadata test\nline 2\nline 3");
    const after = readFile(TEST_DIR, "hello.txt");

    expect(after.lines).toBe(3);
    expect(after.size).toBe(Buffer.byteLength("metadata test\nline 2\nline 3"));
  });

  it("write then list shows correct entry count", () => {
    const beforeCount = listDirectory(TEST_DIR).length;
    writeFile(TEST_DIR, "another-new.txt", "data");
    const afterCount = listDirectory(TEST_DIR).length;
    expect(afterCount).toBe(beforeCount + 1);
  });

  it("read non-existent file throws", () => {
    expect(() => readFile(TEST_DIR, "does-not-exist.txt")).toThrow("not found");
  });
});
