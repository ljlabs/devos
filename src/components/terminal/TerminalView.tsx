/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TerminalView — iTerm2-style multi-tab terminal workspace (desktop only).
 *
 * PTY session and xterm Terminal lifecycle lives HERE, not in TerminalPane.
 * Terminals are created synchronously in split/remove handlers BEFORE the
 * layout state update, so by the time React renders the new tree, the
 * Terminal instance is already in terminalsRef. This avoids the render→effect
 * two-phase problem where new panes would show as null.
 *
 * The layout diff effect only handles teardown of removed terminals.
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Plus, X, SplitSquareHorizontal, SplitSquareVertical } from "lucide-react";
import ResizableSplit from "./ResizableSplit";
import TerminalPane from "./TerminalPane";
import { useTerminalSocket } from "../../hooks/useTerminalSocket";
import {
  makeInitialLayout,
  splitLeaf,
  removeLeaf,
  resizeLeaf,
  moveLeaf,
  collectLeaves,
  type SplitDirection,
  type TerminalLayoutNode,
  type TerminalPaneNode,
} from "../../utils/terminalLayout";

const TERMINAL_THEME = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Code", monospace',
  fontSize: 13,
  cursorBlink: true,
  theme: {
    background: "#0B0B0C",
    foreground: "#E4E4E7",
    cursor: "#10B981",
    selectionBackground: "#10B98144",
    black: "#0B0B0C",
    brightBlack: "#52525B",
  },
  allowProposedApi: true as const,
};

interface TerminalTab {
  id: string;
  title: string;
  layout: TerminalLayoutNode;
}

interface ManagedTerminal {
  term: Terminal;
  unsubscribe: () => void;
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
  const [focusedLeafId, setFocusedLeafId] = useState<string | null>(null);
  const [draggedLeafId, setDraggedLeafId] = useState<string | null>(null);

