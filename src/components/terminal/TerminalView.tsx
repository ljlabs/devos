/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TerminalView — iTerm2-style multi-tab terminal workspace (desktop only).
 *
 *  - A tab bar owns one independent pane layout per tab.
 *  - Each tab's layout is a tree of terminal panes and resizable splits
 *    (see utils/terminalLayout). Drag the dividers to resize; split or close
 *    panes from each pane's title bar.
 *  - All PTY sessions share one WebSocket via useTerminalSocket.
 */

import React, { useState, useCallback, useMemo } from "react";
import { Plus, X } from "lucide-react";
import ResizableSplit from "./ResizableSplit";
import TerminalPane from "./TerminalPane";
import { useTerminalSocket } from "../../hooks/useTerminalSocket";
import {
  makeInitialLayout,
  splitLeaf,
  removeLeaf,
  resizeLeaf,
  collectLeaves,
  type SplitDirection,
  type TerminalLayoutNode,
} from "../../utils/terminalLayout";

interface TerminalTab {
  id: string;
  title: string;
  layout: TerminalLayoutNode;
}

let tabCounter = 0;
function newTabTitle(): string {
  tabCounter += 1;
  return `Terminal ${tabCounter}`;
}

function makeTab(cwd?: string): TerminalTab {
  return {
    id: `tab-${Date.now().toString(36)}-${tabCounter + 1}`,
    title: newTabTitle(),
    layout: makeInitialLayout(cwd),
  };
}

interface TerminalViewProps {
  cwd?: string;
  onClose?: () => void;
}

export default function TerminalView({ cwd, onClose }: TerminalViewProps) {
  const socket = useTerminalSocket();
  const [tabs, setTabs] = useState<TerminalTab[]>(() => [makeTab(cwd)]);
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? tabs[0],
    [tabs, activeTabId]
  );

  const updateActiveTab = useCallback(
    (layout: TerminalLayoutNode) => {
      setTabs((prev) => prev.map((t) => (t.id === activeTabId ? { ...t, layout } : t)));
    },
    [activeTabId]
  );

  const handleSplitPane = useCallback(
    (leafId: string, direction: SplitDirection) => {
      updateActiveTab(splitLeaf(activeTab.layout, leafId, direction, cwd));
    },
    [activeTab, updateActiveTab, cwd]
  );

  const handleClosePane = useCallback(
    (leafId: string) => {
      const next = removeLeaf(activeTab.layout, leafId);
      if (next === null) {
        handleCloseTab(activeTab.id);
      } else {
        updateActiveTab(next);
      }
    },
    [activeTab, updateActiveTab]
  );

  const handleResizePane = useCallback(
    (leafId: string, delta: number) => {
      updateActiveTab(resizeLeaf(activeTab.layout, leafId, delta));
    },
    [activeTab, updateActiveTab]
  );

  const handleNewTab = useCallback(() => {
    const tab = makeTab(cwd);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, [cwd]);

  const handleCloseTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === tabId);
        if (idx === -1) return prev;
        const leaves = collectLeaves(prev[idx].layout);
        leaves.forEach((leaf) => socket.closeTerminal(leaf.sessionId));
        const next = prev.filter((t) => t.id !== tabId);
        if (tabId === activeTabId) {
          const fallback = next[Math.max(0, idx - 1)];
          if (fallback) {
            setActiveTabId(fallback.id);
          } else {
            // Always keep at least one terminal open.
            const fresh = makeTab(cwd);
            setActiveTabId(fresh.id);
            return [fresh];
          }
        }
        return next;
      });
    },
    [activeTabId, socket, cwd]
  );

  const renderNode = useCallback(
    (node: TerminalLayoutNode): React.ReactNode => {
      if (node.type === "terminal") {
        return (
          <TerminalPane
            sessionId={node.sessionId}
            cwd={node.cwd}
            socket={socket}
            onSplit={(direction) => handleSplitPane(node.id, direction)}
            onClose={() => handleClosePane(node.id)}
          />
        );
      }
      return (
        <ResizableSplit
          direction={node.direction}
          sizes={node.sizes}
          onResize={(delta) => handleResizePane(collectLeaves(node.children[0])[0].id, delta)}
          first={renderNode(node.children[0])}
          second={renderNode(node.children[1])}
        />
      );
    },
    [socket, handleSplitPane, handleClosePane, handleResizePane]
  );

  return (
    <div className="flex flex-col w-full h-full bg-[#0B0B0C] border-l border-white/5">
      {/* Tab bar */}
      <div className="flex items-center h-10 bg-[#0E0E11] border-b border-white/5 px-2 gap-1">
        <div className="flex items-center overflow-x-auto flex-1 min-w-0">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                className={`group flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer border ${
                  isActive
                    ? "bg-emerald-400/10 border-emerald-500/20 text-emerald-400"
                    : "border-transparent text-slate-400 hover:text-white hover:bg-white/5"
                }`}
                onClick={() => setActiveTabId(tab.id)}
              >
                <span>{tab.title}</span>
                {tabs.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCloseTab(tab.id);
                    }}
                    className="p-0.5 rounded hover:bg-white/10 text-slate-500 hover:text-red-400"
                    title="Close tab"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <button
          onClick={handleNewTab}
          className="p-1.5 rounded-md hover:bg-white/5 text-slate-400 hover:text-white transition-colors shrink-0"
          title="New terminal tab"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Active tab content */}
      <div className="flex-1 min-h-0 min-w-0">{activeTab && renderNode(activeTab.layout)}</div>
    </div>
  );
}
