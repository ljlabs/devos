/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Derives meaningful pattern variants from a raw tool command string.
 *
 * Given: C:/Users/jorda/.../python.exe C:/Users/jorda/.../main.py text "temp" --max 5
 * Returns:
 *   - This exact command only
 *   - C:/Users/jorda/.../python.exe C:/Users/jorda/.../main.py * (any args to this script)
 *   - C:/Users/jorda/.../python.exe * (any python script)
 *   - python.exe * (simple executable prefix, only if exe has no path separators)
 */
export function derivePatternVariants(command: string): Array<{ label: string; pattern: string }> {
  if (!command) return [];

  const variants: Array<{ label: string; pattern: string }> = [];
  
  // Always offer the exact command
  variants.push({ label: `Exact: ${command}`, pattern: command });

  const parts = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  if (parts.length === 0) return variants;

  const exe = parts[0];
  const exeName = exe.split(/[\\/]/).pop() ?? exe; // basename

  // If there's a second part that looks like a script path, offer script-level wildcard
  if (parts.length >= 2) {
    const script = parts[1];
    const scriptPattern = `${exe} ${script} *`;
    if (scriptPattern !== command) {
      variants.push({
        label: `${exe} ${script} * (any args to this script)`,
        pattern: scriptPattern,
      });
    }
  }

  // Executable-level wildcard (any script with this interpreter)
  if (parts.length >= 2) {
    const exePattern = `${exe} *`;
    if (exePattern !== command && !variants.some(v => v.pattern === exePattern)) {
      variants.push({
        label: `${exe} * (any command via ${exeName})`,
        pattern: exePattern,
      });
    }
  }

  // If exe is a simple command (no path separators), offer just the command name
  if (!exe.includes("/") && !exe.includes("\\") && exe !== command) {
    const simplePattern = `${exe} *`;
    if (!variants.some(v => v.pattern === simplePattern)) {
      variants.push({
        label: `${exe} * (any ${exe} command)`,
        pattern: simplePattern,
      });
    }
  }

  return variants;
}
