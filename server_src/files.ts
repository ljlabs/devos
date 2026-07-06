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
 * Create a new file or directory within the workspace.
 *
 * @param workspaceRoot Absolute path to the workspace root directory
 * @param relativePath Relative path from workspace root
 * @param type "file" or "directory"
 * @returns FileEntry of the created entry
 */
export function createEntry(
  workspaceRoot: string,
  relativePath: string,
  type: "file" | "directory"
): FileEntry {
  const absPath = resolveWithinWorkspace(workspaceRoot, relativePath);

  if (!absPath) {
    throw new Error("Invalid path: attempted traversal outside workspace");
  }

  if (fs.existsSync(absPath)) {
    throw new Error(`Already exists: ${relativePath}`);
  }

  if (type === "directory") {
    fs.mkdirSync(absPath, { recursive: true });
  } else {
    const dir = path.dirname(absPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(absPath, "", "utf-8");
  }

  const stat = fs.statSync(absPath);
  const name = path.basename(relativePath);

  return {
    name,
    path: relativePath.split(path.sep).join("/"),
    type,
    size: type === "file" ? 0 : undefined,
    modified: stat.mtime.toISOString(),
  };
}

/**
 * Rename a file or directory within the workspace.
 *
 * @param workspaceRoot Absolute path to the workspace root directory
 * @param oldRelativePath Current relative path from workspace root
 * @param newName New base name (not a full path)
 * @returns FileEntry of the renamed entry
 */
export function renameEntry(
  workspaceRoot: string,
  oldRelativePath: string,
  newName: string
): FileEntry {
  const oldAbsPath = resolveWithinWorkspace(workspaceRoot, oldRelativePath);

  if (!oldAbsPath) {
    throw new Error("Invalid path: attempted traversal outside workspace");
  }

  if (!fs.existsSync(oldAbsPath)) {
    throw new Error(`Not found: ${oldRelativePath}`);
  }

  const parentDir = path.dirname(oldAbsPath);
  const newAbsPath = path.join(parentDir, newName);

  // Verify the new path is still within workspace
  const newRelative = path.relative(
    path.resolve(workspaceRoot),
    newAbsPath
  );
  if (newRelative.startsWith("..") || path.isAbsolute(newRelative)) {
    throw new Error("Invalid name: would escape workspace");
  }

  if (fs.existsSync(newAbsPath)) {
    throw new Error(`Already exists: ${newName}`);
  }

  fs.renameSync(oldAbsPath, newAbsPath);

  const stat = fs.statSync(newAbsPath);
  const oldParent = path.dirname(oldRelativePath);
  const newRelativePath = oldParent === "." ? newName : `${oldParent}/${newName}`;

  return {
    name: newName,
    path: newRelativePath.split(path.sep).join("/"),
    type: stat.isDirectory() ? "directory" : "file",
    size: stat.isFile() ? stat.size : undefined,
    modified: stat.mtime.toISOString(),
  };
}

/**
 * Delete a file or directory within the workspace.
 *
 * @param workspaceRoot Absolute path to the workspace root directory
 * @param relativePath Relative path from workspace root
 */
export function deleteEntry(
  workspaceRoot: string,
  relativePath: string
): void {
  const absPath = resolveWithinWorkspace(workspaceRoot, relativePath);

  if (!absPath) {
    throw new Error("Invalid path: attempted traversal outside workspace");
  }

  if (!fs.existsSync(absPath)) {
    throw new Error(`Not found: ${relativePath}`);
  }

  fs.rmSync(absPath, { recursive: true, force: true });
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

/**
 * Move a file or directory to a new parent directory within the workspace.
 *
 * @param workspaceRoot Absolute path to the workspace root directory
 * @param sourceRelativePath Current relative path from workspace root
 * @param destParentRelativePath Destination parent directory relative path (or empty for root)
 * @returns FileEntry of the moved entry
 */
export function moveEntry(
  workspaceRoot: string,
  sourceRelativePath: string,
  destParentRelativePath: string
): FileEntry {
  const sourceAbsPath = resolveWithinWorkspace(
    workspaceRoot,
    sourceRelativePath
  );

  if (!sourceAbsPath) {
    throw new Error("Invalid source path: attempted traversal outside workspace");
  }

  if (!fs.existsSync(sourceAbsPath)) {
    throw new Error(`Source not found: ${sourceRelativePath}`);
  }

  const destParentAbsPath = resolveWithinWorkspace(
    workspaceRoot,
    destParentRelativePath || "."
  );

  if (!destParentAbsPath) {
    throw new Error(
      "Invalid destination path: attempted traversal outside workspace"
    );
  }

  if (!fs.existsSync(destParentAbsPath)) {
    throw new Error(`Destination directory not found: ${destParentRelativePath}`);
  }

  const stat = fs.statSync(destParentAbsPath);
  if (!stat.isDirectory()) {
    throw new Error(
      `Destination is not a directory: ${destParentRelativePath}`
    );
  }

  // Extract the base name from the source path
  const baseName = path.basename(sourceAbsPath);
  const destAbsPath = path.join(destParentAbsPath, baseName);

  // Verify destination path is still within workspace
  const newRelative = path.relative(
    path.resolve(workspaceRoot),
    destAbsPath
  );
  if (newRelative.startsWith("..") || path.isAbsolute(newRelative)) {
    throw new Error("Invalid destination: would escape workspace");
  }

  if (fs.existsSync(destAbsPath)) {
    throw new Error(`Already exists at destination: ${baseName}`);
  }

  // Prevent moving a directory into itself
  if (
    fs.statSync(sourceAbsPath).isDirectory() &&
    destAbsPath.startsWith(sourceAbsPath + path.sep)
  ) {
    throw new Error("Cannot move directory into itself");
  }

  // Move the file or directory
  // fs.renameSync fails with EPERM/EXDEV on Windows when crossing certain path boundaries
  // (junctions, different volumes, etc). Fall back to recursive copy + delete in that case.
  try {
    fs.renameSync(sourceAbsPath, destAbsPath);
  } catch (renameErr: any) {
    if (renameErr.code === "EPERM" || renameErr.code === "EXDEV") {
      // Copy recursively then remove source
      fs.cpSync(sourceAbsPath, destAbsPath, { recursive: true });
      fs.rmSync(sourceAbsPath, { recursive: true, force: true });
    } else {
      throw renameErr;
    }
  }

  const movedStat = fs.statSync(destAbsPath);
  const newRelativePath =
    destParentRelativePath === "." || !destParentRelativePath
      ? baseName
      : `${destParentRelativePath}/${baseName}`;

  return {
    name: baseName,
    path: newRelativePath.split(path.sep).join("/"),
    type: movedStat.isDirectory() ? "directory" : "file",
    size: movedStat.isFile() ? movedStat.size : undefined,
    modified: movedStat.mtime.toISOString(),
  };
}