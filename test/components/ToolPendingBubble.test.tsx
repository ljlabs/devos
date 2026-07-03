import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ToolPendingBubble } from "../../src/components/shared/ToolPendingBubble";
import { Message } from "../../src/types";

const baseProps = {
  toolCallId: "tool-1",
  title: "Terminal",
  kind: "execute",
  rawInput: undefined as Record<string, any> | undefined,
  status: "pending" as string | undefined,
  timestamp: "2026-07-03T12:00:00Z",
  resultMsg: undefined as Message | undefined,
  resultStatus: undefined as string | undefined,
  permissionApproved: undefined as boolean | undefined,
  permissionRejected: undefined as boolean | undefined,
  hasApproval: false,
  isExpanded: false,
  onToggleExpand: () => {},
  compact: false,
};

function renderAndGetText(props: Partial<React.ComponentProps<typeof ToolPendingBubble>> = {}) {
  const result = render(<ToolPendingBubble {...baseProps} {...props} />);
  return result.container.textContent || "";
}

describe("ToolPendingBubble — permission input resolution", () => {
  describe("Bash tool", () => {
    it("should show command from rawInput", () => {
      const text = renderAndGetText({
        rawInput: {
          command: 'npx tsc --noEmit 2>&1 | grep "getCustomerProgramData.test" | head -5',
          description: "Check TypeScript errors in the test file",
          timeout: 30000,
        },
      });
      expect(text).toContain("npx tsc --noEmit");
    });

    it("should show permission request title when rawInput is empty", () => {
      const text = renderAndGetText({
        title: 'npx tsc --noEmit 2>&1 | grep "getCustomerProgramData.test" | head -5',
        rawInput: {},
      });
      expect(text).toContain("npx tsc --noEmit");
    });
  });

  describe("Read tool", () => {
    it("should show file_path from rawInput", () => {
      const text = renderAndGetText({
        kind: "read",
        rawInput: { file_path: "/src/utils/helper.ts" },
      });
      expect(text).toContain("/src/utils/helper.ts");
    });

    it("should fall back to path if file_path is missing", () => {
      const text = renderAndGetText({
        kind: "read",
        rawInput: { path: "/src/config.json" },
      });
      expect(text).toContain("/src/config.json");
    });
  });

  describe("Edit tool", () => {
    it("should show file_path from rawInput", () => {
      const text = renderAndGetText({
        kind: "edit",
        rawInput: { file_path: "/src/App.tsx" },
      });
      expect(text).toContain("/src/App.tsx");
    });

    it("should show notebook_path for notebook edit", () => {
      const text = renderAndGetText({
        kind: "edit",
        rawInput: { notebook_path: "/notebooks/analysis.ipynb" },
      });
      expect(text).toContain("/notebooks/analysis.ipynb");
    });
  });

  describe("Write tool", () => {
    it("should show file_path from rawInput", () => {
      const text = renderAndGetText({
        kind: "write",
        rawInput: { file_path: "/src/newFile.ts" },
      });
      expect(text).toContain("/src/newFile.ts");
    });
  });

  describe("Grep tool", () => {
    it("should show pattern from rawInput", () => {
      const text = renderAndGetText({
        kind: "search",
        rawInput: { pattern: "handleClick", path: "/src" },
      });
      expect(text).toContain("handleClick");
    });
  });

  describe("Edge cases", () => {
    it("should show title fallback when rawInput is undefined", () => {
      const text = renderAndGetText({ rawInput: undefined });
      expect(text).toContain("Terminal");
    });

    it("should show pending when both title and rawInput are empty", () => {
      const text = renderAndGetText({ title: "", rawInput: {} });
      expect(text).toContain("pending");
    });

    it("should show object value as JSON string", () => {
      const text = renderAndGetText({
        rawInput: { config: { enabled: true } },
      });
      expect(text).toContain("enabled");
    });
  });

  describe("Permission badges", () => {
    it("should show Approved badge", () => {
      const text = renderAndGetText({ hasApproval: true, permissionApproved: true });
      expect(text).toContain("Approved");
    });

    it("should show Rejected badge", () => {
      const text = renderAndGetText({ hasApproval: true, permissionRejected: true });
      expect(text).toContain("Rejected");
    });

    it("should not show badge when hasApproval is false", () => {
      const text = renderAndGetText({ hasApproval: false });
      expect(text).not.toContain("Approved");
      expect(text).not.toContain("Rejected");
    });
  });
});
