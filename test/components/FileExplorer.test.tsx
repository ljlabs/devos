import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import FileExplorer from "../../src/components/FileExplorer";
import { FileEntry } from "../../src/types";

const mockOnFileSelect = vi.fn();
const mockOnToggleFolder = vi.fn();
const mockOnMoveEntry = vi.fn().mockResolvedValue(undefined);

const baseProps = {
  workspaceId: "ws-1",
  entries: [] as FileEntry[],
  activeFilePath: undefined as string | undefined,
  onFileSelect: mockOnFileSelect,
  expandedFolders: new Set<string>(),
  onToggleFolder: mockOnToggleFolder,
  childEntries: {} as Record<string, FileEntry[]>,
  isLoading: false,
  onMoveEntry: mockOnMoveEntry,
};

const rootFile: FileEntry = { name: "index.ts", path: "index.ts", type: "file", size: 128 };
const nestedFile: FileEntry = { name: "utils.ts", path: "src/utils.ts", type: "file", size: 64 };
const rootDir: FileEntry = { name: "src", path: "src", type: "directory" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simulate HTML5 drag-and-drop from source to target using a given sourcePath payload. */
function dragAndDrop(source: Element, target: Element, sourcePath: string) {
  fireEvent.dragStart(source, {
    dataTransfer: { effectAllowed: "move", setData: vi.fn() } as any,
  });
  fireEvent.dragOver(target, {
    dataTransfer: { dropEffect: "move", effectAllowed: "move" } as any,
  });
  fireEvent.drop(target, {
    dataTransfer: {
      getData: (format: string) => {
        if (format === "application/x-file-path") return sourcePath;
        if (format === "application/x-file-type") return "file";
        return "";
      },
    } as any,
  });
}

/** Ensure document.elementFromPoint exists (jsdom omits it) then mock it. */
function mockElementFromPoint(returnEl: Element | null) {
  if (!document.elementFromPoint) {
    Object.defineProperty(document, "elementFromPoint", {
      writable: true,
      configurable: true,
      value: () => null,
    });
  }
  return vi.spyOn(document, "elementFromPoint").mockReturnValue(returnEl);
}

/** Simulate a touch drag-and-drop, with elementFromPoint mocked to return targetEl on touchEnd. */
async function touchDragTo(source: Element, targetEl: Element | null) {
  const spy = mockElementFromPoint(targetEl);
  await act(async () => {
    fireEvent.touchStart(source, { touches: [{ clientX: 50, clientY: 50 }] });
    fireEvent.touchMove(source, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchEnd(source, { changedTouches: [{ clientX: 100, clientY: 100 }] });
  });
  spy.mockRestore();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
describe("FileExplorer — rendering", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders file entries", () => {
    render(<FileExplorer {...baseProps} entries={[rootFile]} />);
    expect(screen.getByText("index.ts")).toBeInTheDocument();
  });

  it("renders directory entries", () => {
    render(<FileExplorer {...baseProps} entries={[rootDir]} />);
    expect(screen.getByText("src")).toBeInTheDocument();
  });

  it("click file calls onFileSelect", () => {
    render(<FileExplorer {...baseProps} entries={[rootFile]} />);
    fireEvent.click(screen.getByText("index.ts"));
    expect(mockOnFileSelect).toHaveBeenCalledWith(rootFile);
  });

  it("click directory calls onToggleFolder", () => {
    render(<FileExplorer {...baseProps} entries={[rootDir]} />);
    fireEvent.click(screen.getByText("src"));
    expect(mockOnToggleFolder).toHaveBeenCalledWith("src");
  });

  it("active file is highlighted", () => {
    const { container } = render(
      <FileExplorer {...baseProps} entries={[rootFile]} activeFilePath="index.ts" />
    );
    expect(container.querySelector(".bg-emerald-500\\/10")).toBeTruthy();
  });

  it("renders child entries when folder is expanded", () => {
    render(
      <FileExplorer
        {...baseProps}
        entries={[rootDir]}
        expandedFolders={new Set(["src"])}
        childEntries={{ src: [nestedFile] }}
      />
    );
    expect(screen.getByText("utils.ts")).toBeInTheDocument();
  });

  it("shows loading spinner when loading expanded folder", () => {
    render(
      <FileExplorer
        {...baseProps}
        entries={[rootDir]}
        expandedFolders={new Set(["src"])}
        isLoading={true}
      />
    );
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("renders multiple entries", () => {
    const entries: FileEntry[] = [
      { name: "a.ts", path: "a.ts", type: "file" },
      { name: "b.ts", path: "b.ts", type: "file" },
      { name: "dir", path: "dir", type: "directory" },
    ];
    render(<FileExplorer {...baseProps} entries={entries} />);
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.getByText("b.ts")).toBeInTheDocument();
    expect(screen.getByText("dir")).toBeInTheDocument();
  });

  it("nested directories have depth indentation", () => {
    const { container } = render(
      <FileExplorer
        {...baseProps}
        entries={[rootDir]}
        expandedFolders={new Set(["src"])}
        childEntries={{ src: [nestedFile] }}
        depth={0}
      />
    );
    expect(container.querySelector(".pl-4")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Desktop drag-and-drop (HTML5)
// ---------------------------------------------------------------------------
describe("FileExplorer — desktop drag-and-drop", () => {
  beforeEach(() => vi.clearAllMocks());

  it("drag nested file onto its parent folder calls onMoveEntry(src, folder)", async () => {
    render(
      <FileExplorer
        {...baseProps}
        entries={[rootDir]}
        expandedFolders={new Set(["src"])}
        childEntries={{ src: [nestedFile] }}
      />
    );
    await act(async () =>
      dragAndDrop(
        screen.getByTestId("file-tree-item-src/utils.ts"),
        screen.getByTestId("file-tree-item-src"),
        "src/utils.ts"
      )
    );
    expect(mockOnMoveEntry).toHaveBeenCalledWith("src/utils.ts", "src");
  });

  it("drag nested file onto root-level file → moves to root (empty destParentPath)", async () => {
    render(
      <FileExplorer
        {...baseProps}
        entries={[rootFile, rootDir]}
        expandedFolders={new Set(["src"])}
        childEntries={{ src: [nestedFile] }}
      />
    );
    await act(async () =>
      dragAndDrop(
        screen.getByTestId("file-tree-item-src/utils.ts"),
        screen.getByTestId("file-tree-item-index.ts"),
        "src/utils.ts"
      )
    );
    expect(mockOnMoveEntry).toHaveBeenCalledWith("src/utils.ts", "");
  });

  it("drag file onto sibling file → moves to their shared parent", async () => {
    const siblings: FileEntry[] = [
      { name: "a.ts", path: "src/a.ts", type: "file" },
      { name: "b.ts", path: "src/b.ts", type: "file" },
    ];
    render(
      <FileExplorer
        {...baseProps}
        entries={[rootDir]}
        expandedFolders={new Set(["src"])}
        childEntries={{ src: siblings }}
      />
    );
    await act(async () =>
      dragAndDrop(
        screen.getByTestId("file-tree-item-src/a.ts"),
        screen.getByTestId("file-tree-item-src/b.ts"),
        "src/a.ts"
      )
    );
    expect(mockOnMoveEntry).toHaveBeenCalledWith("src/a.ts", "src");
  });

  it("drag file onto a root-level folder moves into that folder", async () => {
    render(
      <FileExplorer
        {...baseProps}
        entries={[rootDir]}
        expandedFolders={new Set(["src"])}
        childEntries={{ src: [nestedFile] }}
      />
    );
    await act(async () =>
      dragAndDrop(
        screen.getByTestId("file-tree-item-src/utils.ts"),
        screen.getByTestId("file-tree-item-src"),
        "src/utils.ts"
      )
    );
    expect(mockOnMoveEntry).toHaveBeenCalledWith("src/utils.ts", "src");
  });

  it("drag over folder shows highlight class", () => {
    render(<FileExplorer {...baseProps} entries={[rootDir]} />);
    const dirRow = screen.getByTestId("file-tree-item-src");
    fireEvent.dragOver(dirRow, { dataTransfer: { dropEffect: "move" } as any });
    expect(dirRow.classList.contains("bg-emerald-500/20")).toBe(true);
  });

  it("drag leave removes highlight class", () => {
    render(<FileExplorer {...baseProps} entries={[rootDir]} />);
    const dirRow = screen.getByTestId("file-tree-item-src");
    fireEvent.dragOver(dirRow, { dataTransfer: { dropEffect: "move" } as any });
    fireEvent.dragLeave(dirRow, { relatedTarget: document.body });
    expect(dirRow.classList.contains("bg-emerald-500/20")).toBe(false);
  });

  it("does not call onMoveEntry when onMoveEntry is not provided", async () => {
    render(
      <FileExplorer
        {...baseProps}
        onMoveEntry={undefined}
        entries={[rootDir]}
        expandedFolders={new Set(["src"])}
        childEntries={{ src: [nestedFile] }}
      />
    );
    await act(async () =>
      dragAndDrop(
        screen.getByTestId("file-tree-item-src/utils.ts"),
        screen.getByTestId("file-tree-item-src"),
        "src/utils.ts"
      )
    );
    expect(mockOnMoveEntry).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Mobile touch drag-and-drop
// ---------------------------------------------------------------------------
describe("FileExplorer — mobile touch drag-and-drop", () => {
  beforeEach(() => vi.clearAllMocks());

  it("touch drag nested file onto folder calls onMoveEntry(src, folder)", async () => {
    render(
      <FileExplorer
        {...baseProps}
        entries={[rootDir]}
        expandedFolders={new Set(["src"])}
        childEntries={{ src: [nestedFile] }}
      />
    );
    const sourceRow = screen.getByTestId("file-tree-item-src/utils.ts");
    const destRow   = screen.getByTestId("file-tree-item-src");

    await touchDragTo(sourceRow, destRow);

    expect(mockOnMoveEntry).toHaveBeenCalledWith("src/utils.ts", "src");
  });

  it("touch drag nested file onto root-level file → moves to root (empty destParentPath)", async () => {
    render(
      <FileExplorer
        {...baseProps}
        entries={[rootFile, rootDir]}
        expandedFolders={new Set(["src"])}
        childEntries={{ src: [nestedFile] }}
      />
    );
    const sourceRow = screen.getByTestId("file-tree-item-src/utils.ts");
    const destRow   = screen.getByTestId("file-tree-item-index.ts");

    await touchDragTo(sourceRow, destRow);

    expect(mockOnMoveEntry).toHaveBeenCalledWith("src/utils.ts", "");
  });

  it("touch drag onto sibling file → moves to their shared parent", async () => {
    const siblings: FileEntry[] = [
      { name: "a.ts", path: "src/a.ts", type: "file" },
      { name: "b.ts", path: "src/b.ts", type: "file" },
    ];
    render(
      <FileExplorer
        {...baseProps}
        entries={[rootDir]}
        expandedFolders={new Set(["src"])}
        childEntries={{ src: siblings }}
      />
    );
    await touchDragTo(
      screen.getByTestId("file-tree-item-src/a.ts"),
      screen.getByTestId("file-tree-item-src/b.ts")
    );
    expect(mockOnMoveEntry).toHaveBeenCalledWith("src/a.ts", "src");
  });

  it("touch drop onto empty space (null target) does not call onMoveEntry", async () => {
    render(<FileExplorer {...baseProps} entries={[rootFile]} />);
    await touchDragTo(screen.getByTestId("file-tree-item-index.ts"), null);
    expect(mockOnMoveEntry).not.toHaveBeenCalled();
  });

  it("touch drop does not call onMoveEntry when handler not provided", async () => {
    render(
      <FileExplorer
        {...baseProps}
        onMoveEntry={undefined}
        entries={[rootDir]}
        expandedFolders={new Set(["src"])}
        childEntries={{ src: [nestedFile] }}
      />
    );
    const sourceRow = screen.getByTestId("file-tree-item-src/utils.ts");
    const destRow   = screen.getByTestId("file-tree-item-src");
    await touchDragTo(sourceRow, destRow);
    expect(mockOnMoveEntry).not.toHaveBeenCalled();
  });
});
