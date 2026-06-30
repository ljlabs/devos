/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface GitStatus {
  branch: string;
  status: string;
  ahead: number;
  behind: number;
  dirty: boolean;
}

export interface GitBranch {
  name: string;
  current: boolean;
}

export interface GitStash {
  id: string;
  description: string;
}

/**
 * Get current branch name
 */
export async function getCurrentBranch(workspacePath: string): Promise<string> {
  try {
    const { stdout } = await execAsync("git rev-parse --abbrev-ref HEAD", {
      cwd: workspacePath,
    });
    return stdout.trim();
  } catch (e) {
    throw new Error("Not a git repository or git not available");
  }
}

/**
 * Get git status output
 */
export async function getGitStatus(workspacePath: string): Promise<string> {
  try {
    const { stdout } = await execAsync("git status --porcelain", {
      cwd: workspacePath,
    });
    return stdout;
  } catch (e) {
    throw new Error("Failed to get git status");
  }
}

/**
 * Get all branches
 */
export async function listBranches(workspacePath: string): Promise<GitBranch[]> {
  try {
    const { stdout } = await execAsync(
      'git branch --format="%(refname:short)|%(if)%(HEAD)%(then)*%(end)"',
      { cwd: workspacePath }
    );
    return stdout
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        const [name, marker] = line.split("|");
        return {
          name: name.trim(),
          current: marker === "*",
        };
      });
  } catch (e) {
    throw new Error("Failed to list branches");
  }
}

/**
 * Switch to a different branch
 */
export async function switchBranch(
  workspacePath: string,
  branchName: string
): Promise<void> {
  try {
    await execAsync(`git checkout "${branchName}"`, {
      cwd: workspacePath,
    });
  } catch (e) {
    throw new Error(`Failed to switch to branch: ${branchName}`);
  }
}

/**
 * Stash changes
 */
export async function stashChanges(
  workspacePath: string,
  message?: string
): Promise<string> {
  try {
    const cmd = message
      ? `git stash push -m "${message}"`
      : "git stash";
    const { stdout } = await execAsync(cmd, { cwd: workspacePath });
    return stdout.trim();
  } catch (e) {
    throw new Error("Failed to stash changes");
  }
}

/**
 * List stashed changes
 */
export async function listStashes(workspacePath: string): Promise<GitStash[]> {
  try {
    const { stdout } = await execAsync('git stash list --format="%(refname)|%(subject)"', {
      cwd: workspacePath,
    });
    return stdout
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        const parts = line.split("|");
        const id = parts[0].trim(); // refs/stash@{0}
        const description = parts[1] ? parts[1].trim() : "No description";
        return { id, description };
      });
  } catch (e) {
    throw new Error("Failed to list stashes");
  }
}

/**
 * Apply a stash
 */
export async function applyStash(
  workspacePath: string,
  stashId: string
): Promise<string> {
  try {
    const { stdout } = await execAsync(`git stash apply "${stashId}"`, {
      cwd: workspacePath,
    });
    return stdout.trim();
  } catch (e) {
    throw new Error(`Failed to apply stash: ${stashId}`);
  }
}

/**
 * Pop a stash (apply and remove)
 */
export async function popStash(
  workspacePath: string,
  stashId: string
): Promise<string> {
  try {
    const { stdout } = await execAsync(`git stash pop "${stashId}"`, {
      cwd: workspacePath,
    });
    return stdout.trim();
  } catch (e) {
    throw new Error(`Failed to pop stash: ${stashId}`);
  }
}

/**
 * Drop a stash
 */
export async function dropStash(
  workspacePath: string,
  stashId: string
): Promise<string> {
  try {
    const { stdout } = await execAsync(`git stash drop "${stashId}"`, {
      cwd: workspacePath,
    });
    return stdout.trim();
  } catch (e) {
    throw new Error(`Failed to drop stash: ${stashId}`);
  }
}

/**
 * Get comprehensive git status
 */
export async function getGitInfo(workspacePath: string): Promise<GitStatus> {
  try {
    const branch = await getCurrentBranch(workspacePath);
    const status = await getGitStatus(workspacePath);

    // Check for ahead/behind
    let ahead = 0;
    let behind = 0;
    try {
      const { stdout } = await execAsync(
        "git rev-list --left-right --count @{upstream}...HEAD",
        { cwd: workspacePath }
      );
      const [behindStr, aheadStr] = stdout.trim().split("\t");
      behind = parseInt(behindStr, 10) || 0;
      ahead = parseInt(aheadStr, 10) || 0;
    } catch {
      // No upstream tracking
    }

    return {
      branch,
      status,
      ahead,
      behind,
      dirty: status.length > 0,
    };
  } catch (e) {
    throw new Error("Failed to get git info");
  }
}
