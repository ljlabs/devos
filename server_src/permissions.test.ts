/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { checkAllowedPattern, derivePatternVariants, parseToolPattern, PermissionManager, splitShellCommand } from "./permissions";

// ---------------------------------------------------------------------------
// Shell command variants — simple (non-compound)
// ---------------------------------------------------------------------------
describe("derivePatternVariants — shell commands", () => {
  it("returns only exact variant for a single-word command with no spaces", () => {
    const v = derivePatternVariants("git");
    expect(v).toHaveLength(1);
    expect(v[0].pattern).toBe("git");
  });

  it("returns only exact variant for a bare exe with path separators and no args", () => {
    const v = derivePatternVariants("C:/Users/jorda/python.exe");
    expect(v).toHaveLength(1);
    expect(v[0].pattern).toBe("C:/Users/jorda/python.exe");
  });

  it("returns exact + script + exe variants for a full python invocation", () => {
    const cmd = "C:/Python/python.exe C:/scripts/main.py arg1 arg2";
    const v = derivePatternVariants(cmd);
    const patterns = v.map(x => x.pattern);
    expect(patterns).toContain(cmd);
    expect(patterns).toContain("C:/Python/python.exe C:/scripts/main.py *");
    expect(patterns).toContain("C:/Python/python.exe *");
  });

  it("never duplicates patterns", () => {
    const cmd = "npm install lodash";
    const v = derivePatternVariants(cmd);
    const unique = new Set(v.map(x => x.pattern));
    expect(unique.size).toBe(v.length);
  });

  it("heuristic: single-word command with extension treated as shell (exact only)", () => {
    // Without kind=edit, a bare filename is a single-word shell command — no wildcard
    const v = derivePatternVariants("hello.md");
    expect(v).toHaveLength(1);
    expect(v[0].pattern).toBe("hello.md");
  });

  // ── Label behaviour ───────────────────────────────────────────────────────

  it("label for script-level variant is the full pattern (not basename)", () => {
    const cmd = "C:/Users/jorda/python.exe C:/Users/jorda/main.py arg1 arg2";
    const v = derivePatternVariants(cmd);
    const scriptVariant = v.find(x => x.pattern === "C:/Users/jorda/python.exe C:/Users/jorda/main.py *");
    expect(scriptVariant).toBeDefined();
    expect(scriptVariant!.label).toBe("C:/Users/jorda/python.exe C:/Users/jorda/main.py *");
  });

  it("label for exe-level variant uses basename only", () => {
    const cmd = "C:/Users/jorda/python.exe C:/Users/jorda/main.py";
    const v = derivePatternVariants(cmd);
    const exeVariant = v.find(x => x.pattern === "C:/Users/jorda/python.exe *");
    expect(exeVariant).toBeDefined();
    expect(exeVariant!.label).toBe("python.exe *");
  });

  it("generates non-empty labels for all variants", () => {
    const cmd = "C:/Users/jorda/python.exe C:/Users/jorda/main.py arg";
    derivePatternVariants(cmd).forEach(v => {
      expect(v.label).toBeTruthy();
      expect(v.label.length).toBeGreaterThan(0);
    });
  });

  // ── Path separator handling ───────────────────────────────────────────────

  it("preserves full paths in patterns — not basenames", () => {
    const cmd = "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe C:/Users/jorda/.claude/skills/web-search/main.py --arg value";
    const v = derivePatternVariants(cmd);
    expect(v.length).toBeGreaterThanOrEqual(3);
    expect(v[0].pattern).toBe(cmd);
    expect(v[0].label).toBe(cmd);
    expect(v[1].pattern).toBe(
      "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe C:/Users/jorda/.claude/skills/web-search/main.py *"
    );
    expect(v[2].pattern).toBe("C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe *");
    expect(v[2].label).toBe("python.exe *");
  });

  it("handles Windows-style backslash paths", () => {
    const cmd = "C:\\Users\\jorda\\python.exe C:\\Users\\jorda\\main.py";
    const v = derivePatternVariants(cmd);
    expect(v.length).toBeGreaterThanOrEqual(2);
    expect(v[0].pattern).toBe(cmd);
    expect(v[1].pattern).toBe("C:\\Users\\jorda\\python.exe C:\\Users\\jorda\\main.py *");
  });

  it("handles mixed forward and backward slashes", () => {
    const cmd = "C:\\Users/jorda\\python.exe C:\\Users/jorda\\main.py";
    const v = derivePatternVariants(cmd);
    expect(v.length).toBeGreaterThanOrEqual(2);
    expect(v[0].pattern).toBe(cmd);
    expect(v[1].pattern).toBe("C:\\Users/jorda\\python.exe C:\\Users/jorda\\main.py *");
  });

  it("handles quoted double-quote arguments — script-level collapses them", () => {
    const cmd = 'C:/Users/jorda/python.exe C:/Users/jorda/main.py "arg with spaces" --flag';
    const v = derivePatternVariants(cmd);
    expect(v.length).toBeGreaterThanOrEqual(2);
    expect(v[0].pattern).toBe(cmd);
    expect(v[1].pattern).toBe("C:/Users/jorda/python.exe C:/Users/jorda/main.py *");
  });

  it("handles single-quoted arguments", () => {
    const cmd = "C:/Users/jorda/python.exe C:/Users/jorda/main.py 'arg with spaces'";
    const v = derivePatternVariants(cmd);
    expect(v.length).toBeGreaterThanOrEqual(2);
    expect(v[0].pattern).toBe(cmd);
  });

  it("includes exe * variant when exe has no path separators (bare command)", () => {
    const cmd = "python C:/Users/jorda/main.py";
    const v = derivePatternVariants(cmd);
    expect(v.find(x => x.pattern === "python *")).toBeDefined();
  });

  // ── Real-world examples ───────────────────────────────────────────────────

  it("real-world: python web-search command — 3 variants in order", () => {
    const cmd =
      'C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe ' +
      'C:/Users/jorda/.claude/skills/web-search/main.py search_query "query text"';
    const v = derivePatternVariants(cmd);
    expect(v.length).toBeGreaterThanOrEqual(3);
    expect(v[0].pattern).toBe(cmd);
    expect(v[0].label).toBe(cmd);
    expect(v[1].pattern).toBe(
      "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe " +
      "C:/Users/jorda/.claude/skills/web-search/main.py *"
    );
    expect(v[2].pattern).toBe(
      "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe *"
    );
    expect(v[2].label).toBe("python.exe *");
  });

  it("real-world: npm build command includes npm * variant", () => {
    const cmd = "npm run build";
    const v = derivePatternVariants(cmd);
    expect(v.length).toBeGreaterThanOrEqual(2);
    expect(v[0].pattern).toBe("npm run build");
    expect(v.some(x => x.pattern === "npm *")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Multi-positional subcommand CLIs (gh, docker, npm run …)
// ---------------------------------------------------------------------------
describe("derivePatternVariants — multi-positional subcommand CLIs", () => {
  it("generates progressive variants for gh issue create (exact bug reproduction)", () => {
    // The real command that was missing the gh issue create * option
    const cmd =
      'gh issue create --title "Polish project for professional presentation" ' +
      '--body "## Goal Make the project look more professional" ' +
      '--label "infra" 2>&1';

    const v = derivePatternVariants(cmd);
    const patterns = v.map(x => x.pattern);

    // All 4 options must be present
    expect(patterns).toContain(cmd);               // 1. exact
    expect(patterns).toContain("gh issue create *"); // 2. subcommand level
    expect(patterns).toContain("gh issue *");        // 3. command group level
    expect(patterns).toContain("gh *");              // 4. exe level

    expect(v.length).toBeGreaterThanOrEqual(4);
    expect(patterns[0]).toBe(cmd); // exact always first

    const unique = new Set(patterns);
    expect(unique.size).toBe(patterns.length); // no duplicates
  });

  it("stops collecting positionals at the first flag", () => {
    const cmd = 'gh issue create --title "test" --body "text"';
    const patterns = derivePatternVariants(cmd).map(x => x.pattern);
    expect(patterns).not.toContain("gh issue create --title *");
    expect(patterns).not.toContain("gh issue --title *");
    expect(patterns).toContain("gh issue create *");
    expect(patterns).toContain("gh issue *");
    expect(patterns).toContain("gh *");
  });

  it("npm run build — generates npm run build *, npm run *, npm *", () => {
    const patterns = derivePatternVariants("npm run build --production --watch").map(x => x.pattern);
    expect(patterns).toContain("npm run build *");
    expect(patterns).toContain("npm run *");
    expect(patterns).toContain("npm *");
  });

  it("docker run with multiple positional args", () => {
    const patterns = derivePatternVariants("docker run ubuntu:20.04 bash --version").map(x => x.pattern);
    expect(patterns).toContain("docker run ubuntu:20.04 *");
    expect(patterns).toContain("docker run *");
    expect(patterns).toContain("docker *");
  });

  it("single positional arg still generates exe + arg * and exe * variants", () => {
    const patterns = derivePatternVariants("npm install lodash").map(x => x.pattern);
    expect(patterns).toContain("npm install lodash"); // exact
    expect(patterns).toContain("npm install *");
    expect(patterns).toContain("npm *");
  });

  it("exact variant is always first, then progressively shorter", () => {
    const cmd = "gh issue create --title test";
    const v = derivePatternVariants(cmd);
    expect(v[0].pattern).toBe(cmd);
    const patterns = v.map(x => x.pattern);
    expect(patterns).toContain("gh issue create *");
    expect(patterns).toContain("gh issue *");
    expect(patterns).toContain("gh *");
  });

  it("never duplicates patterns", () => {
    const v = derivePatternVariants("gh pr review --approve");
    const patterns = v.map(x => x.pattern);
    expect(new Set(patterns).size).toBe(patterns.length);
  });
});

// ---------------------------------------------------------------------------
// File edit/write variants
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
    const patterns = derivePatternVariants("src/components/Foo.tsx", "edit").map(x => x.pattern);
    expect(patterns).toContain("src/components/*");
  });

  it("includes workspace root wildcard when workspacePath provided", () => {
    const patterns = derivePatternVariants(
      "C:/projects/pipelines/src/hello.md", "edit", "C:/projects/pipelines"
    ).map(x => x.pattern);
    expect(patterns).toContain("C:/projects/pipelines/*");
  });

  it("always ends with catch-all * variant", () => {
    const v = derivePatternVariants("src/hello.md", "edit");
    expect(v[v.length - 1].pattern).toBe("*");
    expect(v[v.length - 1].label).toBe("*");
  });

  it("does NOT include extension wildcards like *.md", () => {
    const patterns = derivePatternVariants("hello.md", "edit").map(x => x.pattern);
    expect(patterns.every(p => !p.startsWith("*."))).toBe(true);
  });

  it("works the same with kind=write", () => {
    const v = derivePatternVariants("README.md", "write");
    expect(v.length).toBeGreaterThan(1);
    expect(v[v.length - 1].pattern).toBe("*");
  });

  it("works the same with kind=create", () => {
    const patterns = derivePatternVariants("dist/output.js", "create").map(x => x.pattern);
    expect(patterns).toContain("dist/*");
    expect(patterns).toContain("*");
  });

  it("handles Windows-style backslash paths", () => {
    const patterns = derivePatternVariants("src\\components\\Foo.tsx", "edit").map(x => x.pattern);
    expect(patterns).toContain("src/components/*");
  });

  it("never duplicates patterns", () => {
    const v = derivePatternVariants("C:/projects/pipelines/src/utils/helpers.ts", "edit", "C:/projects/pipelines");
    const unique = new Set(v.map(x => x.pattern));
    expect(unique.size).toBe(v.length);
  });

  it("deduplicates when immediate dir equals workspace root", () => {
    const patterns = derivePatternVariants(
      "C:/projects/pipelines/hello.md", "edit", "C:/projects/pipelines"
    ).map(x => x.pattern);
    expect(patterns.filter(p => p === "C:/projects/pipelines/*").length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Compound shell commands (&&, |, ;)
// ---------------------------------------------------------------------------
describe("derivePatternVariants — compound shell commands", () => {
  const COMMAND = "cd LekkerLoyal && cat functions/package.json 2>/dev/null | head -40";
  const KIND    = "execute";

  it("produces exactly 3 variants: exact, scoped, and bare", () => {
    expect(derivePatternVariants(COMMAND, KIND)).toHaveLength(3);
  });

  it("first variant is always the exact command", () => {
    const v = derivePatternVariants(COMMAND, KIND);
    expect(v[0].pattern).toBe(COMMAND);
    expect(v[0].label).toBe(COMMAND);
  });

  it("second variant is scoped — first-arg directory prefix per sub-command", () => {
    const v = derivePatternVariants(COMMAND, KIND);
    expect(v[1].label).toBe("cd LekkerLoyal/*, cat functions/*, head *");
    expect(v[1].pattern).toBe("cd LekkerLoyal/* && cat functions/* | head *");
  });

  it("third variant is bare — any args to any of these commands", () => {
    const v = derivePatternVariants(COMMAND, KIND);
    expect(v[2].label).toBe("cd *, cat *, head *");
    expect(v[2].pattern).toBe("cd * && cat * | head *");
  });

  it("never duplicates patterns", () => {
    const v = derivePatternVariants(COMMAND, KIND);
    const unique = new Set(v.map(x => x.pattern));
    expect(unique.size).toBe(v.length);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
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
    expect(v[1].pattern).toBe("cd LekkerLoyal/* && cat functions/* | head *");
  });

  it("third variant is the bare option — any args to any of these commands", () => {
    const v = derivePatternVariants(COMMAND, KIND);
    expect(v[2].label).toBe("cd *, cat *, head *");
    expect(v[2].pattern).toBe("cd * && cat * | head *");
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

// ---------------------------------------------------------------------------
// Multi-positional argument commands (e.g., gh issue create, npm run build)
// ---------------------------------------------------------------------------
describe("derivePatternVariants — multi-positional commands", () => {
  it("generates progressive variants from exe + each positional arg level (exact bug case)", () => {
    // Real-world gh issue create command with options
    const cmd =
      'gh issue create --title "Polish project for professional presentation" ' +
      '--body "## Goal Make the project look more professional" ' +
      '--label "infra" 2>&1';

    const v = derivePatternVariants(cmd);
    const patterns = v.map(x => x.pattern);

    // Should have: exact, gh issue create *, gh issue *, gh *
    expect(v.length).toBeGreaterThanOrEqual(4);

    // 1. Exact command (all quoted/complex args)
    expect(patterns).toContain(cmd);

    // 2. gh issue create * — longest positional run
    expect(patterns).toContain("gh issue create *");

    // 3. gh issue * — shorter run
    expect(patterns).toContain("gh issue *");

    // 4. gh * — exe only
    expect(patterns).toContain("gh *");

    // Verify order: exact first
    expect(patterns[0]).toBe(cmd);

    // Verify no duplicates
    const unique = new Set(patterns);
    expect(unique.size).toBe(patterns.length);
  });

  it("stops collecting positionals at the first flag (--option or 2>)", () => {
    const cmd = 'gh issue create --title "test" --body "text"';
    const v = derivePatternVariants(cmd);
    const patterns = v.map(x => x.pattern);

    // Should NOT include patterns like "gh issue create --title *" or "gh issue --title *"
    // Only: gh issue create *, gh issue *, gh *, and exact
    expect(patterns).not.toContain("gh issue create --title *");
    expect(patterns).not.toContain("gh issue --title *");

    // Should include the correct variants
    expect(patterns).toContain("gh issue create *");
    expect(patterns).toContain("gh issue *");
    expect(patterns).toContain("gh *");
  });

  it("handles npm run build with positional args", () => {
    const cmd = "npm run build --production --watch";
    const v = derivePatternVariants(cmd);
    const patterns = v.map(x => x.pattern);

    // npm, run, build are positional; --production and --watch are options
    expect(patterns).toContain("npm run build *");
    expect(patterns).toContain("npm run *");
    expect(patterns).toContain("npm *");
  });

  it("handles docker run with multiple positionals", () => {
    const cmd = "docker run ubuntu:20.04 bash --version";
    const v = derivePatternVariants(cmd);
    const patterns = v.map(x => x.pattern);

    // All are positional before the option-like flag (--version)
    // Actually --version starts with --, so it stops there
    expect(patterns).toContain("docker run ubuntu:20.04 *");
    expect(patterns).toContain("docker run *");
    expect(patterns).toContain("docker *");
  });

  it("single positional arg still generates exe + arg * and exe * variants", () => {
    const cmd = "npm install lodash";
    const v = derivePatternVariants(cmd);
    const patterns = v.map(x => x.pattern);

    expect(patterns).toContain(cmd);           // exact
    expect(patterns).toContain("npm install *"); // exe + positional(s)
    expect(patterns).toContain("npm *");         // exe only
  });

  it("preserves order: exact first, then progressively shorter patterns", () => {
    const cmd = "gh issue create --title test";
    const v = derivePatternVariants(cmd);

    expect(v[0].pattern).toBe(cmd); // exact always first
    // Then variants in descending specificity
    const patterns = v.map(x => x.pattern);
    expect(patterns).toContain("gh issue create *");
    expect(patterns).toContain("gh issue *");
    expect(patterns).toContain("gh *");
  });
});



// ---------------------------------------------------------------------------
// BUG FIX: deriveShellVariants — quoted operator false-positive compound detection
//
// The naive /&&|\|\|?|;/.test(command) regex incorrectly treats operators
// INSIDE quoted arguments as compound separators. This caused the "Allow Similar"
// dialog to show broken "scoped/bare" compound variants instead of the correct
// "script *" and "exe *" variants for web-search style commands.
// ---------------------------------------------------------------------------

describe("derivePatternVariants — quoted operators must NOT trigger compound path", () => {
  const PYTHON_EXE = "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe";
  const SCRIPT = "C:/Users/jorda/.claude/skills/web-search/main.py";

  // --- Real-world commands from the bug report ---

  it("web-search cmd1: double-quoted query produces script/* and exe/* variants (not compound)", () => {
    const cmd = `${PYTHON_EXE} ${SCRIPT} text "Google Workspace CLI tool command line interface" --max 10`;
    const v = derivePatternVariants(cmd);
    const patterns = v.map(x => x.pattern);

    // Should NOT be treated as compound
    expect(v.length).toBe(3); // exact, script*, exe*
    expect(patterns[0]).toBe(cmd);
    expect(patterns[1]).toBe(`${PYTHON_EXE} ${SCRIPT} *`);
    expect(patterns[2]).toBe(`${PYTHON_EXE} *`);

    // Must NOT contain compound-style "&&" patterns
    patterns.forEach(p => expect(p).not.toContain("&&"));
  });

  it("web-search cmd2: double-quoted query produces same script/* variant (not compound)", () => {
    const cmd = `${PYTHON_EXE} ${SCRIPT} text "gws google workspace CLI install authentication account" --max 8`;
    const v = derivePatternVariants(cmd);
    const patterns = v.map(x => x.pattern);

    expect(v.length).toBe(3);
    expect(patterns[1]).toBe(`${PYTHON_EXE} ${SCRIPT} *`);
    expect(patterns[2]).toBe(`${PYTHON_EXE} *`);
    patterns.forEach(p => expect(p).not.toContain("&&"));
  });

  it("both web-search commands produce the SAME script-level pattern for allow-similar matching", () => {
    const cmd1 = `${PYTHON_EXE} ${SCRIPT} text "Google Workspace CLI tool command line interface" --max 10`;
    const cmd2 = `${PYTHON_EXE} ${SCRIPT} text "gws google workspace CLI install authentication account" --max 8`;

    const v1 = derivePatternVariants(cmd1).map(x => x.pattern);
    const v2 = derivePatternVariants(cmd2).map(x => x.pattern);

    // Script-level variant must be identical for both commands
    expect(v1[1]).toBe(v2[1]);
    expect(v1[1]).toBe(`${PYTHON_EXE} ${SCRIPT} *`);

    // Exe-level variant must also be identical
    expect(v1[2]).toBe(v2[2]);
    expect(v1[2]).toBe(`${PYTHON_EXE} *`);
  });

  it("| inside double-quoted argument does NOT trigger compound path", () => {
    const cmd = `${PYTHON_EXE} ${SCRIPT} text "foo | bar baz" --max 5`;
    const v = derivePatternVariants(cmd);
    const patterns = v.map(x => x.pattern);

    expect(v.length).toBe(3);
    expect(patterns[0]).toBe(cmd);
    expect(patterns[1]).toBe(`${PYTHON_EXE} ${SCRIPT} *`);
    expect(patterns[2]).toBe(`${PYTHON_EXE} *`);
    patterns.forEach(p => expect(p).not.toContain("&&"));
  });

  it("| inside single-quoted argument does NOT trigger compound path", () => {
    const cmd = `${PYTHON_EXE} ${SCRIPT} text 'gws | CLI install' --max 8`;
    const v = derivePatternVariants(cmd);
    const patterns = v.map(x => x.pattern);

    expect(v.length).toBe(3);
    expect(patterns[1]).toBe(`${PYTHON_EXE} ${SCRIPT} *`);
    patterns.forEach(p => expect(p).not.toContain("&&"));
  });

  it("; inside double-quoted argument does NOT trigger compound path", () => {
    const cmd = `${PYTHON_EXE} ${SCRIPT} text "step1; step2" --max 5`;
    const v = derivePatternVariants(cmd);
    const patterns = v.map(x => x.pattern);

    expect(v.length).toBe(3);
    expect(patterns[1]).toBe(`${PYTHON_EXE} ${SCRIPT} *`);
    patterns.forEach(p => expect(p).not.toContain("&&"));
  });

  it("unquoted | IS treated as compound (pipeline is real)", () => {
    // An unquoted | outside any quotes is a genuine shell pipe → compound variants
    const cmd = `${PYTHON_EXE} ${SCRIPT} text foo | head -5`;
    const v = derivePatternVariants(cmd);
    // Should get 3 variants: exact + scoped + bare (compound path)
    expect(v.length).toBe(3);
    expect(v[0].pattern).toBe(cmd); // exact
    // Scoped and bare variants preserve the real pipeline operator
    expect(v[1].pattern).toContain("|");
    expect(v[2].pattern).toContain("|");
  });

  it("unquoted && IS treated as compound", () => {
    const cmd = "cd workspace && ls -la";
    const v = derivePatternVariants(cmd);
    expect(v.length).toBe(3);
    expect(v[0].pattern).toBe(cmd);
    expect(v[1].pattern).toContain("&&");
    expect(v[2].pattern).toContain("&&");
  });

  // --- Confirm the "allow similar" workflow end-to-end ---

  it("end-to-end: saving script/* from cmd1 allows cmd2 via checkAllowedPattern prefix logic", () => {
    // This asserts the full workflow works:
    // 1. User runs cmd1, clicks "Allow Similar", picks the script-level variant
    // 2. The pattern "...main.py *" is saved
    // 3. cmd2 (same script, different query) should be auto-approved

    const cmd1 = `${PYTHON_EXE} ${SCRIPT} text "Google Workspace CLI tool command line interface" --max 10`;
    const cmd2 = `${PYTHON_EXE} ${SCRIPT} text "gws google workspace CLI install authentication account" --max 8`;

    // Get the script-level pattern from cmd1's variants
    const savedPattern = derivePatternVariants(cmd1)[1].pattern;
    expect(savedPattern).toBe(`${PYTHON_EXE} ${SCRIPT} *`);

    // Verify cmd2's normalized form starts with the saved pattern's prefix
    const normCmd2 = cmd2.replace(/\\/g, "/");
    const prefix = savedPattern.slice(0, -1); // remove trailing *
    expect(normCmd2.startsWith(prefix)).toBe(true);
  });
});


describe("centralized allow-similar regressions", () => {
  it("canonicalizes ACP Bash(*) labels and scopes them to Bash", () => {
    expect(parseToolPattern("Always Allow Bash(*)")).toEqual({ toolName: "Bash", pattern: "*" });
    const patterns = [{ pattern: "bash(*)", variant: "execute", createdAt: "2026-01-01" } as any];
    expect(checkAllowedPattern("anything --goes", "Bash", patterns)).toBe(true);
    expect(checkAllowedPattern("anything --goes", "Edit", patterns)).toBe(false);
    expect(checkAllowedPattern("anything --goes", undefined, patterns)).toBe(false);
  });

  it("round-trips an && compound variant into future approval", () => {
    const first = "cd project-a && npm test -- --runInBand";
    const saved = derivePatternVariants(first, "execute")[2].pattern;
    expect(saved).toBe("cd * && npm *");
    expect(checkAllowedPattern("cd project-b && npm run test", "Bash", [
      { pattern: saved, variant: "execute", toolName: "Bash", createdAt: "2026-01-01" } as any,
    ])).toBe(true);
    expect(checkAllowedPattern("cd project-b; npm run test", "Bash", [
      { pattern: saved, variant: "execute", toolName: "Bash", createdAt: "2026-01-01" } as any,
    ])).toBe(true);
  });

  it("round-trips a semicolon compound variant and preserves its operator", () => {
    const first = "cd project-a; npm test -- --runInBand";
    const saved = derivePatternVariants(first, "execute")[2].pattern;
    expect(saved).toBe("cd * ; npm *");
    expect(checkAllowedPattern("cd project-b; npm run test", "Bash", [
      { pattern: saved, variant: "execute", toolName: "Bash", createdAt: "2026-01-01" } as any,
    ])).toBe(true);
  });

  it("keeps escaped python -c scripts reusable through a quoted pipeline", () => {
    const first = 'python -c "import json; print(\\"a && b\\")" | echo "done"';
    const second = 'python -c "import sys; print(\\"c; d && e\\")" | echo "done"';
    expect(splitShellCommand(first).commands).toEqual([
      'python -c "import json; print(\\"a && b\\")"',
      'echo "done"',
    ]);

    const saved = derivePatternVariants(first, "execute")
      .find((item) => item.pattern === "python -c * | echo *")?.pattern;
    expect(saved).toBe("python -c * | echo *");
    expect(checkAllowedPattern(second, "Bash", [
      { pattern: saved!, variant: "execute", toolName: "Bash", createdAt: "2026-01-01" } as any,
    ])).toBe(true);
  });

  it("reuses messy multi-stage python compounds with quoted operators and redirection", () => {
    const first = 'python -c "import json; print(\\"a && b\\")" 2>&1 | tee "agent-output.log" | sed -n "1,20p" && echo "status: ok"';
    const second = 'python -c "import sys; print(\\"c; d || e\\")" 2>&1 | tee "run-output.log" | sed -n "1,50p" && echo "status: ok"';
    const saved = derivePatternVariants(first, "execute")
      .find((item) => item.pattern === "python -c * | tee * | sed * && echo *")?.pattern;
    expect(saved).toBe("python -c * | tee * | sed * && echo *");
    expect(checkAllowedPattern(second, "Bash", [
      { pattern: saved!, variant: "execute", toolName: "Bash", createdAt: "2026-01-01" } as any,
    ])).toBe(true);
  });
});


describe("PermissionManager decision boundary", () => {
  const request = {
    id: 7,
    method: "session/request_permission",
    params: {
      options: [{ kind: "allow_once", name: "Allow", optionId: "allow" }],
      toolCall: { kind: "execute", rawInput: { command: "npm run build" } },
    },
  };

  it("auto-approves without handing the request to the UI when a pattern matches", () => {
    const db = {
      getAllowedPatterns: () => [{ pattern: "Bash(npm run *)", variant: "execute", createdAt: "2026-01-01" }],
    } as any;
    expect(new PermissionManager(db).evaluate(request)).toEqual(expect.objectContaining({
      action: "auto_approve",
      requestId: 7,
      optionId: "allow",
      toolName: "Bash",
    }));
  });

  it("hands server-derived variants to the UI when no pattern matches", () => {
    const db = { getAllowedPatterns: () => [] } as any;
    const decision = new PermissionManager(db).evaluate(request);
    expect(decision?.action).toBe("request_user");
    if (decision?.action === "request_user") {
      expect(decision.raw.params.allowSimilar.toolName).toBe("Bash");
      expect(decision.raw.params.allowSimilar.variants.map((item: any) => item.pattern)).toContain("npm run build *");
    }
  });
});


describe("reported curl pipeline and WebFetch regressions", () => {
  it("matches a legacy && compound pattern against the live pipe command", () => {
    const command = 'curl -s "https://www.bbc.com/weather/2643743" | head -200';
    expect(checkAllowedPattern(command, "Bash", [
      { pattern: "curl * && head *", variant: "execute", toolName: "Bash", createdAt: "2026-01-01" },
    ])).toBe(true);
  });

  it("deduplicates identical compound variants when scoped and bare forms converge", () => {
    const patterns = derivePatternVariants('curl -s "https://www.bbc.com/weather/2643743" | head -200', "execute");
    expect(patterns.map((item) => item.pattern)).toEqual([
      'curl -s "https://www.bbc.com/weather/2643743" | head -200',
      "curl * | head *",
    ]);
  });

  it("derives WebFetch variants and auto-approves the same domain", () => {
    const manager = new PermissionManager({
      getAllowedPatterns: () => [{
        pattern: "domain:weather.metoffice.gov.uk",
        toolName: "WebFetch",
        variant: "execute",
        createdAt: "2026-01-01",
      }],
    } as any);
    const request = {
      id: 9,
      method: "session/request_permission",
      params: {
        options: [{ kind: "allow_once", name: "Allow", optionId: "allow" }],
        toolCall: {
          kind: "fetch",
          title: "Fetch https://weather.metoffice.gov.uk/forecast/gcpvj0v07",
          rawInput: { url: "https://weather.metoffice.gov.uk/forecast/gcpvj0v07" },
        },
      },
    };
    const decision = manager.evaluate(request);
    expect(decision).toEqual(expect.objectContaining({
      action: "auto_approve",
      toolName: "WebFetch",
    }));

    const prompt = manager.evaluate({
      ...request,
      id: 10,
      params: {
        ...request.params,
        toolCall: {
          ...request.params.toolCall,
          rawInput: { url: "https://www.bbc.com/weather/2643743" },
        },
      },
    });
    expect(prompt?.action).toBe("request_user");
    if (prompt?.action === "request_user") {
      expect(prompt.presentation.variants).toHaveLength(2);
      expect(prompt.presentation.toolName).toBe("WebFetch");
      expect(prompt.presentation.variants[1].pattern).toBe("domain:www.bbc.com");
    }
  });

  it("derives WebFetch variants when ACP sends a domain instead of a URL", () => {
    const manager = new PermissionManager({ getAllowedPatterns: () => [] } as any);
    const decision = manager.evaluate({
      id: 11,
      method: "session/request_permission",
      params: {
        options: [{ kind: "allow_once", name: "Allow", optionId: "allow" }],
        toolCall: { kind: "fetch", rawInput: { domain: "weather.metoffice.gov.uk" } },
      },
    });
    expect(decision?.action).toBe("request_user");
    if (decision?.action === "request_user") {
      expect(decision.presentation.toolName).toBe("WebFetch");
      expect(decision.presentation.variants.length).toBeGreaterThan(1);
    }
  });
});