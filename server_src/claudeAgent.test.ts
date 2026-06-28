/**
 * claudeAgent.test.ts
 *
 * Unit tests for the ClaudeAgent permission system.
 * Tests StaticPermissionStrategy and error handling.
 * 
 * Note: Integration tests with the full state machine are in claudeAgent.integration.test.ts
 *
 * Test runner: Vitest
 * Run: npm test -- claudeAgent.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  StaticPermissionStrategy,
  IPermissionStrategy,
} from "./claudeAgent";

// ---------------------------------------------------------------------------
// StaticPermissionStrategy Tests — Happy Path
// ---------------------------------------------------------------------------

describe("StaticPermissionStrategy — Happy Path", () => {
  it("allows exact pattern matches", () => {
    const s = new StaticPermissionStrategy(["npm run lint", "npm test"]);
    expect(s.isAllowed("npm run lint")).toBe(true);
    expect(s.isAllowed("npm test")).toBe(true);
  });

  it("allows prefix matches", () => {
    const s = new StaticPermissionStrategy(["npm run"]);
    expect(s.isAllowed("npm run lint")).toBe(true);
    expect(s.isAllowed("npm run build")).toBe(true);
    expect(s.isAllowed("npm run")).toBe(true);
  });

  it("allows everything with wildcard", () => {
    const s = new StaticPermissionStrategy(["*"]);
    expect(s.isAllowed("rm -rf /")).toBe(true);
    expect(s.isAllowed("any random command")).toBe(true);
    expect(s.isAllowed("python -c 'import os; os.remove(\"/\")'")).toBe(true);
  });

  it("allows with multiple patterns", () => {
    const s = new StaticPermissionStrategy([
      "npm run lint",
      "npm test",
      "git commit",
    ]);
    expect(s.isAllowed("npm run lint")).toBe(true);
    expect(s.isAllowed("npm test -- --watch")).toBe(true);
    expect(s.isAllowed("git commit -am 'fix'")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// StaticPermissionStrategy Tests — Unhappy Path
// ---------------------------------------------------------------------------

describe("StaticPermissionStrategy — Unhappy Path", () => {
  it("rejects command that matches no pattern", () => {
    const s = new StaticPermissionStrategy(["npm run lint"]);
    expect(s.isAllowed("rm -rf /")).toBe(false);
  });

  it("rejects when pattern list is empty", () => {
    const s = new StaticPermissionStrategy([]);
    expect(s.isAllowed("npm run lint")).toBe(false);
    expect(s.isAllowed("any command")).toBe(false);
  });

  it("does not allow substring matches (only prefix)", () => {
    const s = new StaticPermissionStrategy(["run lint"]);
    expect(s.isAllowed("npm run lint")).toBe(false);
  });

  it("does not allow partial word matches", () => {
    const s = new StaticPermissionStrategy(["npm"]);
    expect(s.isAllowed("npm run lint")).toBe(true);  // prefix match
    expect(s.isAllowed("mynpm")).toBe(false);        // no prefix match
  });

  it("rejects when only substring matches", () => {
    const s = new StaticPermissionStrategy(["bash -c"]);
    expect(s.isAllowed("python bash -c 'echo hi'")).toBe(false);  // bash is not prefix
  });
});

// ---------------------------------------------------------------------------
// StaticPermissionStrategy Tests — Error Handling
// ---------------------------------------------------------------------------

describe("StaticPermissionStrategy — Error Handling", () => {
  it("handles empty command string", () => {
    const s = new StaticPermissionStrategy(["npm run lint"]);
    expect(s.isAllowed("")).toBe(false);
  });

  it("handles very long command strings", () => {
    const s = new StaticPermissionStrategy(["npm"]);
    const longCommand = "npm " + "a".repeat(10000);
    expect(s.isAllowed(longCommand)).toBe(true);
  });

  it("handles special characters in patterns", () => {
    const s = new StaticPermissionStrategy([
      'bash -c "echo hello"',
      "node -e 'console.log()'",
    ]);
    expect(s.isAllowed('bash -c "echo hello"')).toBe(true);
    expect(s.isAllowed('bash -c "echo hello" | grep hello')).toBe(true);
    expect(s.isAllowed("node -e 'console.log()'")).toBe(true);
  });

  it("handles unicode and special characters in commands", () => {
    const s = new StaticPermissionStrategy(["python -c 'print(\"hello\")'", "café"]);
    expect(s.isAllowed("python -c 'print(\"hello\")' | less")).toBe(true);
    expect(s.isAllowed("café au lait")).toBe(true);
  });

  it("handles null and undefined edge cases", () => {
    const s = new StaticPermissionStrategy(["npm"]);
    expect(s.isAllowed(null as unknown as string)).toBe(false);
    expect(s.isAllowed(undefined as unknown as string)).toBe(false);
    expect(s.isAllowed(123 as unknown as string)).toBe(false);
  });

  it("handles patterns with leading/trailing spaces", () => {
    const s = new StaticPermissionStrategy(["  npm", "npm  ", " npm "]);
    // Patterns are used as-is (no trimming)
    expect(s.isAllowed("npm run lint")).toBe(false);  // doesn't match " npm " or "  npm"
    expect(s.isAllowed("  npm run lint")).toBe(true);  // matches " npm " pattern
  });
});

// ---------------------------------------------------------------------------
// StaticPermissionStrategy Tests — Edge Cases
// ---------------------------------------------------------------------------

describe("StaticPermissionStrategy — Edge Cases", () => {
  it("handles duplicate patterns correctly", () => {
    const s = new StaticPermissionStrategy(["npm", "npm", "npm"]);
    expect(s.isAllowed("npm run lint")).toBe(true);
  });

  it("handles wildcard mixed with other patterns", () => {
    const s = new StaticPermissionStrategy(["npm run lint", "*", "git"]);
    expect(s.isAllowed("anything")).toBe(true);  // wildcard allows all
    expect(s.isAllowed("npm run lint")).toBe(true);
    expect(s.isAllowed("git commit")).toBe(true);
  });

  it("handles overlapping patterns", () => {
    const s = new StaticPermissionStrategy(["npm", "npm run", "npm run lint"]);
    expect(s.isAllowed("npm run lint --fix")).toBe(true);  // all three match
    expect(s.isAllowed("npm")).toBe(true);
    expect(s.isAllowed("npm run")).toBe(true);
  });

  it("case sensitive matching", () => {
    const s = new StaticPermissionStrategy(["NPM run"]);
    expect(s.isAllowed("npm run lint")).toBe(false);  // case sensitive
    expect(s.isAllowed("NPM run lint")).toBe(true);
  });

  it("handles paths in commands", () => {
    const s = new StaticPermissionStrategy(["/usr/bin/npm", "C:\\Users\\user\\npm.exe"]);
    expect(s.isAllowed("/usr/bin/npm run lint")).toBe(true);
    expect(s.isAllowed("C:\\Users\\user\\npm.exe install")).toBe(true);
  });

  it("handles real-world python MCP tool commands", () => {
    const s = new StaticPermissionStrategy([
      "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe C:/Users/jorda/.claude/skills/web-search/main.py",
    ]);
    const command = 'C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe C:/Users/jorda/.claude/skills/web-search/main.py text "temperature today" --max 5';
    expect(s.isAllowed(command)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Custom Strategy Implementation
// ---------------------------------------------------------------------------

class RegexPermissionStrategy implements IPermissionStrategy {
  constructor(private patterns: RegExp[]) {}

  isAllowed(command: string): boolean {
    return this.patterns.some((pat) => pat.test(command));
  }
}

describe("Custom Permission Strategy Implementation", () => {
  it("allows custom regex-based strategy", () => {
    const s = new RegexPermissionStrategy([/^npm/, /^git/]);
    expect(s.isAllowed("npm run lint")).toBe(true);
    expect(s.isAllowed("git commit")).toBe(true);
    expect(s.isAllowed("rm -rf /")).toBe(false);
  });

  it("custom strategy with word boundary matching", () => {
    const s = new RegexPermissionStrategy([/\bnpm\b/, /\bgit\b/]);
    expect(s.isAllowed("npm run lint")).toBe(true);
    expect(s.isAllowed("mynpm run lint")).toBe(false);
    expect(s.isAllowed("git commit")).toBe(true);
  });

  it("custom strategy with negation", () => {
    // Deny rm and similar destructive commands
    const s = new RegexPermissionStrategy([/^(?!rm\s|mv\s|dd\s).*/]);
    expect(s.isAllowed("npm run lint")).toBe(true);
    expect(s.isAllowed("rm -rf /")).toBe(false);
    expect(s.isAllowed("mv file file2")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Singleton Tests
// ---------------------------------------------------------------------------

describe("ClaudeAgent Singleton Management", () => {
  it("ClaudeAgent.getInstance creates and retrieves instances", async () => {
    const { ClaudeAgent } = await import("./claudeAgent");
    const a = ClaudeAgent.getInstance("thread-x", "/ws", new StaticPermissionStrategy([]));
    const b = ClaudeAgent.getInstance("thread-x", "/ws", new StaticPermissionStrategy([]));
    expect(a).toBe(b);
    ClaudeAgent.removeInstance("thread-x");
  });

  it("ClaudeAgent.removeInstance clears instance", async () => {
    const { ClaudeAgent } = await import("./claudeAgent");
    const a = ClaudeAgent.getInstance("thread-y", "/ws", new StaticPermissionStrategy([]));
    ClaudeAgent.removeInstance("thread-y");
    const b = ClaudeAgent.getInstance("thread-y", "/ws", new StaticPermissionStrategy([]));
    expect(a).not.toBe(b);
    ClaudeAgent.removeInstance("thread-y");
  });

  it("different threadIds get different instances", async () => {
    const { ClaudeAgent } = await import("./claudeAgent");
    const a = ClaudeAgent.getInstance("thread-1", "/ws", new StaticPermissionStrategy([]));
    const b = ClaudeAgent.getInstance("thread-2", "/ws", new StaticPermissionStrategy([]));
    expect(a).not.toBe(b);
    ClaudeAgent.removeInstance("thread-1");
    ClaudeAgent.removeInstance("thread-2");
  });
});
