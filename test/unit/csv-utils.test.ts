import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureDir,
  fileExists,
  getCsvHeaders,
  listCsvFiles,
  readCsv,
  toCoinTrackingCsv,
  writeCoinTrackingCsv,
} from "../../src/csv-utils.js";
import type { CoinTrackingRow } from "../../src/types.js";

describe("csv-utils", () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "csv-utils-test-"));
  });

  afterEach(() => {
    // Clean up temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe("readCsv", () => {
    it("reads a valid CSV with standard headers", () => {
      const csvContent = `Name,Age,City
John,30,NYC
Jane,25,LA`;
      const filePath = path.join(tempDir, "test.csv");
      fs.writeFileSync(filePath, csvContent);

      const rows = readCsv(filePath);

      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ Name: "John", Age: "30", City: "NYC" });
      expect(rows[1]).toEqual({ Name: "Jane", Age: "25", City: "LA" });
    });

    it("handles CSV with quoted fields containing commas", () => {
      const csvContent = `Name,Description
"Product A","A large, heavy item"
"Product B","A small, light item"`;
      const filePath = path.join(tempDir, "test.csv");
      fs.writeFileSync(filePath, csvContent);

      const rows = readCsv(filePath);

      expect(rows).toHaveLength(2);
      expect(rows[0]?.["Description"]).toBe("A large, heavy item");
      expect(rows[1]?.["Description"]).toBe("A small, light item");
    });

    it("skips empty rows", () => {
      const csvContent = `Name,Age
John,30

Jane,25

Bob,35`;
      const filePath = path.join(tempDir, "test.csv");
      fs.writeFileSync(filePath, csvContent);

      const rows = readCsv(filePath);

      expect(rows).toHaveLength(3);
    });

    it("handles CSV with inconsistent column counts", () => {
      const csvContent = `A,B,C
1,2,3
4,5
6,7,8,9`;
      const filePath = path.join(tempDir, "test.csv");
      fs.writeFileSync(filePath, csvContent);

      // Should not throw due to relax_column_count
      const rows = readCsv(filePath);
      expect(rows).toHaveLength(3);
    });

    it("throws error for non-existent file", () => {
      expect(() => readCsv("/nonexistent/path/file.csv")).toThrow();
    });

    it("handles empty file", () => {
      const filePath = path.join(tempDir, "empty.csv");
      fs.writeFileSync(filePath, "");

      const rows = readCsv(filePath);
      expect(rows).toHaveLength(0);
    });

    it("trims whitespace from values", () => {
      const csvContent = `Name,City
  John  ,  NYC  
Jane,LA`;
      const filePath = path.join(tempDir, "test.csv");
      fs.writeFileSync(filePath, csvContent);

      const rows = readCsv(filePath);

      expect(rows[0]?.["Name"]).toBe("John");
      expect(rows[0]?.["City"]).toBe("NYC");
    });
  });

  describe("getCsvHeaders", () => {
    it("returns headers only", () => {
      const csvContent = `Transaction Hash,DateTime (UTC),From,To
0xabc,2024-01-01,0x111,0x222
0xdef,2024-01-02,0x333,0x444`;
      const filePath = path.join(tempDir, "test.csv");
      fs.writeFileSync(filePath, csvContent);

      const headers = getCsvHeaders(filePath);

      expect(headers).toEqual(["Transaction Hash", "DateTime (UTC)", "From", "To"]);
    });

    it("returns empty array for empty file", () => {
      const filePath = path.join(tempDir, "empty.csv");
      fs.writeFileSync(filePath, "");

      const headers = getCsvHeaders(filePath);
      expect(headers).toEqual([]);
    });

    it("handles headers with quotes", () => {
      const csvContent = `"Name","Description","Value"
data1,data2,data3`;
      const filePath = path.join(tempDir, "test.csv");
      fs.writeFileSync(filePath, csvContent);

      const headers = getCsvHeaders(filePath);
      expect(headers).toEqual(["Name", "Description", "Value"]);
    });

    it("trims whitespace from headers", () => {
      const csvContent = `  Name  ,  Age  ,  City  
John,30,NYC`;
      const filePath = path.join(tempDir, "test.csv");
      fs.writeFileSync(filePath, csvContent);

      const headers = getCsvHeaders(filePath);
      expect(headers).toEqual(["Name", "Age", "City"]);
    });
  });

  describe("toCoinTrackingCsv", () => {
    it("generates CSV with correct header order", () => {
      const rows: CoinTrackingRow[] = [
        {
          Type: "Deposit",
          BuyAmount: "100",
          BuyCurrency: "ETH",
          SellAmount: "",
          SellCurrency: "",
          Fee: "0.001",
          FeeCurrency: "ETH",
          Exchange: "Ethereum",
          TradeGroup: "",
          Comment: "Test deposit",
          Date: "2024-01-01 12:00:00",
        },
      ];

      const csv = toCoinTrackingCsv(rows);
      const lines = csv.split("\n");

      // Check header line
      expect(lines[0]).toBe(
        "Type,Buy Amount,Buy Currency,Sell Amount,Sell Currency,Fee,Fee Currency,Exchange,Trade Group,Comment,Date"
      );
    });

    it("properly escapes special characters", () => {
      const rows: CoinTrackingRow[] = [
        {
          Type: "Deposit",
          BuyAmount: "100",
          BuyCurrency: "ETH",
          SellAmount: "",
          SellCurrency: "",
          Fee: "",
          FeeCurrency: "",
          Exchange: "My Exchange",
          TradeGroup: "",
          Comment: 'Contains "quotes" and, commas',
          Date: "2024-01-01 12:00:00",
        },
      ];

      const csv = toCoinTrackingCsv(rows);

      // The comment with special characters should be properly quoted
      expect(csv).toContain('"Contains ""quotes"" and, commas"');
    });

    it("handles empty rows array", () => {
      const csv = toCoinTrackingCsv([]);
      const lines = csv.trim().split("\n");

      // Should only have header line
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("Type");
    });

    it("handles multiple rows", () => {
      const rows: CoinTrackingRow[] = [
        {
          Type: "Deposit",
          BuyAmount: "100",
          BuyCurrency: "ETH",
          SellAmount: "",
          SellCurrency: "",
          Fee: "",
          FeeCurrency: "",
          Exchange: "Ethereum",
          TradeGroup: "",
          Comment: "Deposit 1",
          Date: "2024-01-01 12:00:00",
        },
        {
          Type: "Withdrawal",
          BuyAmount: "",
          BuyCurrency: "",
          SellAmount: "50",
          SellCurrency: "ETH",
          Fee: "0.001",
          FeeCurrency: "ETH",
          Exchange: "Ethereum",
          TradeGroup: "",
          Comment: "Withdrawal 1",
          Date: "2024-01-02 12:00:00",
        },
      ];

      const csv = toCoinTrackingCsv(rows);
      const lines = csv.trim().split("\n");

      expect(lines).toHaveLength(3); // header + 2 rows
    });
  });

  describe("writeCoinTrackingCsv", () => {
    it("creates file in correct location", () => {
      const filePath = path.join(tempDir, "output.csv");
      const rows: CoinTrackingRow[] = [
        {
          Type: "Deposit",
          BuyAmount: "100",
          BuyCurrency: "ETH",
          SellAmount: "",
          SellCurrency: "",
          Fee: "",
          FeeCurrency: "",
          Exchange: "Ethereum",
          TradeGroup: "",
          Comment: "Test",
          Date: "2024-01-01 12:00:00",
        },
      ];

      writeCoinTrackingCsv(filePath, rows);

      expect(fs.existsSync(filePath)).toBe(true);
    });

    it("overwrites existing file", () => {
      const filePath = path.join(tempDir, "output.csv");
      fs.writeFileSync(filePath, "old content");

      const rows: CoinTrackingRow[] = [
        {
          Type: "Deposit",
          BuyAmount: "100",
          BuyCurrency: "ETH",
          SellAmount: "",
          SellCurrency: "",
          Fee: "",
          FeeCurrency: "",
          Exchange: "Ethereum",
          TradeGroup: "",
          Comment: "New content",
          Date: "2024-01-01 12:00:00",
        },
      ];

      writeCoinTrackingCsv(filePath, rows);

      const content = fs.readFileSync(filePath, "utf8");
      expect(content).toContain("New content");
      expect(content).not.toContain("old content");
    });
  });

  describe("fileExists", () => {
    it("returns true for existing file", () => {
      const filePath = path.join(tempDir, "exists.txt");
      fs.writeFileSync(filePath, "content");

      expect(fileExists(filePath)).toBe(true);
    });

    it("returns false for non-existing file", () => {
      expect(fileExists(path.join(tempDir, "nonexistent.txt"))).toBe(false);
    });

    it("returns true for existing directory", () => {
      // Directories are technically readable
      expect(fileExists(tempDir)).toBe(true);
    });
  });

  describe("ensureDir", () => {
    it("creates nested directories", () => {
      const nestedPath = path.join(tempDir, "a", "b", "c");

      ensureDir(nestedPath);

      expect(fs.existsSync(nestedPath)).toBe(true);
    });

    it("is no-op for existing directory", () => {
      const existingDir = path.join(tempDir, "existing");
      fs.mkdirSync(existingDir);

      // Should not throw
      expect(() => {
        ensureDir(existingDir);
      }).not.toThrow();
      expect(fs.existsSync(existingDir)).toBe(true);
    });
  });

  describe("listCsvFiles", () => {
    it("lists only .csv files", () => {
      fs.writeFileSync(path.join(tempDir, "file1.csv"), "");
      fs.writeFileSync(path.join(tempDir, "file2.csv"), "");
      fs.writeFileSync(path.join(tempDir, "file3.txt"), "");
      fs.writeFileSync(path.join(tempDir, "file4.json"), "");

      const files = listCsvFiles(tempDir);

      expect(files).toHaveLength(2);
      expect(files.some((f) => f.endsWith("file1.csv"))).toBe(true);
      expect(files.some((f) => f.endsWith("file2.csv"))).toBe(true);
    });

    it("returns full paths", () => {
      fs.writeFileSync(path.join(tempDir, "test.csv"), "");

      const files = listCsvFiles(tempDir);

      expect(files[0]).toBe(`${tempDir}/test.csv`);
    });

    it("returns empty array for empty directory", () => {
      const files = listCsvFiles(tempDir);
      expect(files).toEqual([]);
    });

    it("returns empty array for non-existent directory", () => {
      const files = listCsvFiles(path.join(tempDir, "nonexistent"));
      expect(files).toEqual([]);
    });

    it("does not recurse into subdirectories", () => {
      fs.writeFileSync(path.join(tempDir, "root.csv"), "");
      const subDir = path.join(tempDir, "sub");
      fs.mkdirSync(subDir);
      fs.writeFileSync(path.join(subDir, "nested.csv"), "");

      const files = listCsvFiles(tempDir);

      expect(files).toHaveLength(1);
      expect(files[0]).toBe(`${tempDir}/root.csv`);
    });
  });
});
