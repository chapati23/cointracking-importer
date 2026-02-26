#!/usr/bin/env node

/**
 * CLI for fetching transaction data from Etherscan-compatible APIs
 * and converting it to CSV files for the cointracking-importer pipeline.
 *
 * Usage:
 *   npm run fetch -- --address 0x... --chain Zora --api-url https://explorer.zora.energy/api
 *   npm run fetch -- --address 0x... --chain Zora  # uses built-in API URL for known chains
 */

import fs from "node:fs";
import path from "node:path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { fetchAndGenerateCsvs, type FetchResult } from "./fetchers/etherscan-compat.js";

// ---------- Known Chain Configurations ----------

interface ChainConfig {
  apiUrl: string;
  nativeSymbol: string;
}

const KNOWN_CHAINS: Record<string, ChainConfig> = {
  zora: {
    apiUrl: "https://explorer.zora.energy/api",
    nativeSymbol: "ETH",
  },
  ethereum: {
    apiUrl: "https://api.etherscan.io/api",
    nativeSymbol: "ETH",
  },
  base: {
    apiUrl: "https://api.basescan.org/api",
    nativeSymbol: "ETH",
  },
  optimism: {
    apiUrl: "https://api-optimistic.etherscan.io/api",
    nativeSymbol: "ETH",
  },
  arbitrum: {
    apiUrl: "https://api.arbiscan.io/api",
    nativeSymbol: "ETH",
  },
  polygon: {
    apiUrl: "https://api.polygonscan.com/api",
    nativeSymbol: "POL",
  },
  mantle: {
    apiUrl: "https://explorer.mantle.xyz/api",
    nativeSymbol: "MNT",
  },
};

// ---------- CLI ----------

interface FetchOptions {
  address: string;
  chain: string;
  apiUrl?: string;
  nativeSymbol?: string;
  output?: string;
  verbose?: boolean;
  convert?: boolean;
}

async function runFetch(opts: FetchOptions): Promise<void> {
  const chainLower = opts.chain.toLowerCase();
  const knownChain = KNOWN_CHAINS[chainLower];

  const apiUrl = opts.apiUrl ?? knownChain?.apiUrl;
  if (!apiUrl) {
    console.error(
      `Error: Unknown chain "${opts.chain}". Provide --api-url or use a known chain: ${Object.keys(KNOWN_CHAINS).join(", ")}`
    );
    process.exit(1);
  }

  const nativeSymbol = opts.nativeSymbol ?? knownChain?.nativeSymbol ?? "ETH";
  const addressShort = `${opts.address.slice(0, 6)}...${opts.address.slice(-4)}`;
  const outputDir = opts.output ?? path.join("data", "raw", chainLower, addressShort);

  console.log(`\nFetching ${opts.chain} transactions for ${opts.address}`);
  console.log(`  API: ${apiUrl}`);
  console.log(`  Native symbol: ${nativeSymbol}`);
  console.log(`  Output: ${outputDir}\n`);

  const result = await fetchAndGenerateCsvs({
    apiBaseUrl: apiUrl,
    address: opts.address,
    nativeSymbol,
    chain: opts.chain,
    outputDir,
    verbose: opts.verbose,
  });

  console.log(`\n✓ Fetch complete:`);
  console.log(`  Native transactions: ${result.nativeTxCount}`);
  console.log(`  Token transfers: ${result.tokenTxCount}`);
  console.log(`  Internal transactions: ${result.internalTxCount}`);

  if (result.nativeTxCount + result.tokenTxCount + result.internalTxCount === 0) {
    console.log("\n⚠ No transactions found for this address.");
    return;
  }

  // Show convert command
  const csvFiles = [result.nativeFile, result.tokensFile, result.internalFile].filter(Boolean);
  console.log(`\nCSV files written to: ${outputDir}`);
  for (const f of csvFiles) {
    console.log(`  ${f}`);
  }

  console.log(`\nTo convert to CoinTracking format:`);
  console.log(
    `  npm run convert -- --address ${opts.address} --chain ${opts.chain} --nativeSymbol ${nativeSymbol} \\`
  );

  const flagMap: Record<string, string> = {
    nativeFile: "--native",
    tokensFile: "--tokens",
    internalFile: "--internal",
  };

  for (const [key, flag] of Object.entries(flagMap)) {
    const file = result[key as keyof FetchResult];
    if (typeof file === "string") {
      console.log(`    ${flag} ${file} \\`);
    }
  }
  console.log(`    --test --verbose`);

  // Auto-convert if requested
  if (opts.convert) {
    console.log(`\n--- Auto-converting to CoinTracking format ---\n`);
    await autoConvert(result, opts, nativeSymbol);
  }
}

