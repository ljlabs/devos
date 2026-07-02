import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FileEditorPanel from "../../../src/components/ide/FileEditorPanel";
import { FileContent } from "../../../src/types";

vi.mock("@monaco-editor/react", () => ({
  default: ({ value, onChange, onMount }: any) => {
    if (onMount) {
      const mockEditor = {
        trigger: vi.fn(),
        dispose: vi.fn(),
        focus: vi.fn(),
        addAction: vi.fn(),
      };
      const mockMonaco = {
        editor: { defineTheme: vi.fn(), setTheme: vi.fn() },
        KeyMod: {},
        KeyCode: {},
      };
      onMount(mockEditor, mockMonaco);
    }
    return (
      <div data-testid="monaco-editor">
        <textarea
          data-testid="monaco-textarea"
          defaultValue={value}
          onChange={(e) => onChange?.(e.target.value)}
        />
      </div>
    );
  },
}));

vi.mock("../../../src/components/ide/ReadOnlyCodeDisplay", () => ({
  default: ({ filePath, content }: any) => (
    <div data-testid="readonly-display">{content}</div>
  ),
}));

const mockFile: FileContent = {
  path: "src/index.ts",
  content: "console.log('hello');",
  size: 20,
  lines: 1,
};

const mockFile2: FileContent = {
  path: "src/utils.ts",
  content: "export const add = (a: number, b: number) => a + b;",
  size: 50,
  lines: 1,
};

