/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FileEditorPanel — Monaco editor with save/undo/redo logic
 * Shared between mobile and desktop IDE views.
 * Supports multiple tabs on desktop.
 */

import React, { useCallback, useRef } from "react";
import { FileText, Save, Undo2, Redo2, X, Type } from "lucide-react";
import Editor from "@monaco-editor/react";
import { FileContent } from "../../types";
import { DEVOS_THEME, getLanguageFromPath } from "./IdeConstants";
import ReadOnlyCodeDisplay from "./ReadOnlyCodeDisplay";

interface EditorTab {
  path: string;
  file: FileContent | null;
  content: string;
  isDirty: boolean;
}

interface FileEditorPanelProps {
  // Legacy single-file props (for mobile)
  activeFile?: FileContent | null;
  activeFilePath?: string;
  editorContent?: string;
  isDirty?: boolean;
  // Multi-tab props (for desktop)
  tabs?: EditorTab[];
  activeTabIndex?: number;
  onTabChange?: (index: number) => void;
  // Shared props
  isSaving: boolean;
  isLoading: boolean;
  isMobile?: boolean;
  onContentChange: (content: string) => void;
  onSave: () => Promise<void>;
  onCloseTab: (index?: number) => void;
}

export default function FileEditorPanel({
  activeFile,
  activeFilePath,
  editorContent,
  isDirty,
  tabs,
  activeTabIndex = 0,
  onTabChange,
  isSaving,
  isLoading,
  isMobile = false,
  onContentChange,
  onSave,
  onCloseTab,
}: FileEditorPanelProps) {
  const editorRef = useRef<any>(null);
  const [selectMode, setSelectMode] = React.useState(false);

  // Determine if we're in multi-tab mode
  const isMultiTab = tabs && tabs.length > 0;
  const activeTab = isMultiTab ? tabs[activeTabIndex] : null;
  const currentFile = isMultiTab ? activeTab?.file : activeFile;
  const currentPath = isMultiTab ? activeTab?.path : activeFilePath;
  const currentContent = isMultiTab ? activeTab?.content : editorContent;
  const currentIsDirty = isMultiTab ? activeTab?.isDirty ?? false : isDirty ?? false;

  const handleEditorMount = useCallback((editor: any, monaco: any) => {
    editorRef.current = editor;
    monaco.editor.defineTheme("devos-dark", DEVOS_THEME);
    monaco.editor.setTheme("devos-dark");

    // Register keyboard shortcuts — let Monaco handle them natively
    editor.addAction({
      id: "devos-save",
      label: "Save",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => onSave(),
    });

    // Ctrl+Z / Cmd+Z undo
    editor.addAction({
      id: "devos-undo",
      label: "Undo",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ],
      run: () => editor.trigger("keyboard", "undo"),
    });

    // Ctrl+Shift+Z / Cmd+Shift+Z redo
    editor.addAction({
      id: "devos-redo",
      label: "Redo",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ],
      run: () => editor.trigger("keyboard", "redo"),
    });
  }, [onSave]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-600">
        <div className="w-4 h-4 border-2 border-slate-600 border-t-emerald-400 rounded-full animate-spin mr-2" />
        Loading file...
      </div>
    );
  }

  if (!currentFile) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-600 p-8">
        <span className="text-2xl">📝</span>
        <p className="text-center text-sm">
          No file selected.<br />
          <span className="text-slate-700">Open a file from the FILES tab to view its contents.</span>
        </p>
      </div>
    );
  }

  const handleCloseTab = (indexToClose: number) => {
    if (isMultiTab) {
      onCloseTab(indexToClose);
    } else {
      onCloseTab();
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center bg-[#0E0E11] h-10 border-b border-white/5 overflow-x-auto">
        {isMultiTab ? (
          // Multi-tab mode: render tab buttons
          <>
            {tabs.map((tab, index) => (
              <div
                key={tab.path}
                className={`flex items-center gap-1.5 px-3 h-full border-r border-white/5 cursor-pointer flex-shrink-0 group ${
                  index === activeTabIndex
                    ? "bg-[#1A1A1E] text-white"
                    : "text-slate-500 hover:text-slate-300 hover:bg-white/5"
                }`}
                onClick={() => onTabChange?.(index)}
              >
                <FileText size={12} className={
                  index === activeTabIndex ? "text-emerald-400" : "text-slate-600"
                } />
                <span className="text-[11px] font-mono font-medium truncate max-w-[120px]">
                  {tab.path.split("/").pop()}
                </span>
                {tab.isDirty && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCloseTab(index);
                  }}
                  className="p-0.5 text-slate-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                  title="Close"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </>
        ) : (
          // Single-file mode (mobile): show file name and close button
          <div className="flex items-center justify-between w-full px-4">
            <div className="flex items-center gap-2 min-w-0">
              <FileText size={14} className="text-emerald-400 flex-shrink-0" />
              <span className="text-[11px] font-mono font-medium text-white truncate">
                {currentPath?.split("/").pop()}
              </span>
              {currentIsDirty && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" title="Unsaved changes" />
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {isMobile && (
                <button
                  onClick={() => setSelectMode(!selectMode)}
                  className={`p-1 transition-colors ${
                    selectMode
                      ? "text-blue-400 hover:text-blue-300"
                      : "text-slate-500 hover:text-white"
                  }`}
                  title={selectMode ? "Switch to editor" : "Switch to select mode"}
                >
                  <Type size={14} />
                </button>
              )}
              <button
                onClick={() => {
                  editorRef.current?.focus();
                  setTimeout(() => editorRef.current?.trigger("keyboard", "undo"), 0);
                }}
                className="p-1 text-slate-500 hover:text-white active:text-emerald-400 transition-colors"
                title="Undo (Ctrl+Z)"
              >
                <Undo2 size={14} />
              </button>
              <button
                onClick={() => {
                  editorRef.current?.focus();
                  setTimeout(() => editorRef.current?.trigger("keyboard", "redo"), 0);
                }}
                className="p-1 text-slate-500 hover:text-white active:text-emerald-400 transition-colors"
                title="Redo (Ctrl+Shift+Z)"
              >
                <Redo2 size={14} />
              </button>
              <button
                onClick={onSave}
                disabled={!currentIsDirty || isSaving}
                className={`p-1 transition-colors ${
                  currentIsDirty
                    ? "text-emerald-400 hover:text-emerald-300 active:scale-95"
                    : "text-slate-700"
                }`}
                title="Save (Ctrl+S)"
              >
                <Save size={14} />
              </button>
              <button
                onClick={() => handleCloseTab(0)}
                className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                title="Close"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Editor actions toolbar (for multi-tab mode) */}
      {isMultiTab && (
        <div className="flex items-center justify-end gap-1 px-2 h-8 bg-[#0E0E11] border-b border-white/5">
          <button
            onClick={() => {
              editorRef.current?.focus();
              setTimeout(() => editorRef.current?.trigger("keyboard", "undo"), 0);
            }}
            className="p-1 text-slate-500 hover:text-white active:text-emerald-400 transition-colors"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 size={14} />
          </button>
          <button
            onClick={() => {
              editorRef.current?.focus();
              setTimeout(() => editorRef.current?.trigger("keyboard", "redo"), 0);
            }}
            className="p-1 text-slate-500 hover:text-white active:text-emerald-400 transition-colors"
            title="Redo (Ctrl+Shift+Z)"
          >
            <Redo2 size={14} />
          </button>
          <button
            onClick={onSave}
            disabled={!currentIsDirty || isSaving}
            className={`p-1 transition-colors ${
              currentIsDirty
                ? "text-emerald-400 hover:text-emerald-300 active:scale-95"
                : "text-slate-700"
            }`}
            title="Save (Ctrl+S)"
          >
            <Save size={14} />
          </button>
        </div>
      )}

      {/* Editor */}
      <div className="flex-1 min-h-0 w-full overflow-hidden">
        {isMobile && selectMode ? (
          <ReadOnlyCodeDisplay filePath={currentPath || ""} content={currentContent || ""} />
        ) : (
          <Editor
            height="100%"
            width="100%"
            language={getLanguageFromPath(currentPath || "")}
            value={currentContent || ""}
            theme="devos-dark"
            onChange={(value) => onContentChange(value || "")}
            onMount={handleEditorMount}
            options={{
              fontSize: 13,
              fontFamily: "'JetBrains Mono', monospace",
              fontLigatures: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              padding: { top: 8, bottom: 8 },
              lineNumbers: "on",
              renderLineHighlight: "line",
              cursorBlinking: "smooth",
              cursorSmoothCaretAnimation: "on",
              smoothScrolling: true,
              wordWrap: "on",
              tabSize: 2,
              automaticLayout: true,
              scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
            }}
          />
        )}
      </div>
    </div>
  );
}
