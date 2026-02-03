import inquirer from "inquirer";
import fs from "node:fs";
import path from "node:path";
import { getCsvHeaders } from "./csv-utils.js";
import { detectCsvTypeFromFile, getCsvTypeName } from "./detect.js";
import { ensureDataDirs, generateImportId, getRawDir } from "./history.js";
import type { CsvType } from "./types.js";

// ---------- Address Extraction ----------

/**
 * Try to extract an address from CSV file content or filename.
 */
export function extractAddressFromFile(filePath: string): string | null {
  const fileName = path.basename(filePath).toLowerCase();

  // Try filename patterns like "export-0x..." or "export-address-token-0x..."
  const match = fileName.match(/0x[a-f0-9]{40}/i);
  if (match) {
    return match[0].toLowerCase();
  }

  // Try to find in CSV headers or first row
  const headers = getCsvHeaders(filePath);
  for (const h of headers) {
    const headerMatch = h.match(/0x[a-f0-9]{40}/i);
    if (headerMatch) {
      return headerMatch[0].toLowerCase();
    }
  }

  return null;
}

// ---------- File Type Naming ----------

const CSV_TYPE_FILENAMES: Record<CsvType, string> = {
  native: "native.csv",
  tokens: "tokens.csv",
  internal: "internal.csv",
  nft721: "nft721.csv",
  nft1155: "nft1155.csv",
  unknown: "unknown.csv",
};

// ---------- Ingest Logic ----------

interface IngestResult {
  importId: string;
  targetDir: string;
  files: { source: string; target: string; type: CsvType }[];
}

export async function ingestFiles(filePaths: string[]): Promise<IngestResult | null> {
  if (filePaths.length === 0) {
    console.log("No files provided.");
    return null;
  }

  // Detect types and extract addresses
  const fileInfos = filePaths.map((fp) => ({
    path: fp,
    type: detectCsvTypeFromFile(fp),
    address: extractAddressFromFile(fp),
  }));

  // Display detected info
  console.log("\nDetected files:");
  for (const info of fileInfos) {
    console.log(`  → ${path.basename(info.path)}`);
    console.log(`    Type: ${getCsvTypeName(info.type)}`);
    if (info.address) {
      console.log(`    Address: ${info.address}`);
    }
  }

  // Try to find common address
  const addresses = fileInfos.map((f) => f.address).filter(Boolean);
  const uniqueAddresses = [...new Set(addresses)];
  const detectedAddress = uniqueAddresses.length === 1 ? uniqueAddresses[0] : null;

  // Prompt for confirmation and missing info
  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "address",
      message: "Wallet address:",
      default: detectedAddress ?? undefined,
      validate: (v: string) =>
        v.startsWith("0x") && v.length === 42 ? true : "Enter a valid 0x address",
    },
    {
      type: "input",
      name: "chain",
      message: "Chain name:",
      default: "mantle",
    },
    {
      type: "input",
      name: "nativeSymbol",
      message: "Native token symbol:",
      default: "MNT",
    },
    {
      type: "input",
      name: "yearMonth",
      message: "Year-month for this import (YYYY-MM):",
      default: new Date().toISOString().slice(0, 7),
      validate: (v: string) => (/^\d{4}-\d{2}$/.test(v) ? true : "Use format YYYY-MM"),
    },
  ]);

  const importId = generateImportId(
    answers.chain as string,
    answers.address as string,
    answers.yearMonth as string
  );
  const targetDir = getRawDir(importId);

  // Create directories
  ensureDataDirs();
  fs.mkdirSync(targetDir, { recursive: true });

  // Copy and rename files
  const results: IngestResult["files"] = [];
  const usedTypes = new Set<CsvType>();

  for (const info of fileInfos) {
    let targetName = CSV_TYPE_FILENAMES[info.type];

    // Handle duplicates by adding suffix
    if (usedTypes.has(info.type)) {
      const base = targetName.replace(".csv", "");
      let i = 2;
      while (fs.existsSync(path.join(targetDir, `${base}_${i}.csv`))) {
        i++;
      }
      targetName = `${base}_${i}.csv`;
    } else {
      usedTypes.add(info.type);
    }

    const targetPath = path.join(targetDir, targetName);
    fs.copyFileSync(info.path, targetPath);
    results.push({ source: info.path, target: targetPath, type: info.type });
    console.log(`  → Copied to ${targetPath}`);
  }

  console.log(`\n✓ Ingested ${results.length} files to ${targetDir}`);
  console.log(`  Import ID: ${importId}`);
  console.log(`  Run: npm run convert ${targetDir}`);

  return {
    importId,
    targetDir,
    files: results,
  };
}
