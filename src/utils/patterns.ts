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

function deriveShellVariants(command: string): Array<{ label: string; pattern: string }> {
  const variants: Array<{ label: string; pattern: string }> = [];

  // Exact command
  variants.push({ label: command, pattern: command });

  // Detect compound commands (&&, ||, ;, |) and generate combined-pattern variants.
  // We never add individual per-subcommand options — only two combined ones:
  //   1. Scoped:  "cd LekkerLoyal/*, cat functions/*, head *"  (first arg as path prefix)
  //   2. Bare:    "cd *, cat *, head *"                        (any args to any of these)
  const isCompound = /&&|\|\|?|;/.test(command);
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

  // Script-level wildcard: exe + script + *
  if (parts.length >= 2) {
    const script = parts[1];
    const scriptPattern = `${exe} ${script} *`;
    if (scriptPattern !== command) {
      variants.push({ label: scriptPattern, pattern: scriptPattern });
    }
  }

  // Executable-level wildcard: exe + *
  if (parts.length >= 2) {
    const exePattern = `${exe} *`;
    if (exePattern !== command && !variants.some(v => v.pattern === exePattern)) {
      variants.push({ label: `${exeName} *`, pattern: exePattern });
    }
  }

  // Simple name wildcard for bare commands (no path separators)
  if (!exe.includes("/") && !exe.includes("\\") && exe !== command) {
    const simplePattern = `${exe} *`;
    if (!variants.some(v => v.pattern === simplePattern)) {
      variants.push({ label: simplePattern, pattern: simplePattern });
    }
  }

  return variants;
}
