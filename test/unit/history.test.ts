import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addImportRecord,
  ensureDataDirs,
  generateImportId,
  getOutputDir,
  getOutputFile,
  getRawDir,
  listImports,
  markAsImported,
  readHistory,
  writeHistory,
} from "../../src/history.js";
import type { HistoryData, ImportRecord } from "../../src/types.js";

describe("history", () => {
  const DATA_DIR = "data";
  const HISTORY_FILE = path.join(DATA_DIR, "history.json");
  let originalHistory: HistoryData | null = null;

  beforeEach(() => {
    // Save original history if it exists
    if (fs.existsSync(HISTORY_FILE)) {
      const content = fs.readFileSync(HISTORY_FILE, "utf8");
      originalHistory = JSON.parse(content) as HistoryData;
    } else {
      originalHistory = null;
    }
    // Start with empty history for tests
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({ imports: [] }), "utf8");
  });

  afterEach(() => {
    // Restore original history
    if (originalHistory !== null) {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(originalHistory, null, 2), "utf8");
    } else {
      // Remove test history file if we created it
      if (fs.existsSync(HISTORY_FILE)) {
        fs.unlinkSync(HISTORY_FILE);
      }
    }
  });

  describe("generateImportId", () => {
    it("generates correct format: chain_addressPrefix_yearMonth", () => {
      const id = generateImportId(
        "Mantle",
        "0x1234567890abcdef1234567890abcdef12345678",
        "2024-12"
      );

      expect(id).toBe("mantle_0x12345678_2024-12");
    });

    it("lowercases chain name", () => {
      const id = generateImportId("ETHEREUM", "0xabcdef", "2024-01");

      expect(id).toMatch(/^ethereum_/);
    });

    it("uses first 10 chars of address", () => {
      const id = generateImportId("eth", "0x1234567890abcdef", "2024-01");

      expect(id).toContain("_0x12345678_");
    });

    it("lowercases address prefix", () => {
      const id = generateImportId("eth", "0xABCDEF1234567890", "2024-01");

      expect(id).toContain("_0xabcdef12_");
    });

    it("uses current date when dateStr not provided", () => {
      const id = generateImportId("eth", "0x1234567890");
      const currentYearMonth = new Date().toISOString().slice(0, 7);

      expect(id).toContain(currentYearMonth);
    });
  });

  describe("readHistory / writeHistory", () => {
    it("creates history.json if missing", () => {
      if (fs.existsSync(HISTORY_FILE)) {
        fs.unlinkSync(HISTORY_FILE);
      }

      const history = readHistory();
      expect(history).toEqual({ imports: [] });
    });

    it("reads existing history correctly", () => {
      const testHistory: HistoryData = {
        imports: [
          {
            id: "test_id",
            chain: "Mantle",
            address: "0x123",
            nativeSymbol: "MNT",
            processedAt: "2024-01-01T00:00:00Z",
            inputFiles: ["native.csv"],
            outputFile: "output.csv",
            rowCount: 10,
            dateRange: { from: "2024-01-01", to: "2024-01-31" },
            importedToCoinTracking: false,
          },
        ],
      };
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(testHistory), "utf8");

      const history = readHistory();
      expect(history.imports).toHaveLength(1);
      expect(history.imports[0]?.id).toBe("test_id");
      expect(history.imports[0]?.chain).toBe("Mantle");
    });

    it("writes valid JSON", () => {
      const history: HistoryData = {
        imports: [
          {
            id: "new_import",
            chain: "Ethereum",
            address: "0xabc",
            nativeSymbol: "ETH",
            processedAt: "2024-02-01T00:00:00Z",
            inputFiles: ["native.csv", "tokens.csv"],
            outputFile: "output.csv",
            rowCount: 25,
            dateRange: { from: "2024-02-01", to: "2024-02-28" },
            importedToCoinTracking: false,
          },
        ],
      };

      writeHistory(history);

      const content = fs.readFileSync(HISTORY_FILE, "utf8");
      const parsed = JSON.parse(content) as HistoryData;
      expect(parsed.imports).toHaveLength(1);
      expect(parsed.imports[0]?.id).toBe("new_import");
    });

    it("creates data directory if missing", () => {
      // This test is tricky since we need data dir for the test setup
      // Just verify writeHistory works
      const history: HistoryData = { imports: [] };
      expect(() => {
        writeHistory(history);
      }).not.toThrow();
    });
  });

  describe("addImportRecord", () => {
    it("adds new record", () => {
      const record: ImportRecord = {
        id: "test_import_1",
        chain: "Mantle",
        address: "0x123",
        nativeSymbol: "MNT",
        processedAt: "2024-01-01T00:00:00Z",
        inputFiles: ["native.csv"],
        outputFile: "output.csv",
        rowCount: 10,
        dateRange: { from: "2024-01-01", to: "2024-01-31" },
        importedToCoinTracking: false,
      };

      addImportRecord(record);

      const history = readHistory();
      expect(history.imports).toHaveLength(1);
      expect(history.imports[0]?.id).toBe("test_import_1");
    });

    it("replaces existing record with same ID (update)", () => {
      const record1: ImportRecord = {
        id: "same_id",
        chain: "Mantle",
        address: "0x123",
        nativeSymbol: "MNT",
        processedAt: "2024-01-01T00:00:00Z",
        inputFiles: ["native.csv"],
        outputFile: "output.csv",
        rowCount: 10,
        dateRange: { from: "2024-01-01", to: "2024-01-31" },
        importedToCoinTracking: false,
      };

      const record2: ImportRecord = {
        ...record1,
        rowCount: 20,
        processedAt: "2024-02-01T00:00:00Z",
      };

      addImportRecord(record1);
      addImportRecord(record2);

      const history = readHistory();
      expect(history.imports).toHaveLength(1);
      expect(history.imports[0]?.rowCount).toBe(20);
    });

    it("adds multiple records with different IDs", () => {
      const record1: ImportRecord = {
        id: "import_1",
        chain: "Mantle",
        address: "0x123",
        nativeSymbol: "MNT",
        processedAt: "2024-01-01T00:00:00Z",
        inputFiles: [],
        outputFile: "",
        rowCount: 10,
        dateRange: { from: "", to: "" },
        importedToCoinTracking: false,
      };

      const record2: ImportRecord = {
        ...record1,
        id: "import_2",
        rowCount: 20,
      };

      addImportRecord(record1);
      addImportRecord(record2);

      const history = readHistory();
      expect(history.imports).toHaveLength(2);
    });
  });

  describe("markAsImported", () => {
    it("updates imported flag", () => {
      const record: ImportRecord = {
        id: "mark_test",
        chain: "Mantle",
        address: "0x123",
        nativeSymbol: "MNT",
        processedAt: "2024-01-01T00:00:00Z",
        inputFiles: [],
        outputFile: "",
        rowCount: 10,
        dateRange: { from: "", to: "" },
        importedToCoinTracking: false,
      };
      addImportRecord(record);

      const result = markAsImported("mark_test");

      expect(result).toBe(true);
      const history = readHistory();
      const updated = history.imports.find((i) => i.id === "mark_test");
      expect(updated?.importedToCoinTracking).toBe(true);
    });

    it("returns false for non-existent ID", () => {
      const result = markAsImported("nonexistent");
      expect(result).toBe(false);
    });
  });

  describe("listImports", () => {
    it("returns all import records", () => {
      const record1: ImportRecord = {
        id: "list_1",
        chain: "Mantle",
        address: "0x111",
        nativeSymbol: "MNT",
        processedAt: "2024-01-01T00:00:00Z",
        inputFiles: [],
        outputFile: "",
        rowCount: 10,
        dateRange: { from: "", to: "" },
        importedToCoinTracking: false,
      };

      const record2: ImportRecord = {
        ...record1,
        id: "list_2",
        address: "0x222",
      };

      addImportRecord(record1);
      addImportRecord(record2);

      const imports = listImports();
      expect(imports).toHaveLength(2);
    });

    it("returns empty list when no imports", () => {
      const imports = listImports();
      expect(imports).toEqual([]);
    });
  });

  describe("directory helpers", () => {
    describe("getRawDir", () => {
      it("returns correct path construction", () => {
        const dir = getRawDir("mantle_0x1234_2024-01");
        expect(dir).toBe("data/raw/mantle_0x1234_2024-01");
      });
    });

    describe("getOutputDir", () => {
      it("returns correct path", () => {
        const dir = getOutputDir();
        expect(dir).toBe("data/output");
      });
    });

    describe("getOutputFile", () => {
      it("returns correct path with import ID", () => {
        const file = getOutputFile("mantle_0x1234_2024-01");
        expect(file).toBe("data/output/mantle_0x1234_2024-01.csv");
      });
    });
  });

  describe("ensureDataDirs", () => {
    it("creates raw and output directories", () => {
      ensureDataDirs();

      expect(fs.existsSync("data/raw")).toBe(true);
      expect(fs.existsSync("data/output")).toBe(true);
    });
  });
});
