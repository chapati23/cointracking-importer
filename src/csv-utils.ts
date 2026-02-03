import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import fs from "node:fs";
import type { CoinTrackingRow, CsvRow } from "./types.js";
import { COINTRACKING_HEADERS } from "./types.js";

// ---------- CSV Reading ----------

/**
 * Read a CSV file and return parsed rows as records.
 */
export function readCsv(filePath: string): CsvRow[] {
  const content = fs.readFileSync(filePath, "utf8");
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    relax_column_count: true,
  }) as CsvRow[];
}

/**
 * Get headers from a CSV file without parsing all content.
 */
export function getCsvHeaders(filePath: string): string[] {
  const content = fs.readFileSync(filePath, "utf8");
  const firstLine = content.split("\n")[0];
  if (!firstLine) return [];

  // Parse just the first line to get headers
  const parsed = parse(firstLine, {
    columns: false,
    skip_empty_lines: true,
    trim: true,
  }) as string[][];

  return parsed[0] ?? [];
}

// ---------- CSV Writing ----------

/**
 * Convert CoinTrackingRow objects to CSV string.
 */
export function toCoinTrackingCsv(rows: CoinTrackingRow[]): string {
  const records = rows.map((r) => [
    r.Type,
    r.BuyAmount,
    r.BuyCurrency,
    r.SellAmount,
    r.SellCurrency,
    r.Fee,
    r.FeeCurrency,
    r.Exchange,
    r.TradeGroup,
    r.Comment,
    r.Date,
  ]);

  return stringify(records, {
    header: true,
    columns: [...COINTRACKING_HEADERS],
  });
}

/**
 * Write CoinTracking CSV to file.
 */
export function writeCoinTrackingCsv(filePath: string, rows: CoinTrackingRow[]): void {
  const csv = toCoinTrackingCsv(rows);
  fs.writeFileSync(filePath, csv, "utf8");
}

// ---------- File System Helpers ----------

export function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function listCsvFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath)
    .filter((f) => f.endsWith(".csv"))
    .map((f) => `${dirPath}/${f}`);
}
