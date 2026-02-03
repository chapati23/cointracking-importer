import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractDateRange,
  formatAddressPath,
  generateManifest,
  saveImport,
} from "../../src/import-storage.js";
import type { DetectedFile } from "../../src/types.js";

// Mock getSavedAddresses to control test behavior
vi.mock("../../src/local-config.js", () => ({
  getSavedAddresses: vi.fn(() => []),
}));

import { getSavedAddresses } from "../../src/local-config.js";
const mockedGetSavedAddresses = vi.mocked(getSavedAddresses);

describe("import-storage", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "import-storage-test-"));
    // Reset mock
    mockedGetSavedAddresses.mockReturnValue([]);
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe("formatAddressPath", () => {
    it("returns shortened address when no saved name", () => {
      mockedGetSavedAddresses.mockReturnValue([]);

      const result = formatAddressPath("0x1234567890abcdef1234567890abcdef12345678");

      expect(result).toBe("0x1234...5678");
    });

    it("returns name with shortened address when saved", () => {
      mockedGetSavedAddresses.mockReturnValue([
        { name: "MyWallet", address: "0x1234567890abcdef1234567890abcdef12345678" },
      ]);

      const result = formatAddressPath("0x1234567890abcdef1234567890abcdef12345678");

      expect(result).toBe("MyWallet_0x1234...5678");
    });

    it("case-insensitive address matching", () => {
      mockedGetSavedAddresses.mockReturnValue([
        { name: "MyWallet", address: "0xabcdef1234567890abcdef1234567890abcdef12" },
      ]);

      const result = formatAddressPath("0xABCDEF1234567890ABCDEF1234567890ABCDEF12");

      expect(result).toBe("MyWallet_0xABCD...EF12");
    });

    it("handles short addresses", () => {
      mockedGetSavedAddresses.mockReturnValue([]);

      const result = formatAddressPath("0x1234");

      // Should still work even with short address
      expect(result).toContain("0x1234");
    });
  });

  describe("extractDateRange", () => {
    it("extracts min/max dates from CSV files", () => {
      // Create test CSV with dates
      const csvContent = `"DateTime (UTC)",From,To
"2024-01-15 12:00:00",0x111,0x222
"2024-01-10 08:00:00",0x333,0x444
"2024-01-20 16:00:00",0x555,0x666`;

      const csvPath = path.join(tempDir, "test.csv");
      fs.writeFileSync(csvPath, csvContent);

      const files: DetectedFile[] = [{ path: csvPath, type: "native", typeName: "Native" }];

      const range = extractDateRange(files);

      expect(range.from).toBe("2024-01-10");
      expect(range.to).toBe("2024-01-20");
    });

    it("returns today's date when no dates found", () => {
      const csvContent = `Name,Value
Test,123`;

      const csvPath = path.join(tempDir, "test.csv");
      fs.writeFileSync(csvPath, csvContent);

      const files: DetectedFile[] = [{ path: csvPath, type: "native", typeName: "Native" }];

      const range = extractDateRange(files);
      const today = new Date().toISOString().split("T")[0];

      expect(range.from).toBe(today);
      expect(range.to).toBe(today);
    });

    it("skips unknown file types", () => {
      const csvContent = `"DateTime (UTC)",From,To
"2024-01-15 12:00:00",0x111,0x222`;

      const csvPath = path.join(tempDir, "test.csv");
      fs.writeFileSync(csvPath, csvContent);

      const files: DetectedFile[] = [{ path: csvPath, type: "unknown", typeName: "Unknown" }];

      const range = extractDateRange(files);
      const today = new Date().toISOString().split("T")[0];

      // Should return today since unknown files are skipped
      expect(range.from).toBe(today);
    });

    it("handles malformed date strings", () => {
      const csvContent = `"DateTime (UTC)",From,To
"not-a-date",0x111,0x222
"2024-01-15 12:00:00",0x333,0x444`;

      const csvPath = path.join(tempDir, "test.csv");
      fs.writeFileSync(csvPath, csvContent);

      const files: DetectedFile[] = [{ path: csvPath, type: "native", typeName: "Native" }];

      const range = extractDateRange(files);

      // Should extract only valid date
      expect(range.from).toBe("2024-01-15");
      expect(range.to).toBe("2024-01-15");
    });

    it("handles files that cannot be read", () => {
      const files: DetectedFile[] = [
        { path: "/nonexistent/path.csv", type: "native", typeName: "Native" },
      ];

      const range = extractDateRange(files);
      const today = new Date().toISOString().split("T")[0];

      expect(range.from).toBe(today);
      expect(range.to).toBe(today);
    });

    it("combines dates from multiple files", () => {
      const csv1 = `"DateTime (UTC)",From,To
"2024-01-15 12:00:00",0x111,0x222`;

      const csv2 = `"DateTime (UTC)",From,To
"2024-02-10 08:00:00",0x333,0x444`;

      const path1 = path.join(tempDir, "file1.csv");
      const path2 = path.join(tempDir, "file2.csv");
      fs.writeFileSync(path1, csv1);
      fs.writeFileSync(path2, csv2);

      const files: DetectedFile[] = [
        { path: path1, type: "native", typeName: "Native" },
        { path: path2, type: "tokens", typeName: "Tokens" },
      ];

      const range = extractDateRange(files);

      expect(range.from).toBe("2024-01-15");
      expect(range.to).toBe("2024-02-10");
    });
  });

  describe("generateManifest", () => {
    it("creates correct manifest structure", () => {
      const csvContent = `"DateTime (UTC)",From,To
"2024-01-15 12:00:00",0x111,0x222`;

      const csvPath = path.join(tempDir, "test.csv");
      fs.writeFileSync(csvPath, csvContent);

      mockedGetSavedAddresses.mockReturnValue([]);

      const manifest = generateManifest({
        chain: "Mantle",
        address: "0x1234567890abcdef1234567890abcdef12345678",
        dateRange: { from: "2024-01-15", to: "2024-01-20" },
        files: [{ path: csvPath, type: "native", typeName: "Native" }],
        outputRowCount: 10,
      });

      expect(manifest.chain).toBe("Mantle");
      expect(manifest.address).toBe("0x1234567890abcdef1234567890abcdef12345678");
      expect(manifest.dateRange.from).toBe("2024-01-15");
      expect(manifest.dateRange.to).toBe("2024-01-20");
      expect(manifest.output.rowCount).toBe(10);
      expect(manifest.output.file).toBe("output/cointracking.csv");
      expect(manifest.importedAt).toBeDefined();
    });

    it("includes address name when saved", () => {
      const csvPath = path.join(tempDir, "test.csv");
      fs.writeFileSync(csvPath, "A,B\n1,2");

      mockedGetSavedAddresses.mockReturnValue([{ name: "TestWallet", address: "0xabcdef" }]);

      const manifest = generateManifest({
        chain: "Ethereum",
        address: "0xABCDEF", // Case insensitive match
        dateRange: { from: "2024-01-01", to: "2024-01-31" },
        files: [{ path: csvPath, type: "native", typeName: "Native" }],
        outputRowCount: 5,
      });

      expect(manifest.addressName).toBe("TestWallet");
    });

    it("counts rows per file type", () => {
      const csv1 = `A,B
1,2
3,4
5,6`;

      const csv2 = `A,B
a,b`;

      const path1 = path.join(tempDir, "native.csv");
      const path2 = path.join(tempDir, "tokens.csv");
      fs.writeFileSync(path1, csv1);
      fs.writeFileSync(path2, csv2);

      mockedGetSavedAddresses.mockReturnValue([]);

      const manifest = generateManifest({
        chain: "Mantle",
        address: "0x123",
        dateRange: { from: "2024-01-01", to: "2024-01-31" },
        files: [
          { path: path1, type: "native", typeName: "Native" },
          { path: path2, type: "tokens", typeName: "Tokens" },
        ],
        outputRowCount: 4,
      });

      expect(manifest.files.native?.txCount).toBe(3);
      expect(manifest.files.tokens?.txCount).toBe(1);
    });

    it("skips unknown file types", () => {
      const csvPath = path.join(tempDir, "test.csv");
      fs.writeFileSync(csvPath, "A,B\n1,2");

      mockedGetSavedAddresses.mockReturnValue([]);

      const manifest = generateManifest({
        chain: "Mantle",
        address: "0x123",
        dateRange: { from: "2024-01-01", to: "2024-01-31" },
        files: [{ path: csvPath, type: "unknown", typeName: "Unknown" }],
        outputRowCount: 0,
      });

      expect(Object.keys(manifest.files)).toHaveLength(0);
    });
  });

  describe("saveImport", () => {
    beforeEach(() => {
      // Tests use the global tempDir set up in the outer beforeEach
    });

    it("creates correct folder structure", () => {
      // Create test input files
      const nativeCsv = `"DateTime (UTC)",From,To
"2024-01-15 12:00:00",0x111,0x222`;

      const nativePath = path.join(tempDir, "native.csv");
      fs.writeFileSync(nativePath, nativeCsv);

      // Create output file
      const outputPath = path.join(tempDir, "output.csv");
      fs.writeFileSync(outputPath, "Type,Amount\nDeposit,100");

      mockedGetSavedAddresses.mockReturnValue([]);

      // We need to test this differently since saveImport uses hardcoded paths
      // For now, just verify the function structure works
      const inputFiles: DetectedFile[] = [{ path: nativePath, type: "native", typeName: "Native" }];

      // The function will write to data/imports which may or may not exist
      // This is more of an integration test - for unit tests we'd mock fs
      expect(() =>
        saveImport({
          chain: "mantle",
          address: "0x1234567890abcdef1234567890abcdef12345678",
          inputFiles,
          outputPath,
          outputRowCount: 1,
        })
      ).not.toThrow();
    });

    it("writes manifest.json with correct data", () => {
      const nativeCsv = `"DateTime (UTC)",From,To
"2024-01-15 12:00:00",0x111,0x222`;

      const nativePath = path.join(tempDir, "native.csv");
      fs.writeFileSync(nativePath, nativeCsv);

      const outputPath = path.join(tempDir, "output.csv");
      fs.writeFileSync(outputPath, "Type,Amount\nDeposit,100");

      mockedGetSavedAddresses.mockReturnValue([]);

      const result = saveImport({
        chain: "mantle",
        address: "0x1234567890abcdef1234567890abcdef12345678",
        inputFiles: [{ path: nativePath, type: "native", typeName: "Native" }],
        outputPath,
        outputRowCount: 1,
      });

      expect(result.manifest.chain).toBe("mantle");
      expect(result.manifest.address).toBe("0x1234567890abcdef1234567890abcdef12345678");
      expect(result.manifest.files.native).toBeDefined();
      expect(result.importPath).toContain("data/imports/mantle");

      // Verify manifest file was written
      const manifestPath = path.join(result.importPath, "manifest.json");
      expect(fs.existsSync(manifestPath)).toBe(true);
    });

    it("copies input files with standardized names", () => {
      const nativeCsv = `A,B\n1,2`;
      const tokensCsv = `C,D\n3,4`;

      const nativePath = path.join(tempDir, "some-random-name.csv");
      const tokensPath = path.join(tempDir, "another-file.csv");
      fs.writeFileSync(nativePath, nativeCsv);
      fs.writeFileSync(tokensPath, tokensCsv);

      const outputPath = path.join(tempDir, "output.csv");
      fs.writeFileSync(outputPath, "Type,Amount\nDeposit,100");

      mockedGetSavedAddresses.mockReturnValue([]);

      const result = saveImport({
        chain: "eth",
        address: "0xabcdef1234567890abcdef1234567890abcdef12",
        inputFiles: [
          { path: nativePath, type: "native", typeName: "Native" },
          { path: tokensPath, type: "tokens", typeName: "Tokens" },
        ],
        outputPath,
        outputRowCount: 1,
      });

      // Verify files were copied with standard names
      expect(fs.existsSync(path.join(result.importPath, "input", "native.csv"))).toBe(true);
      expect(fs.existsSync(path.join(result.importPath, "input", "tokens.csv"))).toBe(true);
    });

    it("copies output file to output directory", () => {
      const nativePath = path.join(tempDir, "native.csv");
      fs.writeFileSync(nativePath, "A,B\n1,2");

      const outputPath = path.join(tempDir, "output.csv");
      const outputContent = "Type,Amount\nDeposit,100\nWithdrawal,50";
      fs.writeFileSync(outputPath, outputContent);

      mockedGetSavedAddresses.mockReturnValue([]);

      const result = saveImport({
        chain: "mantle",
        address: "0x1234567890abcdef1234567890abcdef12345678",
        inputFiles: [{ path: nativePath, type: "native", typeName: "Native" }],
        outputPath,
        outputRowCount: 2,
      });

      const savedOutputPath = path.join(result.importPath, "output", "cointracking.csv");
      expect(fs.existsSync(savedOutputPath)).toBe(true);

      const savedContent = fs.readFileSync(savedOutputPath, "utf8");
      expect(savedContent).toBe(outputContent);
    });
  });
});
