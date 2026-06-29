/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Derives meaningful pattern variants from a raw tool command string.
 *
 * For shell commands (kind: execute):
 *   Given: C:/Users/jorda/.../python.exe C:/Users/jorda/.../main.py text "temp" --max 5
 *   Returns:
 *     - This exact command only
 *     - C:/Users/jorda/.../python.exe C:/Users/jorda/.../main.py * (any args to this script)
 *     - C:/Users/jorda/.../python.exe * (any python script)
 *     - python.exe * (simple executable prefix, only if exe has no path separators)
 *
 * For file edit/write operations (kind: edit/write):
 *   Given: hello.md  or  src/components/Foo.tsx
 *   Returns:
 *     - This exact file
 *     - *.md (any file with same extension)
 *     - src/components/* (any file in same directory)
 */
export function derivePatternVariants(
  command: string,
  kind?: string,
  workspacePath?: string
): Array<{ label: string; pattern: string }> {
  if (!command) return [];

  // File edit/write/read — derive variants from the path itself
  if (kind === "edit" || kind === "write" || kind === "create" || kind === "read") {
    return deriveFileVariants(command, workspacePath);
  }

  return deriveShellVariants(command);
}

function deriveFileVariants(filePath: string, workspacePath?: string): Array<{ label: string; pattern: string }> {
  const variants: Array<{ label: string; pattern: string }> = [];

  // Normalise separators to forward slashes for consistent matching
  const normalised = filePath.replace(/\\/g, "/");
  const slashIdx = normalised.lastIndexOf("/");

  // 1. Exact file
  variants.push({ label: filePath, pattern: filePath });

  // 2. Immediate directory — same folder as the file
  if (slashIdx !== -1) {
    const dir = normalised.slice(0, slashIdx);
    variants.push({ label: `${dir}/*`, pattern: `${dir}/*` });
  }

  // 3. Workspace root — if the file lives deeper than one level inside the workspace
  if (workspacePath) {
    const normWs = workspacePath.replace(/\\/g, "/").replace(/\/$/, "");
    const wsPattern = `${normWs}/*`;
    // Only add if it's different from the immediate-directory pattern
    if (!variants.some(v => v.pattern === wsPattern)) {
      variants.push({ label: wsPattern, pattern: wsPattern });
    }
  }

  // 4. Any file anywhere
  variants.push({ label: "*", pattern: "*" });

  return variants;
}

/**
 * Returns true if `s` contains a shell compound operator (&&, ||, |, ;) that
 * is NOT inside a single- or double-quoted string.
 *
 * This is intentionally the same logic used in server.ts checkAllowedPattern so
 * the UI's variant generation and the server's matching always agree on what
 * counts as a "compound" command.
 */
function hasUnquotedOperator(s: string): boolean {
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (c === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (inDouble || inSingle) continue;
    if (c === "&" && s[i + 1] === "&") return true;
    if (c === "|") return true; // covers | and ||
    if (c === ";") return true;
  }
  return false;
}

