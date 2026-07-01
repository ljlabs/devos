/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TerminalPanel — xtermjs terminal wrapper
 * Shared between mobile and desktop IDE views.
 */

import React from "react";
import TerminalDisplay from "../TerminalDisplay";

interface TerminalPanelProps {
  workspaceId?: string;
  threadTitle?: string;
  threadLogs?: any[];
}

export default function TerminalPanel({
  workspaceId,
  threadTitle,
  threadLogs,
}: TerminalPanelProps) {
  return (
    <TerminalDisplay
      logs={threadLogs}
      threadTitle={threadTitle}
      onClose={() => {}}
    />
  );
}
