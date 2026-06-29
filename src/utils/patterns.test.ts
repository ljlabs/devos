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
// Compound shell commands (&&, |, ;)
// ---------------------------------------------------------------------------
describe("derivePatternVariants — compound shell commands", () => {
  // Real-world input: a chained bash command across &&  and |
  const COMMAND = "cd LekkerLoyal && cat functions/package.json 2>/dev/null | head -40";
  const KIND    = "execute";   // kind passed through from the ACP toolCall
  // toolName is resolved by the caller (PermissionBubble) to "Bash" for kind=execute,
  // but derivePatternVariants only uses kind to choose file vs shell path.

  it("produces exactly 3 variants: exact, scoped, and bare", () => {
    const v = derivePatternVariants(COMMAND, KIND);
    expect(v).toHaveLength(3);
  });

  it("first variant is always the exact command", () => {
    const v = derivePatternVariants(COMMAND, KIND);
    expect(v[0].pattern).toBe(COMMAND);
    expect(v[0].label).toBe(COMMAND);
  });

  it("second variant is the scoped option — first-arg directory prefix per sub-command", () => {
    const v = derivePatternVariants(COMMAND, KIND);
    // cd LekkerLoyal  → prefix = LekkerLoyal  → "cd LekkerLoyal/*"
    // cat functions/package.json → dir = functions → "cat functions/*"
    // head -40        → firstArg starts with '-', falls through → "head *"
    expect(v[1].label).toBe("cd LekkerLoyal/*, cat functions/*, head *");
    expect(v[1].pattern).toBe("cd LekkerLoyal/* && cat functions/* && head *");
  });

  it("third variant is the bare option — any args to any of these commands", () => {
    const v = derivePatternVariants(COMMAND, KIND);
    expect(v[2].label).toBe("cd *, cat *, head *");
    expect(v[2].pattern).toBe("cd * && cat * && head *");
  });

  it("never duplicates patterns", () => {
    const v = derivePatternVariants(COMMAND, KIND);
    const unique = new Set(v.map(x => x.pattern));
    expect(unique.size).toBe(v.length);
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
