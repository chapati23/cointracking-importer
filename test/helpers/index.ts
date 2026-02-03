/**
 * Test helpers for cointracking-evm-importer tests.
 *
 * These utilities provide common functionality for creating mock data,
 * setting up test environments, and verifying outputs.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CoinTrackingRow, ConvertConfig, CsvRow, ImportManifest } from "../../src/types.js";
import { toAddress } from "../../src/types.js";

// ---------- Test Constants ----------

export const TEST_USER_ADDRESS = toAddress("0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
export const TEST_OTHER_ADDRESS = toAddress("0x1111111111111111111111111111111111111111");
export const TEST_ZERO_ADDRESS = toAddress("0x0000000000000000000000000000000000000000");

// ---------- Mock Config ----------

/**
 * Create a standard test config with default values.
 */
export function mockConfig(overrides?: Partial<ConvertConfig>): ConvertConfig {
  return {
    address: TEST_USER_ADDRESS,
    nativeSymbol: "MNT",
    exchange: "Mantle",
    ...overrides,
  };
}

// ---------- Mock CSV Rows ----------

/**
 * Create a mock native transaction CSV row.
 */
export function createMockNativeRow(overrides?: Partial<Record<string, string>>): CsvRow {
  return {
    "Transaction Hash": "0xabc123",
    "DateTime (UTC)": "2024-12-04 12:00:00",
    From: TEST_USER_ADDRESS,
    To: TEST_OTHER_ADDRESS,
    "Value_IN(MNT)": "0",
    "Value_OUT(MNT)": "100",
    "TxnFee(MNT)": "0.001",
    Method: "Transfer",
    ...overrides,
  };
}

/**
 * Create a mock token transfer CSV row.
 */
export function createMockTokenRow(overrides?: Partial<Record<string, string>>): CsvRow {
  return {
    "Transaction Hash": "0xdef456",
    "DateTime (UTC)": "2024-12-04 12:00:00",
    From: TEST_USER_ADDRESS,
    To: TEST_OTHER_ADDRESS,
    TokenValue: "100",
    TokenSymbol: "USDC",
    TokenName: "USD Coin",
    ContractAddress: "0xusdc",
    ...overrides,
  };
}

/**
 * Create a mock internal transaction CSV row.
 */
export function createMockInternalRow(overrides?: Partial<Record<string, string>>): CsvRow {
  return {
    "Transaction Hash": "0xghi789",
    "DateTime (UTC)": "2024-12-04 12:00:00",
    From: TEST_OTHER_ADDRESS,
    To: TEST_USER_ADDRESS,
    "Value_IN(MNT)": "50",
    "Value_OUT(MNT)": "0",
    ParentTxFrom: "0xparent",
    ContractAddress: "0xcontract",
    ...overrides,
  };
}

/**
 * Create a mock NFT transfer CSV row.
 */
export function createMockNftRow(overrides?: Partial<Record<string, string>>): CsvRow {
  return {
    "Transaction Hash": "0xnft123",
    "DateTime (UTC)": "2024-12-04 12:00:00",
    From: TEST_OTHER_ADDRESS,
    To: TEST_USER_ADDRESS,
    TokenId: "1234",
    TokenSymbol: "BAYC",
    TokenName: "Bored Ape Yacht Club",
    ContractAddress: "0xbayc",
    ...overrides,
  };
}

// ---------- Temp Directory Management ----------

/**
 * Create a unique temporary fixture directory.
 */
export function createTempFixtureDir(prefix: string = "test-fixture-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Clean up a temporary directory.
 */
export function cleanupTempDir(dir: string): void {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true });
  }
}

// ---------- Comparison Helpers ----------

/**
 * Deep comparison helper for CoinTracking rows.
 */
export function compareCoinTrackingRows(
  actual: CoinTrackingRow,
  expected: Partial<CoinTrackingRow>
): boolean {
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key as keyof CoinTrackingRow] !== value) {
      return false;
    }
  }
  return true;
}

// ---------- Manifest Verification ----------

/**
 * Verify manifest.json structure and contents.
 * Returns the parsed manifest for further inspection.
 */
