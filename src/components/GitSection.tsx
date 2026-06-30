/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { GitBranch, AlertCircle, ChevronDown, Plus, Trash2, Copy } from "lucide-react";

interface GitInfo {
  branch: string;
  status: string;
  ahead: number;
  behind: number;
  dirty: boolean;
}

interface GitBranchItem {
  name: string;
  current: boolean;
}

interface GitStash {
  id: string;
  description: string;
}

interface GitSectionProps {
  workspacePath: string;
  workspaceId: string;
  onError?: (message: string) => void;
}

export function GitSection({ workspacePath, workspaceId, onError }: GitSectionProps) {
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [branches, setBranches] = useState<GitBranchItem[]>([]);
  const [stashes, setStashes] = useState<GitStash[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState({
    branches: true,
    stashes: false,
  });
  const [stashMessage, setStashMessage] = useState("");
  const [showStashInput, setShowStashInput] = useState(false);

  const loadGitInfo = async () => {
    setLoading(true);
    setError(null);
    try {
      const [infoRes, branchesRes, stashesRes] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/git/info`),
        fetch(`/api/workspaces/${workspaceId}/git/branches`),
        fetch(`/api/workspaces/${workspaceId}/git/stashes`),
      ]);

      if (!infoRes.ok || !branchesRes.ok || !stashesRes.ok) {
        throw new Error("Failed to load Git information");
      }

      const info = await infoRes.json();
      const branchesData = await branchesRes.json();
      const stashesData = await stashesRes.json();

      setGitInfo(info);
      setBranches(branchesData);
      setStashes(stashesData);
    } catch (e: any) {
      const message = e.message || "Failed to load Git information";
      setError(message);
      onError?.(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGitInfo();
  }, [workspacePath, workspaceId]);

  const handleSwitchBranch = async (branchName: string) => {
    try {
      setLoading(true);
      const res = await fetch(`/api/workspaces/${workspaceId}/git/switch-branch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchName }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to switch branch");
      }

      await loadGitInfo();
    } catch (e: any) {
      const message = e.message || "Failed to switch branch";
      setError(message);
      onError?.(message);
    } finally {
      setLoading(false);
    }
  };

  const handleStash = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/workspaces/${workspaceId}/git/stash`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: stashMessage || undefined }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to stash changes");
      }

      setStashMessage("");
      setShowStashInput(false);
      await loadGitInfo();
    } catch (e: any) {
      const message = e.message || "Failed to stash changes";
      setError(message);
      onError?.(message);
    } finally {
      setLoading(false);
    }
  };

  const handleApplyStash = async (stashId: string) => {
    try {
      setLoading(true);
      const res = await fetch(`/api/workspaces/${workspaceId}/git/stash/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stashId }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to apply stash");
      }

      await loadGitInfo();
    } catch (e: any) {
      const message = e.message || "Failed to apply stash";
      setError(message);
      onError?.(message);
    } finally {
      setLoading(false);
    }
  };

  const handlePopStash = async (stashId: string) => {
    try {
      setLoading(true);
      const res = await fetch(`/api/workspaces/${workspaceId}/git/stash/pop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stashId }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to pop stash");
      }

      await loadGitInfo();
    } catch (e: any) {
      const message = e.message || "Failed to pop stash";
      setError(message);
      onError?.(message);
    } finally {
      setLoading(false);
    }
  };

  const handleDropStash = async (stashId: string) => {
    try {
      setLoading(true);
      const res = await fetch(`/api/workspaces/${workspaceId}/git/stash/${stashId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to drop stash");
      }

      await loadGitInfo();
    } catch (e: any) {
      const message = e.message || "Failed to drop stash";
      setError(message);
      onError?.(message);
    } finally {
      setLoading(false);
    }
  };

  if (error && gitInfo === null) {
    return (
      <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2.5">
        <div className="flex items-start gap-2">
          <AlertCircle size={14} className="text-rose-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs text-rose-300 font-sans font-semibold">Not a Git Repository</p>
            <p className="text-xs text-rose-300/70 font-sans mt-0.5">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!gitInfo) {
    return (
      <div className="flex items-center justify-center py-4">
        <div className="text-xs text-slate-500 font-sans">Loading Git info…</div>
      </div>
    );
  }

  return (
    <div className="space-y-3 pt-2">
      {/* Current Branch Status */}
      <div>
        <label className="block text-[9px] sm:text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest mb-1.5">
          Current Branch
        </label>
        <div className="bg-[#18181B] border border-white/10 rounded-lg px-3 py-2.5 flex items-center gap-2">
          <GitBranch size={13} className="text-emerald-400 flex-shrink-0" />
          <span className="text-xs font-mono text-slate-200 font-semibold">{gitInfo.branch}</span>
          {gitInfo.dirty && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-orange-500/20 border border-orange-500/30 text-orange-300 font-mono ml-auto">
              Dirty
            </span>
          )}
          {(gitInfo.ahead > 0 || gitInfo.behind > 0) && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 font-mono">
              {gitInfo.ahead > 0 && `+${gitInfo.ahead}`} {gitInfo.behind > 0 && `-${gitInfo.behind}`}
            </span>
          )}
        </div>
      </div>

      {/* Git Status */}
      {gitInfo.status && (
        <div>
          <label className="block text-[9px] sm:text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest mb-1.5">
            Status
          </label>
          <div className="bg-[#18181B] border border-white/10 rounded-lg px-3 py-2.5 max-h-32 overflow-y-auto custom-scrollbar">
            <div className="space-y-1">
              {gitInfo.status
                .split("\n")
                .filter((line) => line.length > 0)
                .slice(0, 10)
                .map((line, i) => (
                  <div key={i} className="text-[10px] font-mono text-slate-400 break-all">
                    {line}
                  </div>
                ))}
              {gitInfo.status.split("\n").filter((line) => line.length > 0).length > 10 && (
                <div className="text-[9px] text-slate-500 italic">
                  +{gitInfo.status.split("\n").filter((line) => line.length > 0).length - 10} more
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Branches Section */}
      <div className="border-t border-white/5 pt-3">
        <button
          onClick={() =>
            setExpandedSections((prev) => ({
              ...prev,
              branches: !prev.branches,
            }))
          }
          className="flex items-center gap-2 text-xs font-semibold text-slate-300 hover:text-slate-200 transition-colors w-full"
        >
          <ChevronDown
            size={13}
            className={`flex-shrink-0 transition-transform ${
              expandedSections.branches ? "rotate-0" : "-rotate-90"
            }`}
          />
          <span>Branches ({branches.length})</span>
        </button>

        {expandedSections.branches && (
          <div className="mt-2 space-y-1.5">
            {branches.length === 0 ? (
              <div className="text-xs text-slate-500 italic py-2">No branches found</div>
            ) : (
              branches.map((branch) => (
                <button
                  key={branch.name}
                  onClick={() => !branch.current && handleSwitchBranch(branch.name)}
                  disabled={branch.current || loading}
                  className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs font-mono transition-colors ${
                    branch.current
                      ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 cursor-default"
                      : "bg-slate-500/10 border border-slate-500/20 text-slate-300 hover:bg-slate-500/15 cursor-pointer disabled:opacity-50"
                  }`}
                >
                  <span className={branch.current ? "font-semibold" : ""}>
                    {branch.current ? "✓ " : ""}
                    {branch.name}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Stash Section */}
      <div className="border-t border-white/5 pt-3">
        <button
          onClick={() =>
            setExpandedSections((prev) => ({
              ...prev,
              stashes: !prev.stashes,
            }))
          }
          className="flex items-center gap-2 text-xs font-semibold text-slate-300 hover:text-slate-200 transition-colors w-full"
        >
          <ChevronDown
            size={13}
            className={`flex-shrink-0 transition-transform ${
              expandedSections.stashes ? "rotate-0" : "-rotate-90"
            }`}
          />
          <span>Stash ({stashes.length})</span>
        </button>

        {expandedSections.stashes && (
          <div className="mt-2 space-y-2">
            {/* Stash Input */}
            {showStashInput ? (
              <div className="space-y-1.5">
                <input
                  type="text"
                  value={stashMessage}
                  onChange={(e) => setStashMessage(e.target.value)}
                  placeholder="Optional message"
                  className="w-full bg-[#18181B] border border-emerald-500/50 rounded-md px-2 py-1.5 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-400 transition-colors"
                />
                <div className="flex gap-1.5">
                  <button
                    onClick={handleStash}
                    disabled={loading}
                    className="flex-1 px-2.5 py-1 text-[11px] font-semibold rounded-md bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30 cursor-pointer transition-colors disabled:opacity-50"
                  >
                    Stash
                  </button>
                  <button
                    onClick={() => {
                      setShowStashInput(false);
                      setStashMessage("");
                    }}
                    className="flex-1 px-2.5 py-1 text-[11px] font-semibold rounded-md border border-white/10 text-slate-400 hover:text-white cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowStashInput(true)}
                disabled={loading || !gitInfo.dirty}
                className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md bg-slate-500/10 border border-slate-500/20 text-slate-300 text-xs font-semibold hover:bg-slate-500/15 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus size={12} />
                New Stash
              </button>
            )}

            {/* Stash List */}
            <div className="space-y-1">
              {stashes.length === 0 ? (
                <div className="text-xs text-slate-500 italic py-2">No stashes</div>
              ) : (
                stashes.map((stash) => (
                  <div
                    key={stash.id}
                    className="bg-[#18181B] border border-white/5 rounded-md px-2 py-1.5 group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-mono text-slate-400 break-all">
                          {stash.id}
                        </div>
                        <div className="text-[9px] text-slate-500 mt-0.5">{stash.description}</div>
                      </div>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          onClick={() => handleApplyStash(stash.id)}
                          disabled={loading}
                          className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-white/5 cursor-pointer transition-colors text-[10px] font-semibold disabled:opacity-50"
                          title="Apply without removing"
                        >
                          <Copy size={11} />
                        </button>
                        <button
                          onClick={() => handlePopStash(stash.id)}
                          disabled={loading}
                          className="p-1 rounded text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10 cursor-pointer transition-colors text-[10px] font-semibold disabled:opacity-50"
                          title="Apply and remove"
                        >
                          Pop
                        </button>
                        <button
                          onClick={() => handleDropStash(stash.id)}
                          disabled={loading}
                          className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer transition-colors disabled:opacity-50"
                          title="Delete stash"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
