/**
 * Interactive Prompt Flow E2E Tests
 *
 * These tests verify the components that make up the interactive flow.
 * Full end-to-end interactive testing would require terminal emulation
 * which is beyond the scope of these automated tests.
 *
 * For manual testing of interactive flows, run: npm run start
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { categorizeFiles, detectCsvTypeFromFile, getCsvTypeName } from "../../src/detect.js";
import { formatAddressChoice } from "../../src/local-config.js";
import { cleanupTempDir, createCompleteFixtures, createTempFixtureDir } from "../helpers/index.js";

describe("Interactive Flow Components", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempFixtureDir("interactive-test-");
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe("Input Mode Selection", () => {
    /**
     * The interactive CLI supports three input modes:
     * 1. Single file - select one CSV file
     * 2. Multiple files - add/remove files in a loop
     * 3. Folder - auto-detect all CSVs in a directory
     */

    it("documents available input modes", () => {
      const modes = ["single", "multiple", "folder"];
      expect(modes).toHaveLength(3);
    });
  });

  describe("File Type Auto-Detection", () => {
    it("detects native transactions", () => {
      const content = `"Transaction Hash","DateTime (UTC)","From","To","Value_IN(MNT)","Value_OUT(MNT)"
0xabc,2024-01-01,0x111,0x222,0,100`;

      const filePath = path.join(tempDir, "native.csv");
      fs.writeFileSync(filePath, content);

      const type = detectCsvTypeFromFile(filePath);
      expect(type).toBe("native");
      expect(getCsvTypeName(type)).toBe("Native Transactions");
    });

    it("detects token transfers", () => {
      const content = `"Transaction Hash","DateTime (UTC)","From","To","TokenValue","TokenSymbol"
0xabc,2024-01-01,0x111,0x222,100,USDC`;

      const filePath = path.join(tempDir, "tokens.csv");
      fs.writeFileSync(filePath, content);

      const type = detectCsvTypeFromFile(filePath);
      expect(type).toBe("tokens");
      expect(getCsvTypeName(type)).toBe("Token Transfers (ERC-20)");
    });

    it("detects internal transactions", () => {
      const content = `"Txhash","DateTime (UTC)","From","To","ParentTxFrom","Value_IN(ETH)"
0xabc,2024-01-01,0x111,0x222,0xparent,1`;

      const filePath = path.join(tempDir, "internal.csv");
      fs.writeFileSync(filePath, content);

      const type = detectCsvTypeFromFile(filePath);
      expect(type).toBe("internal");
      expect(getCsvTypeName(type)).toBe("Internal Transactions");
    });

    it("detects ERC-721 NFT transfers", () => {
      const content = `"Txhash","DateTime (UTC)","From","To","TokenId","TokenSymbol"
0xabc,2024-01-01,0x111,0x222,1234,BAYC`;

      const filePath = path.join(tempDir, "nft721.csv");
      fs.writeFileSync(filePath, content);

      const type = detectCsvTypeFromFile(filePath);
      expect(type).toBe("nft721");
      expect(getCsvTypeName(type)).toBe("NFT Transfers (ERC-721)");
    });

    it("detects ERC-1155 NFT transfers", () => {
      const content = `"Txhash","DateTime (UTC)","From","To","TokenId","TokenValue","TokenSymbol"
0xabc,2024-01-01,0x111,0x222,1234,5,ITEM`;

      const filePath = path.join(tempDir, "nft1155.csv");
      fs.writeFileSync(filePath, content);

      const type = detectCsvTypeFromFile(filePath);
      expect(type).toBe("nft1155");
      expect(getCsvTypeName(type)).toBe("NFT Transfers (ERC-1155)");
    });

    it("returns unknown for unrecognized format", () => {
      const content = `Name,Age,City
John,30,NYC`;

      const filePath = path.join(tempDir, "unknown.csv");
      fs.writeFileSync(filePath, content);

      const type = detectCsvTypeFromFile(filePath);
      expect(type).toBe("unknown");
      expect(getCsvTypeName(type)).toBe("Unknown");
    });
  });

  describe("Folder Mode - Bulk File Categorization", () => {
    it("categorizes all CSV files in a directory", () => {
      createCompleteFixtures(tempDir);

      const files = fs.readdirSync(tempDir).map((f) => path.join(tempDir, f));
      const categorized = categorizeFiles(files);

      expect(categorized.native).toHaveLength(1);
      expect(categorized.tokens).toHaveLength(1);
      expect(categorized.internal).toHaveLength(1);
      expect(categorized.nft721).toHaveLength(1);
      expect(categorized.nft1155).toHaveLength(1);
      expect(categorized.unknown).toHaveLength(0);
    });
  });

  describe("Address Selection Flow", () => {
    // Note: These tests use the actual local config which may affect the real .local folder
    // In a real test environment, you would want to mock the file system

    it("formats address choice for CLI display", () => {
      const entry = {
        name: "My Wallet",
        address: "0x1234567890123456789012345678901234567890",
      };

      const formatted = formatAddressChoice(entry);

      expect(formatted).toBe("My Wallet (0x1234...7890)");
    });

    it("formats address choice with short name", () => {
      const entry = {
        name: "A",
        address: "0xabcdef1234567890abcdef1234567890abcdef12",
      };

      const formatted = formatAddressChoice(entry);

      expect(formatted).toBe("A (0xabcd...ef12)");
    });
  });

  describe("Detection Confirmation Display", () => {
    /**
     * The interactive flow shows a detection summary table:
     *
     * ┌─────────────────────────────────────────────────────────────┐
     * │ Detected CSV Files                                          │
     * ├─────────────────────────────────────────────────────────────┤
     * │ native.csv              ✓ Native Transactions               │
     * │ tokens.csv              ✓ Token Transfers (ERC-20)          │
     * │ unknown.csv             ⚠ Unknown                           │
     * └─────────────────────────────────────────────────────────────┘
     */

    it("provides human-readable names for all CSV types", () => {
      expect(getCsvTypeName("native")).toBe("Native Transactions");
      expect(getCsvTypeName("tokens")).toBe("Token Transfers (ERC-20)");
      expect(getCsvTypeName("internal")).toBe("Internal Transactions");
      expect(getCsvTypeName("nft721")).toBe("NFT Transfers (ERC-721)");
      expect(getCsvTypeName("nft1155")).toBe("NFT Transfers (ERC-1155)");
      expect(getCsvTypeName("unknown")).toBe("Unknown");
    });
  });

  describe("Import Storage Verification", () => {
    /**
     * After processing, imports are saved to:
     * .local/imports/<chain>/<address>/<date-range>/
     *   input/
     *     native.csv
     *     tokens.csv
     *     ...
     *   output/
     *     cointracking.csv
     *   manifest.json
     */

    it("documents the expected folder structure", () => {
      const expectedStructure = {
        input: ["native.csv", "tokens.csv", "internal.csv", "nft721.csv", "nft1155.csv"],
        output: ["cointracking.csv"],
        manifest: "manifest.json",
      };

      expect(expectedStructure.input).toHaveLength(5);
      expect(expectedStructure.output).toHaveLength(1);
      expect(expectedStructure.manifest).toBe("manifest.json");
    });
  });
});