export function verifyManifest(manifestPath: string): ImportManifest {
  const content = fs.readFileSync(manifestPath, "utf8");
  const parsed = JSON.parse(content) as unknown;

  // Validate it's an object
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Manifest is not a valid object");
  }

  // Type assertion after validation
  const manifest = parsed as ImportManifest;

  // Validate required fields exist (runtime check for malformed files)
  if (!("chain" in manifest) || !manifest.chain) {
    throw new Error("Manifest missing chain");
  }
  if (!("address" in manifest) || !manifest.address) {
    throw new Error("Manifest missing address");
  }

  return manifest;
}

/**
 * Verify import folder structure.
 */
export function verifyImportFolder(importPath: string): {
  hasInput: boolean;
  hasOutput: boolean;
  hasManifest: boolean;
  inputFiles: string[];
  outputFile: string | null;
} {
  const inputDir = path.join(importPath, "input");
  const outputDir = path.join(importPath, "output");
  const manifestPath = path.join(importPath, "manifest.json");

  const hasInput = fs.existsSync(inputDir);
  const hasOutput = fs.existsSync(outputDir);
  const hasManifest = fs.existsSync(manifestPath);

  const inputFiles = hasInput ? fs.readdirSync(inputDir) : [];
  const outputFiles = hasOutput ? fs.readdirSync(outputDir) : [];
  const outputFile = outputFiles.find((f) => f.endsWith(".csv")) ?? null;

  return {
    hasInput,
    hasOutput,
    hasManifest,
    inputFiles,
    outputFile,
  };
}

// ---------- Mock Data Writers ----------

/**
 * Write a mock saved addresses config file.
 */
export function mockSavedAddresses(
  dir: string,
  addresses: Array<{ name: string; address: string }>
): void {
  const localDir = path.join(dir, ".local");
  fs.mkdirSync(localDir, { recursive: true });
  fs.writeFileSync(path.join(localDir, "addresses.json"), JSON.stringify({ addresses }), "utf8");
}

/**
 * Create a complete test fixture directory with all file types.
 */
export function createCompleteFixtures(dir: string, userAddress: string = TEST_USER_ADDRESS): void {
  // Native transactions
  const nativeContent = `"Transaction Hash","DateTime (UTC)","From","To","Value_IN(MNT)","Value_OUT(MNT)","TxnFee(MNT)","Method"
"0xnative1","2024-12-04 12:00:00","${userAddress}","0xreceiver","0","100","0.001","Transfer"
"0xnative2","2024-12-04 13:00:00","0xsender","${userAddress}","50","0","0","Deposit"`;

  // Token transfers
  const tokensContent = `"Transaction Hash","DateTime (UTC)","From","To","TokenValue","TokenSymbol","TokenName","ContractAddress"
"0xtoken1","2024-12-04 14:00:00","${userAddress}","0xrouter","100","USDC","USD Coin","0xusdc"
"0xtoken1","2024-12-04 14:00:00","0xrouter","${userAddress}","0.05","WETH","Wrapped Ether","0xweth"`;

  // Internal transactions
  const internalContent = `"Transaction Hash","DateTime (UTC)","From","To","Value_IN(MNT)","Value_OUT(MNT)","ParentTxFrom","ContractAddress"
"0xinternal1","2024-12-04 15:00:00","0xcontract","${userAddress}","10","0","0xparent","0xcontract"`;

  // NFT transfers (ERC-721)
  const nft721Content = `"Transaction Hash","DateTime (UTC)","From","To","TokenId","TokenSymbol","TokenName","ContractAddress"
"0xnft721","2024-12-04 16:00:00","0x0000000000000000000000000000000000000000","${userAddress}","1234","BAYC","Bored Ape","0xbayc"`;

  // NFT transfers (ERC-1155)
  const nft1155Content = `"Transaction Hash","DateTime (UTC)","From","To","TokenId","TokenValue","TokenSymbol","TokenName","ContractAddress"
"0xnft1155","2024-12-04 17:00:00","0xsender","${userAddress}","5678","5","ITEM","Game Item","0xitem"`;

  fs.writeFileSync(path.join(dir, "native.csv"), nativeContent);
  fs.writeFileSync(path.join(dir, "tokens.csv"), tokensContent);
  fs.writeFileSync(path.join(dir, "internal.csv"), internalContent);
  fs.writeFileSync(path.join(dir, "nft721.csv"), nft721Content);
  fs.writeFileSync(path.join(dir, "nft1155.csv"), nft1155Content);
}