async function autoConvert(
  fetchResult: FetchResult,
  opts: FetchOptions,
  nativeSymbol: string
): Promise<void> {
  // Dynamically import to avoid circular deps
  const { readCsv, writeCoinTrackingCsv } = await import("./csv-utils.js");
  const { parseNativeRows, indexNativeByHash, transformNativeRows } =
    await import("./transformers/native.js");
  const { transformTokenRows } = await import("./transformers/tokens.js");
  const { transformInternalRows } = await import("./transformers/internal.js");
  const { resolveNativeSymbol, resolveTokenSymbol } = await import("./symbol-overrides.js");
  const { toAddress } = await import("./types.js");
  const { saveImport } = await import("./import-storage.js");
  const { detectCsvTypeFromFile, getCsvTypeName } = await import("./detect.js");
  const dayjsModule = await import("dayjs");
  const dayjs = dayjsModule.default;

  const resolvedNativeSymbol = resolveNativeSymbol(opts.chain, nativeSymbol);

  const config = {
    address: toAddress(opts.address),
    nativeSymbol: resolvedNativeSymbol,
    exchange: opts.chain,
    verbose: opts.verbose,
  };

  // Read CSVs
  const nativeRows = fetchResult.nativeFile ? readCsv(fetchResult.nativeFile) : [];
  const tokenRows = fetchResult.tokensFile ? readCsv(fetchResult.tokensFile) : [];
  const internalRows = fetchResult.internalFile ? readCsv(fetchResult.internalFile) : [];

  // Parse and transform
  const parsedNative = parseNativeRows(nativeRows);
  const nativeByHash = indexNativeByHash(parsedNative);
  const processedFeeHashes = new Set<import("./types.js").TxHash>();
  const allRows: import("./types.js").CoinTrackingRow[] = [];

  const tokenResult = transformTokenRows(tokenRows, config, nativeByHash, processedFeeHashes);
  allRows.push(...tokenResult.rows);

  const nativeResult = transformNativeRows(
    nativeRows,
    config,
    processedFeeHashes,
    tokenResult.processedHashes
  );
  allRows.push(...nativeResult);

  const internalResult = transformInternalRows(
    internalRows,
    config,
    nativeByHash,
    processedFeeHashes
  );
  allRows.push(...internalResult);

  // Normalize symbols
  for (const row of allRows) {
    row.BuyCurrency = resolveTokenSymbol(row.BuyCurrency);
    row.SellCurrency = resolveTokenSymbol(row.SellCurrency);
    row.FeeCurrency = resolveTokenSymbol(row.FeeCurrency);
  }

  // Sort by date
  allRows.sort((a, b) => dayjs(a.Date).valueOf() - dayjs(b.Date).valueOf());

  // Determine output path
  const addressShort = `${opts.address.slice(0, 6)}...${opts.address.slice(-4)}`;
  const chainLower = opts.chain.toLowerCase();
  const outputDir = path.join("data", "test-imports", chainLower, addressShort);
  fs.mkdirSync(path.join(outputDir, "output"), { recursive: true });
  const outputPath = path.join(outputDir, "output", "cointracking.csv");

  writeCoinTrackingCsv(outputPath, allRows);

  console.log(`\n✓ Converted ${allRows.length} rows → ${outputPath}`);
  console.log(`  Token transfers/swaps: ${tokenResult.rows.length}`);
  console.log(`  Native transactions: ${nativeResult.length}`);
  console.log(`  Internal transactions: ${internalResult.length}`);

  // Save import
  const detectedFiles = [fetchResult.nativeFile, fetchResult.tokensFile, fetchResult.internalFile]
    .filter((f): f is string => !!f)
    .map((f) => ({
      path: f,
      type: detectCsvTypeFromFile(f),
      typeName: getCsvTypeName(detectCsvTypeFromFile(f)),
    }));

  if (detectedFiles.length > 0) {
    const { importPath } = saveImport({
      chain: opts.chain,
      address: toAddress(opts.address),
      inputFiles: detectedFiles,
      outputPath,
      outputRowCount: allRows.length,
      testMode: true,
    });
    console.log(`  Import saved to: ${importPath} (test)`);
  }
}

async function main(): Promise<void> {
  const argv = await yargs(hideBin(process.argv))
    .option("address", {
      type: "string",
      describe: "Wallet address (0x...)",
      demandOption: true,
    })
    .option("chain", {
      type: "string",
      describe: `Chain name (known: ${Object.keys(KNOWN_CHAINS).join(", ")})`,
      demandOption: true,
    })
    .option("api-url", {
      type: "string",
      describe: "Etherscan-compatible API URL (auto-detected for known chains)",
    })
    .option("nativeSymbol", {
      type: "string",
      describe: "Native token symbol (auto-detected for known chains)",
    })
    .option("output", {
      type: "string",
      describe: "Output directory for CSV files",
    })
    .option("convert", {
      type: "boolean",
      describe: "Auto-convert to CoinTracking format after fetching",
      default: false,
    })
    .option("verbose", {
      type: "boolean",
      describe: "Show detailed output",
      default: false,
    })
    .help()
    .alias("h", "help")
    .strict()
    .parseAsync();

  await runFetch(argv as unknown as FetchOptions);
}

main().catch((error: unknown) => {
  console.error("Error:", error);
  process.exit(1);
});
