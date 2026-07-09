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
  resizeSplit,
  moveLeaf,
  collectLeaves,
  updateLeaf,
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
}

// ── Session-storage persistence ───────────────────────────────────────────
// We persist the tabs layout (JSON-serialisable tree of node IDs and cwds)
// across page refreshes so that pane/tab structure survives, and the stored
// session IDs are reused — meaning the server's still-running PTYs re-attach
// on the next terminal_create instead of spawning fresh shells.

const STORAGE_KEY = "devos:terminal-layout";

interface PersistedState {
  tabs: Array<{ id: string; title: string; layout: TerminalLayoutNode }>;
  activeTabId: string;
  tabCounter: number;
}

function loadPersistedState(): PersistedState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as PersistedState;
    if (!Array.isArray(data.tabs) || !data.activeTabId) return null;
    return data;
  } catch {
    return null;
  }
}

function saveState(tabs: TerminalTab[], activeTabId: string): void {
  try {
    const data: PersistedState = {
      tabs: tabs.map((t) => ({ id: t.id, title: t.title, layout: t.layout })),
      activeTabId,
      tabCounter,
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* storage quota exceeded or SSR — ignore */
  }
}

export default function TerminalView({ cwd }: TerminalViewProps) {
  const socket = useTerminalSocket();

  // Restore persisted tabs/layout from sessionStorage if available, otherwise
  // start fresh. Reusing the same session IDs means the server's PTYs (which
  // survive a client disconnect) are re-attached, not re-spawned.
  const persistedRef = useRef(loadPersistedState());
  const [tabs, setTabs] = useState<TerminalTab[]>(() => {
    const saved = persistedRef.current;
    if (saved) {
      tabCounter = saved.tabCounter;
      return saved.tabs;
    }
    return [makeTab(cwd)];
  });
  const [activeTabId, setActiveTabId] = useState<string>(() => {
    const saved = persistedRef.current;
    if (saved) return saved.activeTabId;
    return tabs[0].id;
  });
  const [focusedLeafId, setFocusedLeafId] = useState<string | null>(null);
  const draggedLeafIdRef = useRef<string | null>(null);

  // Managed terminals: Terminal instance + subscribe cleanup, keyed by sessionId.
  const terminalsRef = useRef<Map<string, ManagedTerminal>>(new Map());
  // Set of sessionIds that have already been created — prevents double-create
  // when the same layout object is processed by both the handler and the teardown effect.
  const knownSessionsRef = useRef<Set<string>>(new Set());

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? tabs[0],
    [tabs, activeTabId]
  );

  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  // ── Create a terminal if not already managed ───────────────────────
  const ensureTerminal = useCallback(
    (leaf: TerminalPaneNode) => {
      if (terminalsRef.current.has(leaf.sessionId)) return;

      const term = new Terminal(TERMINAL_THEME);
      // Forward user keystrokes to the PTY via the WebSocket
      term.onData((data: string) => socket.write(leaf.sessionId, data));
      const unsubscribe = socket.subscribe(
        leaf.sessionId,
        (output: string) => term.write(output),
        (exitCode: number) => {
          // PTY exited
        }
      );
      // Track live CWD changes from the backend. The setTabs call below
      // updates the layout node's cwd (persisting across refreshes) and
      // re-renders, so the title bar reflects the new directory.
      const unsubCwd = socket.onCwd(leaf.sessionId, (newCwd: string) => {
        setTabs((prev) =>
          prev.map((t) => ({
            ...t,
            layout: updateLeaf(t.layout, leaf.id, { cwd: newCwd }),
          }))
        );
      });
      terminalsRef.current.set(leaf.sessionId, { term, unsubscribe: () => { unsubscribe(); unsubCwd(); } });
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
  // 2. Tear down terminals that are no longer in ANY tab's layout.
  useEffect(() => {
    const allLeaves = tabs.flatMap((t) => collectLeaves(t.layout));
    const currentIds = new Set(allLeaves.map((l) => l.sessionId));

    // Tear down terminals removed from all tabs.
    for (const id of knownSessionsRef.current) {
      if (!currentIds.has(id)) {
        teardownTerminal(id);
      }
    }

    // Create terminals for leaves not yet managed (covers initial mount
    // and the rare case where the layout is replaced entirely).
    allLeaves.forEach(ensureTerminal);
    knownSessionsRef.current = currentIds;
  }, [tabs, teardownTerminal, ensureTerminal]);

  // ── History replay on reconnect ──────────────────────────────────
  // Subscribe each terminal to history replay so reconnects restore the buffer.
  useEffect(() => {
    const allLeaves = tabs.flatMap((t) => collectLeaves(t.layout));
    const unsubscribers: (() => void)[] = [];

    for (const leaf of allLeaves) {
      const managed = terminalsRef.current.get(leaf.sessionId);
      if (managed) {
        const unsubscribe = socket.onHistory(leaf.sessionId, (history: string[]) => {
          for (const chunk of history) {
            managed.term.write(chunk);
          }
        });
        unsubscribers.push(unsubscribe);
      }
    }

    return () => {
      for (const unsub of unsubscribers) unsub();
    };
  }, [tabs, socket]);

  // ── Persist layout to sessionStorage ─────────────────────────────
  useEffect(() => {
    saveState(tabs, activeTabId);
  }, [tabs, activeTabId]);

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
      const newLayout = splitLeaf(activeTab.layout, leafId, direction, cwd);
      // Pre-create terminals for ALL new leaves (the split created one).
      collectLeaves(newLayout).forEach(ensureTerminal);
      updateActiveTab(newLayout);
      setFocusedLeafId((prev) => prev ?? leafId);
    },
    [activeTab, updateActiveTab, cwd, focusedLeafId, ensureTerminal]
  );

  const handleFocusLeaf = useCallback((leafId: string) => {
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
    (splitId: string, delta: number) => {
      updateActiveTab(resizeSplit(activeTab.layout, splitId, delta));
    },
    [activeTab, updateActiveTab]
  );

  const handleMoveLeaf = useCallback(
    (fromId: string, toId: string, direction: SplitDirection) => {
      if (fromId === toId) return;
      const newLayout = moveLeaf(activeTab.layout, fromId, toId, direction, cwd);
      collectLeaves(newLayout).forEach(ensureTerminal);
      updateActiveTab(newLayout);
    },
    [activeTab, updateActiveTab, cwd, ensureTerminal]
  );

  const handleRename = useCallback(
    (leafId: string, name: string | null) => {
      setTabs((prev) =>
        prev.map((t) => ({
          ...t,
          layout: updateLeaf(t.layout, leafId, { displayName: name ?? undefined }),
        }))
      );
    },
    []
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
    [cwd]
  );

  // Teardown terminals when a tab is closed (via effect, not in setState callback)
  useEffect(() => {
    // Identify which tabs still exist
    const currentTabIds = new Set(tabs.map((t) => t.id));

    // Teardown terminals from closed tabs
    for (const tabId of Array.from(currentTabIds)) {
      const tab = tabs.find((t) => t.id === tabId);
      if (tab) {
        const leaves = collectLeaves(tab.layout);
        // This effect runs after setTabs, so any leaves NOT in current tabs
        // will be cleaned up by the main lifecycle effect below.
      }
    }
  }, [tabs]);

  // Node ID → session ID mapping for stable handler identity
  const nodeSessionMapRef = useRef<Map<string, string>>(new Map());

  // Stable wrapper for onResize that routes to the correct node
  // This function's identity doesn't change across renders
  const stableOnResize = useCallback((nodeId: string, cols: number, rows: number) => {
    const sessionId = nodeSessionMapRef.current.get(nodeId);
    if (sessionId) socket.resize(sessionId, cols, rows);
  }, [socket]);

  // Stable wrapper for onSplit
  const stableOnSplit = useCallback((nodeId: string, direction: SplitDirection) => {
    handleSplitPane(nodeId, direction);
  }, [handleSplitPane]);

  // Stable wrapper for onClose
  const stableOnClose = useCallback((nodeId: string) => {
    handleClosePane(nodeId);
  }, [handleClosePane]);

  // Stable wrapper for onFocus
  const stableOnFocus = useCallback((nodeId: string) => {
    handleFocusLeaf(nodeId);
  }, [handleFocusLeaf]);

  // Per-node onResize handlers, cached to maintain referential equality
  const nodeOnResizeHandlersRef = useRef<Map<string, (cols: number, rows: number) => void>>(new Map());
  
  const getNodeOnResize = useCallback((nodeId: string): ((cols: number, rows: number) => void) => {
    let handler = nodeOnResizeHandlersRef.current.get(nodeId);
    if (!handler) {
      handler = (cols: number, rows: number) => stableOnResize(nodeId, cols, rows);
      nodeOnResizeHandlersRef.current.set(nodeId, handler);
    }
    return handler;
  }, [stableOnResize]);

  // ── Render ────────────────────────────────────────────────────────
  const renderNode = useCallback(
    (node: TerminalLayoutNode): React.ReactNode => {
      if (node.type === "terminal") {
        const managed = terminalsRef.current.get(node.sessionId);
        if (!managed) return null;
        // Update the mapping for this node's sessionId (used by stable handlers)
        nodeSessionMapRef.current.set(node.id, node.sessionId);
        return (
          <TerminalPane
            key={node.id}
            terminal={managed.term}
            cwd={node.cwd}
            displayName={node.displayName}
            onRename={(name) => handleRename(node.id, name)}
            onResize={getNodeOnResize(node.id)}
            onSplit={(direction) => stableOnSplit(node.id, direction)}
            onClose={() => stableOnClose(node.id)}
            onFocus={() => stableOnFocus(node.id)}
            onDragStart={() => { draggedLeafIdRef.current = node.id; }}
            onDrop={() => {
              if (draggedLeafIdRef.current) handleMoveLeaf(draggedLeafIdRef.current, node.id, "horizontal");
              draggedLeafIdRef.current = null;
            }}
          />
        );
      }
      return (
        <ResizableSplit
          key={node.id}
          direction={node.direction}
          sizes={node.sizes}
          onResize={(delta) => handleResizePane(node.id, delta)}
          first={renderNode(node.children[0])}
          second={renderNode(node.children[1])}
        />
      );
    },
    [getNodeOnResize, stableOnSplit, stableOnClose, stableOnFocus, handleResizePane, handleMoveLeaf]
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
