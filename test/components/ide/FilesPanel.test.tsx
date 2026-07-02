import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FilesPanel from "../../../src/components/ide/FilesPanel";
import { FileEntry } from "../../../src/types";

vi.mock("../../../src/components/FileExplorer", () => ({
  default: (props: any) => (
    <div data-testid="file-explorer">
      {props.entries.map((e: any) => (
        <button key={e.path} onClick={() => props.onFileSelect(e)}>{e.name}</button>
      ))}
    </div>
  ),
}));

const mockEntries: FileEntry[] = [
  { name: "src", path: "src", type: "directory" },
  { name: "index.ts", path: "index.ts", type: "file", size: 100 },
];

describe("FilesPanel", () => {
  const defaultProps = {
    workspaceId: "ws-1",
    rootEntries: mockEntries,
    expandedFolders: new Set<string>(),
    childEntries: {},
    activeFilePath: undefined,
    isLoading: false,
    onFileSelect: vi.fn(),
    onToggleFolder: vi.fn(),
    onRefresh: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the Files header", () => {
    render(<FilesPanel {...defaultProps} />);
    expect(screen.getByText("Files")).toBeInTheDocument();
  });

  it("renders FileExplorer with entries", () => {
    render(<FilesPanel {...defaultProps} />);
    expect(screen.getByTestId("file-explorer")).toBeInTheDocument();
  });

  it("shows loading state when isLoading and no entries", () => {
    render(
      <FilesPanel
        {...defaultProps}
        rootEntries={[]}
        isLoading={true}
      />
    );
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("calls onRefresh when refresh button is clicked", () => {
    render(<FilesPanel {...defaultProps} />);
    fireEvent.click(screen.getByTitle("Refresh"));
    expect(defaultProps.onRefresh).toHaveBeenCalled();
  });

  it("calls onFileSelect when a file is clicked", () => {
    render(<FilesPanel {...defaultProps} />);
    fireEvent.click(screen.getByText("index.ts"));
    expect(defaultProps.onFileSelect).toHaveBeenCalledWith(mockEntries[1]);
  });
});
