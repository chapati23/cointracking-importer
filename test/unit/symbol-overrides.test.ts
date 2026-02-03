import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COINTRACKING_NATIVE_SYMBOLS,
  getDefaultNativeSymbol,
  readSymbolOverrides,
  resolveNativeSymbol,
} from "../../src/symbol-overrides.js";

// Mock fs module
vi.mock("node:fs");
const mockFs = vi.mocked(fs);

describe("symbol-overrides", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------- Built-in Symbols ----------

  describe("COINTRACKING_NATIVE_SYMBOLS", () => {
    it("has correct symbol for Mantle", () => {
      expect(COINTRACKING_NATIVE_SYMBOLS["Mantle"]).toBe("MNT3");
    });

    it("has correct symbol for Ethereum", () => {
      expect(COINTRACKING_NATIVE_SYMBOLS["Ethereum"]).toBe("ETH");
    });

    it("has correct symbol for Polygon", () => {
      expect(COINTRACKING_NATIVE_SYMBOLS["Polygon"]).toBe("POL");
    });

    it("has correct symbol for Arbitrum", () => {
      expect(COINTRACKING_NATIVE_SYMBOLS["Arbitrum"]).toBe("AETH");
    });

    it("has correct symbol for BSC aliases", () => {
      expect(COINTRACKING_NATIVE_SYMBOLS["Binance Smart Chain"]).toBe("BNB");
      expect(COINTRACKING_NATIVE_SYMBOLS["BSC"]).toBe("BNB");
    });
  });

  // ---------- Read/Write Overrides ----------

  describe("readSymbolOverrides", () => {
    it("returns empty overrides when file does not exist", () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = readSymbolOverrides();

      expect(result).toEqual({ nativeSymbols: {}, tokenSymbols: {} });
    });

    it("reads and parses valid override file", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          nativeSymbols: { CustomChain: "CUSTOM" },
          tokenSymbols: { FOO: "FOO2" },
        })
      );

      const result = readSymbolOverrides();

      expect(result).toEqual({
        nativeSymbols: { CustomChain: "CUSTOM" },
        tokenSymbols: { FOO: "FOO2" },
      });
    });

    it("returns empty overrides on invalid JSON", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue("not valid json");

      const result = readSymbolOverrides();

      expect(result).toEqual({ nativeSymbols: {}, tokenSymbols: {} });
    });

    it("returns empty overrides for non-object JSON", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('"just a string"');

      const result = readSymbolOverrides();

      expect(result).toEqual({ nativeSymbols: {}, tokenSymbols: {} });
    });

    it("handles missing nativeSymbols field", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ tokenSymbols: { FOO: "FOO2" } }));

      const result = readSymbolOverrides();

      expect(result).toEqual({
        nativeSymbols: {},
        tokenSymbols: { FOO: "FOO2" },
      });
    });
  });

  // ---------- Symbol Resolution ----------

  describe("resolveNativeSymbol", () => {
    it("returns user override when present", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          nativeSymbols: { Mantle: "MNT_CUSTOM" },
          tokenSymbols: {},
        })
      );

      const result = resolveNativeSymbol("Mantle", "MNT");

      expect(result).toBe("MNT_CUSTOM");
    });

    it("returns built-in default when no user override", () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = resolveNativeSymbol("Mantle", "MNT");

      expect(result).toBe("MNT3");
    });

    it("returns original symbol for unknown chain without override", () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = resolveNativeSymbol("UnknownChain", "UNK");

      expect(result).toBe("UNK");
    });

    it("prioritizes user override over built-in default", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          nativeSymbols: { Ethereum: "ETH_CUSTOM" },
          tokenSymbols: {},
        })
      );

      const result = resolveNativeSymbol("Ethereum", "ETH");

      // User override should win over built-in "ETH"
      expect(result).toBe("ETH_CUSTOM");
    });
  });

  describe("getDefaultNativeSymbol", () => {
    it("returns user override when present", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          nativeSymbols: { CustomChain: "CUSTOM" },
          tokenSymbols: {},
        })
      );

      const result = getDefaultNativeSymbol("CustomChain");

      expect(result).toBe("CUSTOM");
    });

    it("returns built-in default when no user override", () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = getDefaultNativeSymbol("Ethereum");

      expect(result).toBe("ETH");
    });

    it("returns undefined for unknown chain", () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = getDefaultNativeSymbol("UnknownChain");

      expect(result).toBeUndefined();
    });
  });
});