  // Managed terminals: Terminal instance + subscribe cleanup, keyed by sessionId.
  const terminalsRef = useRef<Map<string, ManagedTerminal>>(new Map());
  // Set of sessionIds that have already been created — prevents double-create
  // when the same layout object is processed by both the handler and the teardown effect.
  const knownSessionsRef = useRef<Set<string>>(new Set());
  // Bump this to force a re-render after synchronous terminal creation.
  const [, setTerminalVersion] = useState(0);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? tabs[0],
    [tabs, activeTabId]
  );

  // Ensure the initial leaf has a terminal on first render.
  const initialLeaves = collectLeaves(activeTab.layout);
  for (const leaf of initialLeaves) {
    if (!terminalsRef.current.has(leaf.sessionId)) {
      const term = new Terminal(TERMINAL_THEME);
      const unsubscribe = socket.subscribe(
        leaf.sessionId,
        (output: string) => term.write(output),
        (exitCode: number) => {
          console.log(`[TerminalView] session ${leaf.sessionId} exited (code=${exitCode})`);
        }
      );
      terminalsRef.current.set(leaf.sessionId, { term, unsubscribe });
      socket.createTerminal(leaf.sessionId, leaf.cwd, 80, 24);
      knownSessionsRef.current.add(leaf.sessionId);
    }
  }

  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  // ── Create a terminal if not already managed ───────────────────────
  const ensureTerminal = useCallback(
    (leaf: TerminalPaneNode) => {
      if (terminalsRef.current.has(leaf.sessionId)) return;

      console.log(`[TerminalView] ensureTerminal: creating session ${leaf.sessionId}`);
      const term = new Terminal(TERMINAL_THEME);
      const unsubscribe = socket.subscribe(
        leaf.sessionId,
        (output: string) => term.write(output),
        (exitCode: number) => {
          console.log(`[TerminalView] session ${leaf.sessionId} exited (code=${exitCode})`);
        }
      );
      terminalsRef.current.set(leaf.sessionId, { term, unsubscribe });
      socket.createTerminal(leaf.sessionId, leaf.cwd, 80, 24);
      knownSessionsRef.current.add(leaf.sessionId);
    },
    [socket]
  );

  // ── Teardown a terminal ────────────────────────────────────────────
  const teardownTerminal = useCallback(
    (sessionId: string) => {
      const managed = terminalsRef.current.get(sessionId);
      if (!managed) return;
      console.log(`[TerminalView] teardownTerminal: closing session ${sessionId}`);
      managed.unsubscribe();
      terminalsRef.current.delete(sessionId);
      socket.closeTerminal(sessionId);
      managed.term.dispose();
    },
    [socket]
  );

  // ── Terminal lifecycle effect ─────────────────────────────────────
  // 1. Create terminals for any leaf that exists in the layout but has
  //    no managed terminal (handles both initial mount and re-creation
  //    after the same leaf id reappears).
  // 2. Tear down terminals that are no longer in the layout.
  useEffect(() => {
    const currentLeaves = collectLeaves(activeTab.layout);
    const currentIds = new Set(currentLeaves.map((l) => l.sessionId));

    // Tear down terminals removed from layout.
    for (const id of knownSessionsRef.current) {
      if (!currentIds.has(id)) {
        teardownTerminal(id);
      }
    }

    // Create terminals for leaves not yet managed (covers initial mount
    // and the rare case where the layout is replaced entirely).
    currentLeaves.forEach(ensureTerminal);
    knownSessionsRef.current = currentIds;
  }, [activeTab.layout, teardownTerminal, ensureTerminal]);

  // ── Focus tracking ────────────────────────────────────────────────
  useEffect(() => {
    const leaves = collectLeaves(activeTab.layout);
    setFocusedLeafId((prev) => {
      if (prev && leaves.some((l) => l.id === prev)) return prev;
      return leaves[0]?.id ?? null;
    });
  }, [activeTab]);

  // ── Tab / pane handlers ───────────────────────────────────────────
  // Every handler that CHANGES the layout: ensure terminals for new leaves
  // synchronously BEFORE calling updateActiveTab, so renderNode can access them.
  const updateActiveTab = useCallback(
    (layout: TerminalLayoutNode) => {
      setTabs((prev) => prev.map((t) => (t.id === activeTabId ? { ...t, layout } : t)));
    },
    [activeTabId]
  );

  const handleSplitPane = useCallback(
    (leafId: string, direction: SplitDirection) => {
      console.log(`[TerminalView] handleSplitPane: leafId=${leafId}, direction=${direction}, focusedLeafId=${focusedLeafId}`);
      const newLayout = splitLeaf(activeTab.layout, leafId, direction, cwd);
      // Pre-create terminals for ALL new leaves (the split created one).
      collectLeaves(newLayout).forEach(ensureTerminal);
      updateActiveTab(newLayout);
      setFocusedLeafId((prev) => prev ?? leafId);
    },
    [activeTab, updateActiveTab, cwd, focusedLeafId, ensureTerminal]
  );

  const handleFocusLeaf = useCallback((leafId: string) => {
    console.log(`[TerminalView] handleFocusLeaf: leafId=${leafId}`);
    setFocusedLeafId(leafId);
  }, []);

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

  const handleMoveLeaf = useCallback(
    (fromId: string, toId: string, direction: SplitDirection) => {
      if (fromId === toId) return;
      console.log(`[TerminalView] handleMoveLeaf: from=${fromId}, to=${toId}, dir=${direction}`);
      const newLayout = moveLeaf(activeTab.layout, fromId, toId, direction, cwd);
      collectLeaves(newLayout).forEach(ensureTerminal);
      updateActiveTab(newLayout);
    },
    [activeTab, updateActiveTab, cwd, ensureTerminal]
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
        for (const leaf of leaves) {
          teardownTerminal(leaf.sessionId);
        }
        const next = prev.filter((t) => t.id !== tabId);
        if (tabId === activeTabIdRef.current) {
          const fallback = next[Math.max(0, idx - 1)];
          if (fallback) {
            setActiveTabId(fallback.id);
          } else {
            const fresh = makeTab(cwd);
            setActiveTabId(fresh.id);
            return [fresh];
          }
        }
        return next;
      });
    },
    [teardownTerminal, cwd]
  );

  // ── Render ────────────────────────────────────────────────────────
  const renderNode = useCallback(
    (node: TerminalLayoutNode): React.ReactNode => {
      if (node.type === "terminal") {
        const managed = terminalsRef.current.get(node.sessionId);
        if (!managed) return null;
        return (
          <TerminalPane
            key={node.id}
            terminal={managed.term}
            cwd={node.cwd}
            onResize={(cols, rows) => socket.resize(node.sessionId, cols, rows)}
            onSplit={(direction) => handleSplitPane(node.id, direction)}
            onClose={() => handleClosePane(node.id)}
            onFocus={() => handleFocusLeaf(node.id)}
            onDragStart={() => setDraggedLeafId(node.id)}
            onDrop={() => {
              if (draggedLeafId) handleMoveLeaf(draggedLeafId, node.id, "horizontal");
              setDraggedLeafId(null);
            }}
          />
        );
      }
      return (
        <ResizableSplit
          key={node.id}
          direction={node.direction}
          sizes={node.sizes}
          onResize={(delta) => handleResizePane(collectLeaves(node.children[0])[0].id, delta)}
          first={renderNode(node.children[0])}
          second={renderNode(node.children[1])}
        />
      );
    },
    [socket, handleSplitPane, handleClosePane, handleResizePane, handleFocusLeaf, handleMoveLeaf, draggedLeafId]
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
        <div className="flex items-center gap-0.5 pr-1 border-r border-white/5">
          <button
            onClick={() => {
              const target = focusedLeafId;
              console.log(`[TerminalView] Split focused pane right clicked: focusedLeafId=${target}`);
              if (target) handleSplitPane(target, "horizontal");
            }}
            disabled={!focusedLeafId}
            className="p-1.5 rounded-md hover:bg-white/5 text-slate-400 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Split focused pane right"
          >
            <SplitSquareHorizontal size={16} />
          </button>
          <button
            onClick={() => {
              const target = focusedLeafId;
              console.log(`[TerminalView] Split focused pane down clicked: focusedLeafId=${target}`);
              if (target) handleSplitPane(target, "vertical");
            }}
            disabled={!focusedLeafId}
            className="p-1.5 rounded-md hover:bg-white/5 text-slate-400 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Split focused pane down"
          >
            <SplitSquareVertical size={16} />
          </button>
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