describe("Interactive Test Scenarios (Manual Testing Guide)", () => {
  /**
   * These describe blocks document the manual test scenarios
   * that should be verified when testing the interactive flow.
   *
   * To test: npm run start
   */

  describe("Single File Mode", () => {
    it.skip("should navigate to and select a CSV file", () => {
      // Manual test: Select "Single file" mode, type a file path, verify detection
    });

    it.skip("should support tab completion for file paths", () => {
      // Manual test: Type partial path and press tab
    });

    it.skip("should navigate into directories when selected", () => {
      // Manual test: Select a directory to navigate into it
    });
  });

  describe("Multiple Files Mode", () => {
    it.skip("should show running list of selected files", () => {
      // Manual test: Add files and verify list updates
    });

    it.skip("should allow removing files from selection", () => {
      // Manual test: Add files, then remove one
    });

    it.skip("should detect duplicate files", () => {
      // Manual test: Try adding same file twice
    });
  });

  describe("Folder Mode", () => {
    it.skip("should list all CSVs in selected folder", () => {
      // Manual test: Select folder with multiple CSV files
    });

    it.skip("should warn about empty folders", () => {
      // Manual test: Select folder with no CSV files
    });
  });

  describe("Address Selection", () => {
    it.skip("should allow selecting from saved addresses", () => {
      // Manual test: Have saved addresses, select one
    });

    it.skip("should allow entering address manually", () => {
      // Manual test: Choose manual entry, enter valid address
    });

    it.skip("should offer to save manually entered address", () => {
      // Manual test: Enter new address, choose to save it
    });

    it.skip("should validate address format", () => {
      // Manual test: Enter invalid address, see validation error
    });
  });

  describe("Cancellation", () => {
    it.skip("should exit gracefully on Ctrl+C", () => {
      // Manual test: Press Ctrl+C at any prompt
    });
  });
});
