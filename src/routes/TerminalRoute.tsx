/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TerminalRoute — desktop-only route that mounts the multi-tab terminal
 * workspace. Resolves the active workspace path to seed the initial PTY CWD.
 */

import { useState, useEffect } from "react";
import { Workspace } from "../types";
import TerminalView from "../components/terminal/TerminalView";

export default function TerminalRoute() {
  const [cwd, setCwd] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/workspaces")
      .then((res) => res.json())
      .then((workspaces: Workspace[]) => {
        if (workspaces.length > 0) setCwd(workspaces[0].path);
      })
      .catch((e) => setError(String(e)));
  }, []);

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
        Failed to load terminal.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <TerminalView cwd={cwd} />
    </div>
  );
}
