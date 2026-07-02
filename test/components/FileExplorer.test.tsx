import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FileExplorer from "../../src/components/FileExplorer";
import { FileEntry } from "../../src/types";

const mockOnFileSelect = vi.fn();
const mockOnToggleFolder = vi.fn();

const baseProps = {
  workspaceId: "ws-1",
  entries: [] as FileEntry[],
  activeFilePath: undefined as string | undefined,
  onFileSelect: mockOnFileSelect,
  expandedFolders: new Set<string>(),
  onToggleFolder: mockOnToggleFolder,
  childEntries: {} as Record<string, FileEntry[]>,
  isLoading: false,
};

const sampleFile: FileEntry = {
  name: "index.ts",
  path: "src/index.ts",
  type: "file",
  size: 128,
  modified: "2025-01-01T00:00:00Z",
};

const sampleDir: FileEntry = {
  name: "src",
  path: "src",
  type: "directory",
  modified: "2025-01-01T00:00:00Z",
};

describe("FileExplorer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders file entries", () => {
    render(<FileExplorer {...baseProps} entries={[sampleFile]} />);
    expect(screen.getByText("index.ts")).toBeInTheDocument();
  });

  it("renders directory entries", () => {
    render(<FileExplorer {...baseProps} entries={[sampleDir]} />);
    expect(screen.getByText("src")).toBeInTheDocument();
  });

  it("click file calls onFileSelect", () => {
    render(<FileExplorer {...baseProps} entries={[sampleFile]} />);
    fireEvent.click(screen.getByText("index.ts"));
    expect(mockOnFileSelect).toHaveBeenCalledWith(sampleFile);
  });

  it("click directory calls onToggleFolder", () => {
    render(<FileExplorer {...baseProps} entries={[sampleDir]} />);
    fireEvent.click(screen.getByText("src"));
    expect(mockOnToggleFolder).toHaveBeenCalledWith("src");
  });

  it("active file is highlighted", () => {
    const { container } = render(
      <FileExplorer {...baseProps} entries={[sampleFile]} activeFilePath="src/index.ts" />
    );
    const activeItem = container.querySelector(".bg-emerald-500\\/10");
    expect(activeItem).toBeTruthy();
  });

  it("renders child entries when folder is expanded", () => {
    const expandedFolders = new Set(["src"]);
    const childEntries = { "src": [sampleFile] };

    render(
      <FileExplorer
        {...baseProps}
        entries={[sampleDir]}
        expandedFolders={expandedFolders}
        childEntries={childEntries}
      />
    );
    expect(screen.getByText("index.ts")).toBeInTheDocument();
  });

  it("shows loading spinner when loading expanded folder", () => {
    const expandedFolders = new Set(["src"]);

    render(
      <FileExplorer
        {...baseProps}
        entries={[sampleDir]}
        expandedFolders={expandedFolders}
        isLoading={true}
      />
    );
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("renders multiple entries", () => {
    const entries: FileEntry[] = [
      { name: "file1.ts", path: "file1.ts", type: "file", size: 10 },
      { name: "file2.ts", path: "file2.ts", type: "file", size: 20 },
      { name: "dir1", path: "dir1", type: "directory" },
    ];
    render(<FileExplorer {...baseProps} entries={entries} />);
    expect(screen.getByText("file1.ts")).toBeInTheDocument();
    expect(screen.getByText("file2.ts")).toBeInTheDocument();
    expect(screen.getByText("dir1")).toBeInTheDocument();
  });

  it("nested directories have correct depth indentation", () => {
    const entries: FileEntry[] = [sampleDir];
    const expandedFolders = new Set(["src"]);
    const childEntries = { "src": [sampleFile] };

    const { container } = render(
      <FileExplorer
        {...baseProps}
        entries={entries}
        expandedFolders={expandedFolders}
        childEntries={childEntries}
        depth={0}
      />
    );

    // Child items should have pl-4 class for indentation
    const childDiv = container.querySelector(".pl-4");
    expect(childDiv).toBeTruthy();
  });

});
