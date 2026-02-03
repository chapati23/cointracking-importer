import fs from "node:fs";
import path from "node:path";

import { readCsv } from "./csv-utils.js";
import { getFieldByKey } from "./field-mapping.js";
import { getSavedAddresses, type SavedAddress } from "./local-config.js";
import type { CsvType, DetectedFile, ImportManifest } from "./types.js";

// ---------- Constants ----------

const DATA_DIR = "data";
const IMPORTS_DIR = path.join(DATA_DIR, "imports");

// ---------- Address Path Formatting ----------

/**
 * Format address for use in folder path.
 * If address has a saved name, returns "name_0x1234...5678"
 * Otherwise returns just "0x1234...5678"
 */
export function formatAddressPath(address: string): string {
  const savedAddresses = getSavedAddresses();
  const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
  const saved = savedAddresses.find(
    (a: SavedAddress) => a.address.toLowerCase() === address.toLowerCase()
  );
  return saved ? `${saved.name}_${short}` : short;
}

// ---------- Date Range Extraction ----------

/**
 * Extract the date range from CSV files by scanning the DateTime column.
 * Returns the oldest and newest dates found.
 */
export function extractDateRange(files: DetectedFile[]): { from: string; to: string } {
  const dates: string[] = [];

  for (const file of files) {
    if (file.type === "unknown") continue;

    try {
      const rows = readCsv(file.path);
      for (const row of rows) {
        const dateTime = getFieldByKey(row, "dateTime");
        if (dateTime) {
          // Extract just the date part (YYYY-MM-DD)
          const datePart = dateTime.split(" ")[0];
          if (datePart && /^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
            dates.push(datePart);
          }
        }
      }
    } catch {
      // Skip files that can't be read
    }
  }

  if (dates.length === 0) {
    const today = new Date().toISOString().split("T")[0] ?? "";
    return { from: today, to: today };
  }

  dates.sort();
  return {
    from: dates[0] ?? "",
    to: dates[dates.length - 1] ?? "",
  };
}

// ---------- Manifest Generation ----------

/**
 * Generate a manifest object for the import.
 */
export function generateManifest(opts: {
  chain: string;
  address: string;
  dateRange: { from: string; to: string };
  files: DetectedFile[];
  outputRowCount: number;
}): ImportManifest {
  const savedAddresses = getSavedAddresses();
  const saved = savedAddresses.find(
    (a: SavedAddress) => a.address.toLowerCase() === opts.address.toLowerCase()
  );

  const filesRecord: ImportManifest["files"] = {};
  for (const file of opts.files) {
    if (file.type === "unknown") continue;

    // Count rows in the file
    let txCount = 0;
    try {
      const rows = readCsv(file.path);
      txCount = rows.length;
    } catch {
      // If we can't read, default to 0
    }

    filesRecord[file.type] = {
      originalPath: file.path,
      txCount,
    };
  }

  return {
    importedAt: new Date().toISOString(),
    chain: opts.chain,
    address: opts.address,
    addressName: saved?.name,
    dateRange: opts.dateRange,
    files: filesRecord,
    output: {
      file: "output/cointracking.csv",
      rowCount: opts.outputRowCount,
    },
  };
}

// ---------- Import Storage ----------

/**
 * Create a unique folder name for the date range.
 * If folder exists, appends timestamp.
 */
function getUniqueDateRangeFolder(
  basePath: string,
  dateRange: { from: string; to: string }
): string {
  const folderName =
    dateRange.from === dateRange.to ? dateRange.from : `${dateRange.from}_${dateRange.to}`;

  const fullPath = path.join(basePath, folderName);

  if (!fs.existsSync(fullPath)) {
    return fullPath;
  }

  // Add timestamp suffix for duplicate
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return path.join(basePath, `${folderName}_${timestamp}`);
}

/**
 * Get the CSV filename based on type.
 */
function getCsvFilename(type: Exclude<CsvType, "unknown">): string {
  return `${type}.csv`;
}

export interface SaveImportOptions {
  chain: string;
  address: string;
  inputFiles: DetectedFile[];
  outputPath: string;
  outputRowCount: number;
}

export interface SaveImportResult {
  importPath: string;
  manifest: ImportManifest;
}

/**
 * Save import files to organized folder structure.
 *
 * Structure:
 * data/imports/<chain>/<name>_<address-short>/<date-range>/
 *   input/
 *     native.csv
 *     tokens.csv
 *     ...
 *   output/
 *     cointracking.csv
 *   manifest.json
 */
export function saveImport(opts: SaveImportOptions): SaveImportResult {
  // Extract date range from input files
  const dateRange = extractDateRange(opts.inputFiles);

  // Build folder path
  const chainFolder = opts.chain.toLowerCase();
  const addressFolder = formatAddressPath(opts.address);
  const basePath = path.join(IMPORTS_DIR, chainFolder, addressFolder);

  // Ensure base path exists
  fs.mkdirSync(basePath, { recursive: true });

  // Get unique date range folder
  const importPath = getUniqueDateRangeFolder(basePath, dateRange);
  const inputPath = path.join(importPath, "input");
  const outputDir = path.join(importPath, "output");

  // Create directories
  fs.mkdirSync(inputPath, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  // Copy input files
  for (const file of opts.inputFiles) {
    if (file.type === "unknown") continue;

    const destFilename = getCsvFilename(file.type);
    const destPath = path.join(inputPath, destFilename);
    fs.copyFileSync(file.path, destPath);
  }

  // Copy output file
  const outputDest = path.join(outputDir, "cointracking.csv");
  fs.copyFileSync(opts.outputPath, outputDest);

  // Generate and write manifest
  const manifest = generateManifest({
    chain: opts.chain,
    address: opts.address,
    dateRange,
    files: opts.inputFiles,
    outputRowCount: opts.outputRowCount,
  });

  const manifestPath = path.join(importPath, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  return { importPath, manifest };
}
