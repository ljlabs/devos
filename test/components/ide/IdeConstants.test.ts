import { describe, it, expect } from "vitest";
import { getLanguageFromPath, EXTENSION_LANGUAGE_MAP } from "../../../src/components/ide/IdeConstants";

describe("IdeConstants", () => {
  describe("getLanguageFromPath", () => {
    it("returns typescript for .ts files", () => {
      expect(getLanguageFromPath("src/index.ts")).toBe("typescript");
    });

    it("returns typescript for .tsx files", () => {
      expect(getLanguageFromPath("src/App.tsx")).toBe("typescript");
    });

    it("returns javascript for .js files", () => {
      expect(getLanguageFromPath("src/utils.js")).toBe("javascript");
    });

    it("returns python for .py files", () => {
      expect(getLanguageFromPath("script.py")).toBe("python");
    });

    it("returns json for .json files", () => {
      expect(getLanguageFromPath("package.json")).toBe("json");
    });

    it("returns html for .html files", () => {
      expect(getLanguageFromPath("index.html")).toBe("html");
    });

    it("returns css for .css files", () => {
      expect(getLanguageFromPath("styles.css")).toBe("css");
    });

    it("returns dockerfile for Dockerfile", () => {
      expect(getLanguageFromPath("Dockerfile")).toBe("dockerfile");
    });

    it("returns shell for .sh files", () => {
      expect(getLanguageFromPath("script.sh")).toBe("shell");
    });

    it("returns plaintext for unknown extensions", () => {
      expect(getLanguageFromPath("file.xyz")).toBe("plaintext");
    });

    it("returns plaintext for files without extension", () => {
      expect(getLanguageFromPath("README")).toBe("plaintext");
    });

    it("handles files in subdirectories", () => {
      expect(getLanguageFromPath("src/components/App.tsx")).toBe("typescript");
    });
  });

  describe("EXTENSION_LANGUAGE_MAP", () => {
    it("has mappings for common languages", () => {
      expect(EXTENSION_LANGUAGE_MAP.ts).toBe("typescript");
      expect(EXTENSION_LANGUAGE_MAP.js).toBe("javascript");
      expect(EXTENSION_LANGUAGE_MAP.py).toBe("python");
      expect(EXTENSION_LANGUAGE_MAP.rs).toBe("rust");
      expect(EXTENSION_LANGUAGE_MAP.go).toBe("go");
    });
  });
});
