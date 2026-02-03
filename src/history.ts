import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, type HistoryData, type ImportRecord } from "./types.js";
const HISTORY_FILE = path.join(DATA_DIR, "history.json");

// ---------- Read/Write History ----------

export function readHistory(): HistoryData {
  if (!fs.existsSync(HISTORY_FILE)) {
    return { imports: [] };
  }
  const content = fs.readFileSync(HISTORY_FILE, "utf8");
  return JSON.parse(content) as HistoryData;
}

export function writeHistory(data: HistoryData): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2), "utf8");
}

// ---------- Import Record Management ----------

export function addImportRecord(record: ImportRecord): void {
  const history = readHistory();

  // Replace existing record with same ID or add new
  const existingIndex = history.imports.findIndex((i) => i.id === record.id);
  if (existingIndex !== -1) {
    history.imports[existingIndex] = record;
  } else {
    history.imports.push(record);
  }

  writeHistory(history);
}

export function markAsImported(id: string): boolean {
  const history = readHistory();
  const record = history.imports.find((i) => i.id === id);
  if (!record) return false;

  record.importedToCoinTracking = true;
  writeHistory(history);
  return true;
}

export function listImports(): ImportRecord[] {
  return readHistory().imports;
}

// ---------- ID Generation ----------

/**
 * Generate import ID from chain, address prefix, and date.
 * Format: chain_addressPrefix_yearMonth
 */
export function generateImportId(chain: string, address: string, dateStr?: string): string {
  const chainLower = chain.toLowerCase();
  const addressPrefix = address.slice(0, 10).toLowerCase();
  const date = dateStr ?? new Date().toISOString().slice(0, 7); // YYYY-MM
  return `${chainLower}_${addressPrefix}_${date.slice(0, 7)}`;
}

// ---------- Directory Paths ----------

export function getRawDir(importId: string): string {
  return path.join(DATA_DIR, "raw", importId);
}

export function getOutputDir(): string {
  return path.join(DATA_DIR, "output");
}

export function getOutputFile(importId: string): string {
  return path.join(getOutputDir(), `${importId}.csv`);
}

export function ensureDataDirs(): void {
  fs.mkdirSync(path.join(DATA_DIR, "raw"), { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, "output"), { recursive: true });
}
