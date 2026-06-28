import { describe, it, expect } from "vitest";
import { derivePatternVariants } from "../../src/utils/patterns";

describe("derivePatternVariants", () => {
  it("returns empty array for empty command", () => {
    const result = derivePatternVariants("");
    expect(result).toEqual([]);
  });

  it("returns only exact variant for single-part command", () => {
    const result = derivePatternVariants("python");
    // Single-part commands only get exact variant (no script part to create exe-level variant)
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ label: "Exact: python", pattern: "python" });
  });

  it("preserves full paths in labels (not basenames)", () => {
    const command = "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe C:/Users/jorda/.claude/skills/web-search/main.py --arg value";
    const result = derivePatternVariants(command);

    // Should have: exact, script-level wildcard, exe-level wildcard
    expect(result.length).toBeGreaterThanOrEqual(3);

    // First variant should be exact with full command
    expect(result[0].pattern).toBe(command);
    expect(result[0].label).toContain(command);

    // Script-level variant should have full exe and script paths
    expect(result[1].label).toContain("C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe");
    expect(result[1].label).toContain("C:/Users/jorda/.claude/skills/web-search/main.py");
    expect(result[1].pattern).toBe(
      "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe C:/Users/jorda/.claude/skills/web-search/main.py *"
    );

    // Exe-level variant should have full exe path
    expect(result[2].label).toContain("C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe");
    expect(result[2].pattern).toBe("C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe *");
  });

  it("shows 'any args to this script' description for script-level variant", () => {
    const command = "C:/Users/jorda/python.exe C:/Users/jorda/main.py arg1 arg2";
    const result = derivePatternVariants(command);

    const scriptVariant = result.find((v) => v.label.includes("(any args to this script)"));
    expect(scriptVariant).toBeDefined();
    expect(scriptVariant?.pattern).toBe(
      "C:/Users/jorda/python.exe C:/Users/jorda/main.py *"
    );
  });

  it("shows 'any command via' description for exe-level variant", () => {
    const command = "C:/Users/jorda/python.exe C:/Users/jorda/main.py";
    const result = derivePatternVariants(command);

    const exeVariant = result.find((v) => v.label.includes("(any command via"));
    expect(exeVariant).toBeDefined();
    expect(exeVariant?.label).toContain("python.exe"); // basename in description
    expect(exeVariant?.pattern).toContain("C:/Users/jorda/python.exe"); // full path in pattern
  });

  it("does not duplicate variants", () => {
    const command = "npm run build";
    const result = derivePatternVariants(command);

    // Check for duplicates
    const patterns = result.map((v) => v.pattern);
    const uniquePatterns = new Set(patterns);
    expect(patterns.length).toBe(uniquePatterns.size);
  });

  it("handles Windows paths with backslashes", () => {
    const command = "C:\\Users\\jorda\\python.exe C:\\Users\\jorda\\main.py";
    const result = derivePatternVariants(command);

    expect(result.length).toBeGreaterThanOrEqual(2);

    // Exact variant
    expect(result[0].pattern).toBe(command);

    // Script-level variant should preserve backslashes
    expect(result[1].pattern).toBe(
      "C:\\Users\\jorda\\python.exe C:\\Users\\jorda\\main.py *"
    );
  });

  it("handles mixed forward and backward slashes", () => {
    const command = "C:\\Users/jorda\\python.exe C:\\Users/jorda\\main.py";
    const result = derivePatternVariants(command);

    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].pattern).toBe(command);
    expect(result[1].pattern).toBe(
      "C:\\Users/jorda\\python.exe C:\\Users/jorda\\main.py *"
    );
  });

  it("handles quoted arguments", () => {
    const command = 'C:/Users/jorda/python.exe C:/Users/jorda/main.py "arg with spaces" --flag';
    const result = derivePatternVariants(command);

    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].pattern).toBe(command);
    expect(result[1].pattern).toBe(
      'C:/Users/jorda/python.exe C:/Users/jorda/main.py *'
    );
  });

  it("handles single-quoted arguments", () => {
    const command = "C:/Users/jorda/python.exe C:/Users/jorda/main.py 'arg with spaces'";
    const result = derivePatternVariants(command);

    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].pattern).toBe(command);
  });

  it("excludes simple command variant if exe has path separators", () => {
    const command = "C:/Users/jorda/python.exe";
    const result = derivePatternVariants(command);

    // Should only have exact variant, no simple command variant
    expect(result.length).toBe(1);
    expect(result[0].pattern).toBe(command);
  });

  it("includes simple command variant if exe has no path separators", () => {
    const command = "python C:/Users/jorda/main.py";
    const result = derivePatternVariants(command);

    const simpleVariant = result.find((v) =>
      v.pattern === "python *"
    );
    expect(simpleVariant).toBeDefined();
    expect(simpleVariant?.pattern).toBe("python *");
  });

  it("real-world example: python web-search command", () => {
    const command =
      "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe C:/Users/jorda/.claude/skills/web-search/main.py search_query \"query text\"";
    const result = derivePatternVariants(command);

    expect(result.length).toBeGreaterThanOrEqual(3);

    // Exact
    expect(result[0].pattern).toBe(command);

    // Script-level
    expect(result[1].pattern).toBe(
      "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe C:/Users/jorda/.claude/skills/web-search/main.py *"
    );

    // Exe-level
    expect(result[2].pattern).toBe(
      "C:/Users/jorda/.claude/skills/web-search/venv/Scripts/python.exe *"
    );

    // All labels should contain full paths
    result.forEach((variant) => {
      if (variant.pattern.includes("C:/Users/jorda/.claude")) {
        expect(variant.label).toContain("C:/Users/jorda/.claude");
      }
    });
  });

  it("real-world example: npm build command", () => {
    const command = "npm run build";
    const result = derivePatternVariants(command);

    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].pattern).toBe("npm run build");
    // Second part after "npm" is "run", so the exe-level wildcard is "npm *"
    // which gets created along with other variants
    expect(result.some(v => v.pattern === "npm *")).toBe(true);
  });

  it("generates non-empty labels for all variants", () => {
    const command = "C:/Users/jorda/python.exe C:/Users/jorda/main.py arg";
    const result = derivePatternVariants(command);

    result.forEach((variant) => {
      expect(variant.label).toBeTruthy();
      expect(variant.label.length).toBeGreaterThan(0);
    });
  });
});