function deriveShellVariants(command: string): Array<{ label: string; pattern: string }> {
  const variants: Array<{ label: string; pattern: string }> = [];

  // Exact command
  variants.push({ label: command, pattern: command });

  // Detect compound commands (&&, ||, ;, |) OUTSIDE of quoted strings.
  // Using a quote-aware walker instead of a naive regex so that operators
  // inside quoted arguments (e.g. --body "foo | bar") do NOT trigger this path.
  const isCompound = hasUnquotedOperator(command);
  if (isCompound) {
    // Split on compound operators, preserving each sub-command
    const subCmds = command
      .split(/\s*(?:&&|\|\|?|;)\s*/)
      .map((s) => s.trim())
      .filter(Boolean);

    // Helper: extract exe basename and first arg from a sub-command string
    const parseSubCmd = (sub: string) => {
      const parts = sub.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
      const exe = parts[0] ?? sub;
      const exeName = exe.split(/[\\/]/).pop() ?? exe;
      const firstArg = parts[1] ?? null; // may be a path like "LekkerLoyal" or "functions/pkg.json"
      return { exe, exeName, firstArg };
    };

    // Option 1 — scoped: use the first arg as a directory prefix where possible
    const scopedParts = subCmds.map((sub) => {
      const { exeName, firstArg } = parseSubCmd(sub);
      if (firstArg && !firstArg.startsWith("-") && !firstArg.startsWith("2>")) {
        // Strip any trailing filename, keep the directory portion as the scope prefix
        const dir = firstArg.replace(/\\/g, "/");
        const slashIdx = dir.lastIndexOf("/");
        // If it looks like a plain name (no slash), use it directly as a prefix
        const prefix = slashIdx !== -1 ? dir.slice(0, slashIdx) : dir;
        return `${exeName} ${prefix}/*`;
      }
      return `${exeName} *`;
    });
    const scopedLabel = scopedParts.join(", ");
    const scopedPattern = subCmds.map((sub) => {
      const { exe, firstArg } = parseSubCmd(sub);
      if (firstArg && !firstArg.startsWith("-") && !firstArg.startsWith("2>")) {
        const dir = firstArg.replace(/\\/g, "/");
        const slashIdx = dir.lastIndexOf("/");
        const prefix = slashIdx !== -1 ? dir.slice(0, slashIdx) : dir;
        return `${exe} ${prefix}/*`;
      }
      return `${exe} *`;
    }).join(" && ");

    variants.push({ label: scopedLabel, pattern: scopedPattern });

    // Option 2 — bare: any args to any of these commands
    const bareLabel = subCmds.map((sub) => `${parseSubCmd(sub).exeName} *`).join(", ");
    const barePattern = subCmds.map((sub) => `${parseSubCmd(sub).exe} *`).join(" && ");
    variants.push({ label: bareLabel, pattern: barePattern });

    return variants;
  }

  const parts = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  if (parts.length === 0) return variants;

  const exe = parts[0];
  const exeName = exe.split(/[\\/]/).pop() ?? exe; // basename

  // Find the longest run of positional args (non-options) after the executable.
  // Options start with - or 2>, so stop there.
  const positionalArgs: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith("-") || part.startsWith("2>")) {
      break; // Hit an option/redirect, stop collecting positionals
    }
    positionalArgs.push(part);
  }

  // Determine how many positional depth levels to generate variants for.
  //
  // For subcommand-style CLIs (e.g. "gh issue create --title ..."):
  //   positionalArgs = ["issue", "create"] → generate gh issue create *, gh issue *, gh *
  //
  // For script-style invocations (e.g. "python.exe main.py search_query 'text'"):
  //   The second positional looks like a file path (has extension or path separator).
  //   In that case, only generate the script-level variant ("python.exe main.py *")
  //   rather than ("python.exe main.py search_query *") — the extra depth is noise.
  let maxDepth = positionalArgs.length;
  if (
    positionalArgs.length >= 1 &&
    (positionalArgs[0].includes("/") ||
      positionalArgs[0].includes("\\") ||
      /\.\w{1,6}$/.test(positionalArgs[0]))
  ) {
    // First positional looks like a file path — treat as script, cap depth at 1
    maxDepth = 1;
  }

  // Generate variants from exe + positional args, from longest to shortest.
  // For "gh issue create --title ...", generates:
  //   1. gh issue create *
  //   2. gh issue *
  //   3. gh *
  for (let i = maxDepth; i >= 1; i--) {
    const positionalSlice = positionalArgs.slice(0, i).join(" ");
    const pattern = `${exe} ${positionalSlice} *`;
    if (pattern !== command && !variants.some(v => v.pattern === pattern)) {
      // Label equals the full pattern — so the displayed text is unambiguous
      variants.push({ label: pattern, pattern });
    }
  }

  // Executable-level wildcard: exe + *
  // Only meaningful when the command actually has arguments to wildcard over.
  if (parts.length >= 2) {
    const exePattern = `${exe} *`;
    if (exePattern !== command && !variants.some(v => v.pattern === exePattern)) {
      variants.push({ label: `${exeName} *`, pattern: exePattern });
    }
  }

  return variants;
}
