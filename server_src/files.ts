/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from "fs";
import path from "path";

/**
 * File entry representing a file or directory in the workspace.
 */
export interface FileEntry {
  name: string;
  path: string;       // relative to workspace root
  type: "file" | "directory";
  size?: number;
  modified?: string;
}

/**
 * File content with metadata.
 */
export interface FileContent {
  path: string;
  content: string;
  size: number;
  lines: number;
  truncated?: boolean;
}

/**
 * Directories and files to exclude from listings.
 */
const EXCLUDE_PATTERNS = [
  ".git",
  "node_modules",
  "__pycache__",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".vercel",
];

/**
 * Check if a basename should be excluded from listings.
 */
function isExcluded(name: string): boolean {
  if (name.startsWith(".")) return true; // hidden files/dirs
  return EXCLUDE_PATTERNS.includes(name);
}

/**
 * Safely resolve a relative path within a workspace root.
 * Prevents path traversal attacks by ensuring the resolved path
 * stays within the workspace root directory.
 *
 * @param workspaceRoot Absolute path to the workspace root
 * @param relativePath Relative path from workspace root (may be empty for root)
 * @returns Absolute resolved path, or null if traversal detected
 */
export function resolveWithinWorkspace(
  workspaceRoot: string,
  relativePath?: string
): string | null {
  const normalizedRoot = path.resolve(workspaceRoot);

  // Empty or "." means the workspace root itself
  if (!relativePath || relativePath === "." || relativePath === "") {
    return normalizedRoot;
  }

  // Join and resolve the requested path
  const requestedPath = path.resolve(normalizedRoot, relativePath);

  // Verify the resolved path is within the workspace root
  // Using relative() - if it starts with ".." or is absolute, it's outside
  const relative = path.relative(normalizedRoot, requestedPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null; // Path traversal attempt
  }

  return requestedPath;
}

/**
 * List directory contents at the given relative path within a workspace.
 *
 * @param workspaceRoot Absolute path to the workspace root directory
 * @param relativePath Optional relative path from workspace root (defaults to root)
 * @returns Array of FileEntry objects sorted: directories first, then files, alphabetically
 */
export function listDirectory(
  workspaceRoot: string,
  relativePath?: string
): FileEntry[] {
  const absPath = resolveWithinWorkspace(workspaceRoot, relativePath);

  if (!absPath) {
    throw new Error("Invalid path: attempted traversal outside workspace");
  }

  if (!fs.existsSync(absPath)) {
    throw new Error(`Directory not found: ${relativePath ?? "/"}`);
  }

  const stat = fs.statSync(absPath);

  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${relativePath ?? "/"}`);
  }

  const entries = fs.readdirSync(absPath);

  const result: FileEntry[] = [];

  for (const name of entries) {
    if (isExcluded(name)) continue;

    const entryAbsPath = path.join(absPath, name);
    let entryStat: fs.Stats;

    try {
      entryStat = fs.statSync(entryAbsPath);
    } catch {
      // Skip entries we can't stat (broken symlinks, permission issues)
      continue;
    }

    const entryRelativePath = relativePath
      ? path.posix.join(relativePath, name)
      : name;

    result.push({
      name,
      path: entryRelativePath.split(path.sep).join("/"), // normalize to forward slashes
      type: entryStat.isDirectory() ? "directory" : "file",
      size: entryStat.isFile() ? entryStat.size : undefined,
      modified: entryStat.mtime.toISOString(),
    });
  }

  // Sort: directories first, then files, alphabetically within each group
  result.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "directory" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return result;
}

/**
 * Read file content with size limit and line count.
 *
 * @param workspaceRoot Absolute path to the workspace root directory
 * @param relativePath Relative path to the file from workspace root
 * @returns FileContent object with content, size, and line count
 */
export function readFile(
  workspaceRoot: string,
  relativePath: string
): FileContent {
  const absPath = resolveWithinWorkspace(workspaceRoot, relativePath);

  if (!absPath) {
    throw new Error("Invalid path: attempted traversal outside workspace");
  }

  if (!fs.existsSync(absPath)) {
    throw new Error(`File not found: ${relativePath}`);
  }

  const stat = fs.statSync(absPath);

  if (!stat.isFile()) {
    throw new Error(`Not a file: ${relativePath}`);
  }

  const MAX_SIZE = 1024 * 1024; // Cap at ~1MB for safety

	let contentBuffer = Buffer.alloc(Math.min(stat.size, MAX_SIZE));
	fs.readSync(fs.openSync(absPath, "r"), contentBuffer, { length: contentBuffer.length });
	// Convert buffer to string safely - handle potential encoding issues by replacing invalid sequences
	const decoder = new TextDecoder("utf-8", { fatal: false });
	const content = decoder.decode(contentBuffer);

	const lines = content.split("\n").length;

	return {
		path: relativePath.split(path.sep).join("/"),
		content,
		size: stat.size,
		lines,
		truncated: stat.size > MAX_SIZE,
	};
}

/**
 * Write content to a file within the workspace.
 * Creates parent directories if they don't exist.
 *
 * @param workspaceRoot Absolute path to the workspace root directory
 * @param relativePath Relative path to the file from workspace root
 * @param content Content to write (UTF-8)
 * @returns FileContent object of the written file
 */
export function writeFile(
  workspaceRoot: string,
  relativePath: string,
  content: string
): FileContent {
  const absPath = resolveWithinWorkspace(workspaceRoot, relativePath);

  if (!absPath) {
    throw new Error("Invalid path: attempted traversal outside workspace");
  }

  // Create parent directories if they don't exist
  const dir = path.dirname(absPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write the file
  fs.writeFileSync(absPath, content, "utf-8");

  // Return metadata
  const stat = fs.statSync(absPath);
  const lines = content.split("\n").length;

  return {
    path: relativePath.split(path.sep).join("/"),
    content,
    size: stat.size,
    lines,
  };
}