describe("FileEditorPanel", () => {
  const defaultProps = {
    isSaving: false,
    isLoading: false,
    onContentChange: vi.fn(),
    onSave: vi.fn().mockResolvedValue(undefined),
    onCloseTab: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Loading state", () => {
    it("shows loading spinner when isLoading is true", () => {
      render(<FileEditorPanel {...defaultProps} isLoading={true} />);
      expect(screen.getByText("Loading file...")).toBeInTheDocument();
    });
  });

  describe("Empty state (single-file mode)", () => {
    it("shows empty state when no file is selected", () => {
      render(<FileEditorPanel {...defaultProps} activeFile={null} />);
      expect(screen.getByText("No file selected.")).toBeInTheDocument();
      expect(screen.getByText(/Open a file from the FILES tab/)).toBeInTheDocument();
    });
  });

  describe("Single-file mode (mobile)", () => {
    it("renders file name in tab bar", () => {
      render(
        <FileEditorPanel
          {...defaultProps}
          activeFile={mockFile}
          activeFilePath="src/index.ts"
          editorContent="console.log('hello');"
          isDirty={false}
        />
      );
      expect(screen.getByText("index.ts")).toBeInTheDocument();
    });

    it("shows dirty indicator when isDirty is true", () => {
      render(
        <FileEditorPanel
          {...defaultProps}
          activeFile={mockFile}
          activeFilePath="src/index.ts"
          editorContent="modified content"
          isDirty={true}
        />
      );
      expect(screen.getByTitle("Unsaved changes")).toBeInTheDocument();
    });

    it("calls onSave when save button is clicked", () => {
      render(
        <FileEditorPanel
          {...defaultProps}
          activeFile={mockFile}
          activeFilePath="src/index.ts"
          editorContent="modified"
          isDirty={true}
        />
      );
      fireEvent.click(screen.getByTitle("Save (Ctrl+S)"));
      expect(defaultProps.onSave).toHaveBeenCalled();
    });

    it("disables save button when not dirty", () => {
      render(
        <FileEditorPanel
          {...defaultProps}
          activeFile={mockFile}
          activeFilePath="src/index.ts"
          editorContent="content"
          isDirty={false}
        />
      );
      expect(screen.getByTitle("Save (Ctrl+S)")).toBeDisabled();
    });

    it("calls onCloseTab when close button is clicked", () => {
      render(
        <FileEditorPanel
          {...defaultProps}
          activeFile={mockFile}
          activeFilePath="src/index.ts"
          editorContent="content"
        />
      );
      fireEvent.click(screen.getByTitle("Close"));
      expect(defaultProps.onCloseTab).toHaveBeenCalled();
    });

    it("renders Monaco editor with file content", () => {
      render(
        <FileEditorPanel
          {...defaultProps}
          activeFile={mockFile}
          activeFilePath="src/index.ts"
          editorContent="console.log('hello');"
        />
      );
      expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
    });
  });

  describe("Multi-tab mode (desktop)", () => {
    const tabs = [
      { path: "src/index.ts", file: mockFile, content: "console.log('hello');", isDirty: false },
      { path: "src/utils.ts", file: mockFile2, content: "export const add = ...;", isDirty: true },
    ];

    it("renders all tab names", () => {
      render(
        <FileEditorPanel
          {...defaultProps}
          tabs={tabs}
          activeTabIndex={0}
          onTabChange={vi.fn()}
        />
      );
      expect(screen.getByText("index.ts")).toBeInTheDocument();
      expect(screen.getByText("utils.ts")).toBeInTheDocument();
    });

    it("highlights the active tab", () => {
      render(
        <FileEditorPanel
          {...defaultProps}
          tabs={tabs}
          activeTabIndex={0}
          onTabChange={vi.fn()}
        />
      );
      const indexTab = screen.getByText("index.ts").closest("div")!;
      expect(indexTab.className).toContain("bg-[#1A1A1E]");
    });

    it("calls onTabChange when a tab is clicked", () => {
      const onTabChange = vi.fn();
      render(
        <FileEditorPanel
          {...defaultProps}
          tabs={tabs}
          activeTabIndex={0}
          onTabChange={onTabChange}
        />
      );
      fireEvent.click(screen.getByText("utils.ts"));
      expect(onTabChange).toHaveBeenCalledWith(1);
    });

    it("shows dirty indicator for dirty tabs", () => {
      render(
        <FileEditorPanel
          {...defaultProps}
          tabs={tabs}
          activeTabIndex={0}
          onTabChange={vi.fn()}
        />
      );
      const utilsTab = screen.getByText("utils.ts").closest("div")!;
      expect(utilsTab.querySelector(".bg-amber-400")).toBeTruthy();
    });

    it("calls onCloseTab with index when close button is clicked", () => {
      const onCloseTab = vi.fn();
      render(
        <FileEditorPanel
          {...defaultProps}
          tabs={tabs}
          activeTabIndex={0}
          onTabChange={vi.fn()}
          onCloseTab={onCloseTab}
        />
      );
      // Find all close buttons (they have title="Close")
      const closeButtons = screen.getAllByTitle("Close");
      fireEvent.click(closeButtons[0]);
      expect(onCloseTab).toHaveBeenCalledWith(0);
    });

    it("renders editor actions toolbar in multi-tab mode", () => {
      render(
        <FileEditorPanel
          {...defaultProps}
          tabs={tabs}
          activeTabIndex={0}
          onTabChange={vi.fn()}
        />
      );
      expect(screen.getByTitle("Undo (Ctrl+Z)")).toBeInTheDocument();
      expect(screen.getByTitle("Redo (Ctrl+Shift+Z)")).toBeInTheDocument();
    });

    it("shows empty state when active tab has no file", () => {
      const tabsNoFile = [
        { path: "src/empty.ts", file: null, content: "", isDirty: false },
      ];
      render(
        <FileEditorPanel
          {...defaultProps}
          tabs={tabsNoFile}
          activeTabIndex={0}
          onTabChange={vi.fn()}
        />
      );
      expect(screen.getByText("No file selected.")).toBeInTheDocument();
    });

    it("renders Monaco editor with active tab content", () => {
      render(
        <FileEditorPanel
          {...defaultProps}
          tabs={tabs}
          activeTabIndex={1}
          onTabChange={vi.fn()}
        />
      );
      expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
    });
  });

  describe("Mobile select mode", () => {
    it("shows type toggle button on mobile", () => {
      render(
        <FileEditorPanel
          {...defaultProps}
          activeFile={mockFile}
          activeFilePath="src/index.ts"
          editorContent="content"
          isMobile={true}
        />
      );
      expect(screen.getByTitle("Switch to select mode")).toBeInTheDocument();
    });

    it("switches to ReadOnlyCodeDisplay when select mode is toggled", () => {
      render(
        <FileEditorPanel
          {...defaultProps}
          activeFile={mockFile}
          activeFilePath="src/index.ts"
          editorContent="test content"
          isMobile={true}
        />
      );
      fireEvent.click(screen.getByTitle("Switch to select mode"));
      expect(screen.getByTestId("readonly-display")).toBeInTheDocument();
    });
  });
});
