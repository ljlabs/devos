/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { derivePatternVariants } from "./patterns";

// ---------------------------------------------------------------------------
// Shell command variants
// ---------------------------------------------------------------------------
describe("derivePatternVariants — shell commands", () => {
  it("returns only exact variant for a single-word command with no spaces", () => {
    const v = derivePatternVariants("git");
    expect(v).toHaveLength(1);
    expect(v[0].pattern).toBe("git");
  });

  it("returns exact + script + exe variants for a full python invocation", () => {
    const cmd = "C:/Python/python.exe C:/scripts/main.py arg1 arg2";
    const v = derivePatternVariants(cmd);
    const patterns = v.map(x => x.pattern);
    expect(patterns).toContain(cmd);                               // exact
    expect(patterns).toContain("C:/Python/python.exe C:/scripts/main.py *"); // script-level
    expect(patterns).toContain("C:/Python/python.exe *");          // exe-level
  });

  it("never duplicates patterns", () => {
    const cmd = "npm install lodash";
    const v = derivePatternVariants(cmd);
    const unique = new Set(v.map(x => x.pattern));
    expect(unique.size).toBe(v.length);
  });

  it("heuristic: no spaces without a kind → treated as shell (exact only)", () => {
    // Without kind=edit, a bare filename is treated as a single-word shell command
    const v = derivePatternVariants("hello.md");
    expect(v).toHaveLength(1);
    expect(v[0].pattern).toBe("hello.md");
  });
});

// ---------------------------------------------------------------------------
// File edit/write variants — the bug case
// ---------------------------------------------------------------------------
describe("derivePatternVariants — file edits (kind=edit)", () => {
  it("returns more than 1 variant for a simple filename", () => {
    const v = derivePatternVariants("hello.md", "edit");
    expect(v.length).toBeGreaterThan(1);
  });

  it("first variant is always the exact file", () => {
    const v = derivePatternVariants("hello.md", "edit");
    expect(v[0].pattern).toBe("hello.md");
    expect(v[0].label).toBe("hello.md");
  });

  it("includes immediate directory wildcard", () => {
    const v = derivePatternVariants("src/components/Foo.tsx", "edit");
    const patterns = v.map(x => x.pattern);
    expect(patterns).toContain("src/components/*");
  });

  it("includes workspace root wildcard when workspacePath provided", () => {
    const v = derivePatternVariants(
      "C:/projects/pipelines/src/hello.md",
      "edit",
      "C:/projects/pipelines"
    );
    const patterns = v.map(x => x.pattern);
    expect(patterns).toContain("C:/projects/pipelines/*");
  });

  it("always ends with catch-all * variant", () => {
    const v = derivePatternVariants("src/hello.md", "edit");
    expect(v[v.length - 1].pattern).toBe("*");
    expect(v[v.length - 1].label).toBe("*");
  });

  it("does NOT include extension wildcards like *.md", () => {
    const v = derivePatternVariants("hello.md", "edit");
    const patterns = v.map(x => x.pattern);
    expect(patterns.every(p => !p.startsWith("*."))).toBe(true);
  });

  it("works the same with kind=write", () => {
    const v = derivePatternVariants("README.md", "write");
    expect(v.length).toBeGreaterThan(1);
    expect(v[v.length - 1].pattern).toBe("*");
  });

  it("works the same with kind=create", () => {
    const v = derivePatternVariants("dist/output.js", "create");
    const patterns = v.map(x => x.pattern);
    expect(patterns).toContain("dist/*");
    expect(patterns).toContain("*");
  });

  it("handles Windows-style backslash paths", () => {
    const v = derivePatternVariants("src\\components\\Foo.tsx", "edit");
    // directory wildcard normalised to forward slashes
    const patterns = v.map(x => x.pattern);
    expect(patterns).toContain("src/components/*");
  });

  it("never duplicates patterns", () => {
    const v = derivePatternVariants(
      "C:/projects/pipelines/src/utils/helpers.ts",
      "edit",
      "C:/projects/pipelines"
    );
    const unique = new Set(v.map(x => x.pattern));
    expect(unique.size).toBe(v.length);
  });

  it("deduplicates when immediate dir equals workspace root", () => {
    // File is directly in the workspace root — dir wildcard and workspace wildcard are the same
    const v = derivePatternVariants(
      "C:/projects/pipelines/hello.md",
      "edit",
      "C:/projects/pipelines"
    );
    const patterns = v.map(x => x.pattern);
    const wsWildcard = "C:/projects/pipelines/*";
    expect(patterns.filter(p => p === wsWildcard).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Empty / edge cases
// ---------------------------------------------------------------------------
describe("derivePatternVariants — edge cases", () => {
  it("returns empty array for empty string", () => {
    expect(derivePatternVariants("")).toHaveLength(0);
    expect(derivePatternVariants("", "edit")).toHaveLength(0);
  });

  it("returns at least 1 variant for any non-empty input", () => {
    expect(derivePatternVariants("anything").length).toBeGreaterThanOrEqual(1);
  });
});
