import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import ReadOnlyCodeDisplay from "../../../src/components/ide/ReadOnlyCodeDisplay";

describe("ReadOnlyCodeDisplay", () => {
  it("renders code content", () => {
    const { container } = render(<ReadOnlyCodeDisplay filePath="test.ts" content="const x = 1;" />);
    expect(container.textContent).toContain("const x = 1;");
  });

  it("displays line numbers", () => {
    const { container } = render(<ReadOnlyCodeDisplay filePath="test.ts" content="line1\nline2" />);
    expect(container.textContent).toContain("1");
    expect(container.textContent).toContain("2");
  });

  it("renders multiple lines", () => {
    const content = "function hello() {\n  return 'world';\n}";
    const { container } = render(<ReadOnlyCodeDisplay filePath="test.ts" content={content} />);
    expect(container.textContent).toContain("function hello()");
    expect(container.textContent).toContain("return");
    expect(container.textContent).toContain("world");
  });

  it("handles empty content", () => {
    const { container } = render(<ReadOnlyCodeDisplay filePath="test.ts" content="" />);
    const codeLines = container.querySelectorAll(".flex.gap-4");
    expect(codeLines.length).toBe(1);
  });

  it("applies syntax highlighting classes to keywords", () => {
    const { container } = render(<ReadOnlyCodeDisplay filePath="test.ts" content="const x = 1;" />);
    const keyword = container.querySelector(".text-red-400");
    expect(keyword).toBeTruthy();
    expect(keyword?.textContent).toBe("const");
  });

  it("applies string color to strings", () => {
    const { container } = render(<ReadOnlyCodeDisplay filePath="test.ts" content='const x = "hello";' />);
    const stringToken = container.querySelector(".text-green-400");
    expect(stringToken).toBeTruthy();
  });

  it("applies number color to numbers", () => {
    const { container } = render(<ReadOnlyCodeDisplay filePath="test.ts" content="const x = 42;" />);
    const numberToken = container.querySelector(".text-yellow-400");
    expect(numberToken).toBeTruthy();
  });
});
