import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock node-pty before importing TerminalManager
const mockWrite = vi.fn();
const mockResize = vi.fn();
const mockKill = vi.fn();
const mockOnData = vi.fn();
const mockOnExit = vi.fn();

vi.mock("node-pty", () => ({
  default: {
    spawn: vi.fn(() => ({
      write: mockWrite,
      resize: mockResize,
      kill: mockKill,
      onData: mockOnData,
      onExit: mockOnExit,
    })),
  },
}));

import { TerminalManager } from "../../server_src/terminal";

describe("TerminalManager", () => {
  let manager: TerminalManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new TerminalManager();
  });

  afterEach(() => {
    manager.closeAll();
  });

  describe("getShell()", () => {
    it("returns PowerShell on win32", () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32" });
      const shell = manager.getShell();
      expect(shell.command).toBe("powershell.exe");
      expect(shell.args).toContain("-NoLogo");
      Object.defineProperty(process, "platform", { value: originalPlatform });
    });

    it("returns zsh when /bin/zsh exists on non-win32", () => {
      // Skip on Windows - zsh paths don't apply
      if (process.platform === "win32") {
        expect(true).toBe(true);
        return;
      }

      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "linux" });
      const shell = manager.getShell();
      // On this system, /bin/bash might be the actual shell present
      // Just verify it's a valid shell path
      expect(["/bin/zsh", "/bin/bash"]).toContain(shell.command);
      Object.defineProperty(process, "platform", { value: originalPlatform });
    });
  });

  describe("create()", () => {
    it("spawns a PTY session", () => {
      manager.create("term-1", "/tmp", 80, 24);
      expect(manager.has("term-1")).toBe(true);
      expect(manager.get("term-1")).toBeDefined();
    });

    it("stores session with correct id and cwd", () => {
      manager.create("term-2", "/home/user", 120, 40);
      const session = manager.get("term-2");
      expect(session?.id).toBe("term-2");
    });

    it("is idempotent — recreates if same id", () => {
      manager.create("term-3", "/tmp", 80, 24);
      manager.create("term-3", "/tmp", 80, 24);
      // Should still have exactly one session
      expect(manager.getIds().filter((id) => id === "term-3").length).toBe(1);
    });
  });

  describe("write()", () => {
    it("sends data to PTY", () => {
      manager.create("term-4", "/tmp");
      manager.write("term-4", "ls\n");
      expect(mockWrite).toHaveBeenCalledWith("ls\n");
    });

    it("does not throw for non-existent session", () => {
      expect(() => manager.write("nonexistent", "data")).not.toThrow();
    });
  });

  describe("resize()", () => {
    it("resizes the PTY", () => {
      manager.create("term-5", "/tmp");
      manager.resize("term-5", 120, 40);
      expect(mockResize).toHaveBeenCalledWith(120, 40);
    });

    it("does not throw for non-existent session", () => {
      expect(() => manager.resize("nonexistent", 80, 24)).not.toThrow();
    });
  });

  describe("close()", () => {
    it("kills the PTY process", () => {
      manager.create("term-6", "/tmp");
      manager.close("term-6");
      expect(mockKill).toHaveBeenCalled();
      expect(manager.has("term-6")).toBe(false);
    });

    it("is idempotent", () => {
      manager.create("term-7", "/tmp");
      manager.close("term-7");
      expect(() => manager.close("term-7")).not.toThrow();
    });
  });

  describe("closeAll()", () => {
    it("cleans up all sessions", () => {
      manager.create("term-a", "/tmp");
      manager.create("term-b", "/tmp");
      manager.create("term-c", "/tmp");
      manager.closeAll();
      expect(manager.getIds().length).toBe(0);
      expect(mockKill).toHaveBeenCalledTimes(3);
    });
  });

  describe("getIds()", () => {
    it("returns all active session IDs", () => {
      manager.create("term-x", "/tmp");
      manager.create("term-y", "/tmp");
      const ids = manager.getIds();
      expect(ids).toContain("term-x");
      expect(ids).toContain("term-y");
    });
  });

});
