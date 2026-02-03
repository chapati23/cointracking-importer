import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import inquirer from "inquirer";
import autocomplete from "inquirer-autocomplete-standalone";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { listCsvFiles, readCsv, writeCoinTrackingCsv } from "./csv-utils.js";
import { categorizeFiles, detectCsvTypeFromFile, getCsvTypeName } from "./detect.js";
import {
  addImportRecord,
  ensureDataDirs,
  getOutputFile,
  listImports,
  markAsImported,
} from "./history.js";
import { saveImport } from "./import-storage.js";
import { ingestFiles } from "./ingest.js";
import {
  formatAddressChoice,
  getSavedAddresses,
  saveAddress,
  type SavedAddress,
} from "./local-config.js";
import { getDefaultNativeSymbol, resolveNativeSymbol } from "./symbol-overrides.js";
import { transformInternalRows } from "./transformers/internal.js";
import { indexNativeByHash, parseNativeRows, transformNativeRows } from "./transformers/native.js";
import { transformNftRows } from "./transformers/nft.js";
import { transformTokenRows } from "./transformers/tokens.js";
import type {
  CoinTrackingRow,
  ConvertConfig,
  CsvType,
  DetectedFile,
  InputMode,
  TxHash,
} from "./types.js";
import { toAddress } from "./types.js";

dayjs.extend(utc);

// ---------- Utilities ----------

const isCsvFile = (name: string) => name.endsWith(".csv");

// ---------- File Path Autocomplete Helper ----------

interface FileChoice {
  value: string;
  name: string;
  description?: string;
}

/**
 * Creates a source function for file path autocomplete.
 * Works like terminal tab completion - type a path and get matching suggestions.
 */
function createFileSource(options: { basePath: string; filter?: (name: string) => boolean }) {
  // eslint-disable-next-line @typescript-eslint/require-await, sonarjs/cognitive-complexity -- library expects Promise; path resolution logic
  return async (input: string | undefined): Promise<FileChoice[]> => {
    // Expand ~ to home directory
    const expandPath = (p: string): string => {
      if (p.startsWith("~")) {
        return path.join(os.homedir(), p.slice(1));
      }
      return p;
    };

    // If no input yet, show contents of basePath
    const rawInput = input ?? "";
    const expandedInput = expandPath(rawInput);

    // Determine what directory to list and what prefix to filter by
    let dirToList: string;
    let filterPrefix: string;

    if (rawInput === "") {
      // No input - show basePath contents
      dirToList = options.basePath;
      filterPrefix = "";
    } else if (expandedInput.endsWith("/") || expandedInput.endsWith(path.sep)) {
      // Input ends with / - list that directory
      dirToList = expandedInput;
      filterPrefix = "";
    } else {
      // Input is partial - list parent and filter by basename
      dirToList = path.dirname(expandedInput);
      filterPrefix = path.basename(expandedInput).toLowerCase();
    }

    // Ensure dirToList is absolute
    if (!path.isAbsolute(dirToList)) {
      dirToList = path.resolve(options.basePath, dirToList);
    }

    try {
      const entries = fs.readdirSync(dirToList, { withFileTypes: true });

      const choices: FileChoice[] = [];

      for (const entry of entries) {
        // Skip hidden files
        if (entry.name.startsWith(".")) continue;

        // Filter by prefix if provided
        if (filterPrefix && !entry.name.toLowerCase().startsWith(filterPrefix)) {
          continue;
        }

        const fullPath = path.join(dirToList, entry.name);
        const isDir = entry.isDirectory();

        // Apply file filter (only to files, not directories)
        if (!isDir && options.filter && !options.filter(entry.name)) {
          continue;
        }

        choices.push({
          value: isDir ? fullPath + "/" : fullPath,
          name: isDir ? `${entry.name}/` : entry.name,
          description: isDir ? "Directory" : undefined,
        });
      }

      // Sort: directories first, then alphabetically
      choices.sort((a, b) => {
        const aIsDir = a.name.endsWith("/");
        const bIsDir = b.name.endsWith("/");
        if (aIsDir && !bIsDir) return -1;
        if (!aIsDir && bIsDir) return 1;
        return a.name.localeCompare(b.name);
      });

      return choices;
    } catch {
      // Directory doesn't exist or can't be read
      return [];
    }
  };
}

/**
 * Prompt for a file path with tab completion.
 * Returns the selected path or undefined if cancelled.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- interactive loop with multiple exit conditions
async function promptFilePath(options: {
  message: string;
  basePath: string;
  filter?: (name: string) => boolean;
}): Promise<string | undefined> {
  let currentBase = options.basePath;

  // Loop until user selects a file (not a directory) or cancels
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    try {
      const result = await autocomplete({
        message: `${options.message} [${currentBase}]`,
        source: createFileSource({
          basePath: currentBase,
          filter: options.filter,
        }),
        emptyText: "No matching files found.",
      });

      const selected = typeof result === "string" ? result.trim() : "";
      if (!selected) {
        return undefined;
      }

      // Check if the selected path is a directory
      try {
        const stat = fs.statSync(selected);
        if (stat.isDirectory()) {
          // Update base path and continue prompting from within this directory
          currentBase = selected.endsWith("/") ? selected : selected + "/";
          continue;
        }
      } catch {
        // Path doesn't exist - let it through, will error later with a clearer message
      }

      return selected;
    } catch (error) {
      // Handle cancellation (Ctrl+C)
      if (error instanceof Error && error.name === "ExitPromptError") {
        return undefined;
      }
      throw error;
    }
  }
}

/**
 * Validate that a path is an existing CSV file (not a directory).
 * Returns an error message if invalid, or undefined if valid.
 */
function validateCsvPath(filePath: string, label: string): string | undefined {
  const stat = fs.statSync(filePath, { throwIfNoEntry: false });
  if (!stat) {
    return `Error: ${label} file not found: ${filePath}`;
  }
  if (stat.isDirectory()) {
    return `Error: ${label} path is a directory, not a file: ${filePath}`;
  }
  if (!filePath.toLowerCase().endsWith(".csv")) {
    return `Error: ${label} file must be a CSV file: ${filePath}`;
  }
  return undefined;
}

// ---------- Input Mode Selection ----------

/**
 * Prompt for input mode: single file, multiple files, or folder.
 */
async function promptInputMode(): Promise<InputMode> {
  const { mode } = await inquirer.prompt<{ mode: InputMode }>([
    {
      type: "list",
      name: "mode",
      message: "How would you like to import CSVs?",
      choices: [
        { name: "Single file", value: "single" },
        { name: "Multiple files", value: "multiple" },
        { name: "All CSVs from a folder", value: "folder" },
      ],
    },
  ]);
  return mode;
}

/**
 * Prompt for a folder path with tab completion.
 * Returns the selected directory path.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- interactive loop with multiple exit conditions
async function promptFolderPath(options: {
  message: string;
  basePath: string;
}): Promise<string | undefined> {
  let currentBase = options.basePath;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    try {
      const result = await autocomplete({
        message: `${options.message} [${currentBase}]`,
        source: createFileSource({
          basePath: currentBase,
          // Show only directories
          filter: () => false,
        }),
        emptyText: "No directories found.",
      });

      const selected = typeof result === "string" ? result.trim() : "";
      if (!selected) {
        return undefined;
      }

      // Check if the selected path is a directory
      try {
        const stat = fs.statSync(selected.replace(/\/$/, ""));
        if (stat.isDirectory()) {
          // Ask if user wants to select this directory or navigate into it
          const { action } = await inquirer.prompt<{ action: "select" | "navigate" }>([
            {
              type: "list",
              name: "action",
              message: `Selected: ${selected}`,
              choices: [
                { name: "Use this folder", value: "select" },
                { name: "Navigate into folder", value: "navigate" },
              ],
            },
          ]);

          if (action === "select") {
            return selected.replace(/\/$/, "");
          }
          // Navigate into the directory
          currentBase = selected.endsWith("/") ? selected : selected + "/";
          continue;
        }
      } catch {
        // Path doesn't exist
        return undefined;
      }
    } catch (error) {
      if (error instanceof Error && error.name === "ExitPromptError") {
        return undefined;
      }
      throw error;
    }
  }
}

/**
 * Prompt for multiple files with a loop.
 * Shows running list of selected files with detected types.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- multi-step interactive file selection
async function promptMultipleFiles(startDir: string): Promise<DetectedFile[]> {
  const files: DetectedFile[] = [];
  let lastDir = startDir;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    // Show current list if any files selected
    if (files.length > 0) {
      console.log("\nSelected files:");
      for (const f of files) {
        console.log(`  - ${path.basename(f.path)} → ${f.typeName}`);
      }
      console.log("");
    }

    const { action } = await inquirer.prompt<{ action: "add" | "remove" | "done" }>([
      {
        type: "list",
        name: "action",
        message: files.length === 0 ? "Add CSV files:" : "What would you like to do?",
        choices: [
          { name: "Add another file", value: "add" },
          ...(files.length > 0
            ? [
                { name: "Remove a file", value: "remove" as const },
                { name: "Done - proceed with import", value: "done" as const },
              ]
            : []),
        ],
      },
    ]);

    if (action === "done") {
      break;
    }

    if (action === "remove" && files.length > 0) {
      const { indexToRemove } = await inquirer.prompt<{ indexToRemove: number }>([
        {
          type: "list",
          name: "indexToRemove",
          message: "Select file to remove:",
          choices: files.map((f, i) => ({
            name: `${path.basename(f.path)} (${f.typeName})`,
            value: i,
          })),
        },
      ]);
      files.splice(indexToRemove, 1);
      continue;
    }

    // Add a file
    const selected = await promptFilePath({
      message: "Select CSV file (type path, tab to complete):",
      basePath: lastDir,
      filter: isCsvFile,
    });

    if (!selected) {
      // User cancelled file selection, continue loop
      continue;
    }

    const validationError = validateCsvPath(selected, "CSV");
    if (validationError) {
      console.error(validationError);
      continue;
    }

    // Detect type
    const type = detectCsvTypeFromFile(selected);
    const typeName = getCsvTypeName(type);

    // Check for duplicates
    if (files.some((f) => f.path === selected)) {
      console.log("File already added.");
      continue;
    }

    files.push({ path: selected, type, typeName });
    lastDir = path.dirname(selected);
    console.log(`Added: ${path.basename(selected)} → ${typeName}`);
  }

  return files;
}

/**
 * Collect files based on input mode and detect their types.
 */
async function collectAndDetectFiles(mode: InputMode, startDir: string): Promise<DetectedFile[]> {
  switch (mode) {
    case "single": {
      const selected = await promptFilePath({
        message: "Select CSV file (type path, tab to complete):",
        basePath: startDir,
        filter: isCsvFile,
      });

      if (!selected) {
        return [];
      }

      const validationError = validateCsvPath(selected, "CSV");
      if (validationError) {
        console.error(validationError);
        return [];
      }

      const type = detectCsvTypeFromFile(selected);
      return [{ path: selected, type, typeName: getCsvTypeName(type) }];
    }

    case "multiple": {
      return promptMultipleFiles(startDir);
    }

    case "folder": {
      const folderPath = await promptFolderPath({
        message: "Select folder containing CSV files:",
        basePath: startDir,
      });

      if (!folderPath) {
        return [];
      }

      const csvFiles = listCsvFiles(folderPath);
      if (csvFiles.length === 0) {
        console.log("No CSV files found in folder.");
        return [];
      }

      return csvFiles.map((filePath) => {
        const type = detectCsvTypeFromFile(filePath);
        return { path: filePath, type, typeName: getCsvTypeName(type) };
      });
    }
  }
}

/**
 * Display detection summary and ask for confirmation.
 * Returns filtered files (unknown files can be skipped).
 */
async function confirmDetectedFiles(files: DetectedFile[]): Promise<DetectedFile[] | null> {
  if (files.length === 0) {
    return null;
  }

  // Check for unknown files
  const unknownFiles = files.filter((f) => f.type === "unknown");
  const knownFiles = files.filter((f) => f.type !== "unknown");

  console.log("\n┌─────────────────────────────────────────────────────────────┐");
  console.log("│ Detected CSV Files                                          │");
  console.log("├─────────────────────────────────────────────────────────────┤");

  // Calculate max filename length for alignment
  const maxNameLen = Math.max(...files.map((f) => path.basename(f.path).length), 20);

  for (const f of files) {
    const name = path.basename(f.path).padEnd(maxNameLen);
    const typeDisplay = f.type === "unknown" ? `⚠ ${f.typeName}` : `✓ ${f.typeName}`;
    console.log(`│ ${name}  ${typeDisplay.padEnd(35)} │`);
  }
  console.log("└─────────────────────────────────────────────────────────────┘");

  // Handle unknown files
  if (unknownFiles.length > 0) {
    console.log(
      `\n⚠ Warning: ${unknownFiles.length} file(s) could not be identified and will be skipped:`
    );
    for (const f of unknownFiles) {
      console.log(`  - ${path.basename(f.path)}`);
    }

    if (knownFiles.length === 0) {
      console.log("\nNo valid CSV files to import.");
      return null;
    }
  }

  const { proceed } = await inquirer.prompt<{ proceed: boolean }>([
    {
      type: "confirm",
      name: "proceed",
      message: `Proceed with import of ${knownFiles.length} file(s)?`,
      default: true,
    },
  ]);

  return proceed ? knownFiles : null;
}

/**
 * Group detected files by type for processing.
 */
function groupFilesByType(files: DetectedFile[]): Record<Exclude<CsvType, "unknown">, string[]> {
  const result: Record<Exclude<CsvType, "unknown">, string[]> = {
    native: [],
    tokens: [],
    internal: [],
    nft721: [],
    nft1155: [],
  };

  for (const f of files) {
    if (f.type !== "unknown") {
      result[f.type].push(f.path);
    }
  }

  return result;
}

// ---------- Address Selection Helper ----------

interface AddressSelection {
  address: string;
  name?: string;
}

async function promptForAddress(): Promise<AddressSelection> {
  const savedAddresses = getSavedAddresses();

  // If no saved addresses, go straight to manual entry
  if (savedAddresses.length === 0) {
    return promptManualAddress();
  }

  // Ask if user wants to select from saved or enter manually
  const { method } = await inquirer.prompt<{ method: string }>([
    {
      type: "list",
      name: "method",
      message: "Wallet address:",
      choices: [
        { name: "Select from saved addresses", value: "saved" },
        { name: "Enter address manually", value: "manual" },
      ],
    },
  ]);

  if (method === "manual") {
    return promptManualAddress();
  }

  // Show saved addresses
  const choices = savedAddresses.map((entry) => ({
    name: formatAddressChoice(entry),
    value: entry,
  }));

  const { selected } = await inquirer.prompt<{ selected: SavedAddress }>([
    {
      type: "list",
      name: "selected",
      message: "Select address:",
      choices,
    },
  ]);

  return { address: selected.address, name: selected.name };
}

async function promptManualAddress(): Promise<AddressSelection> {
  const { address } = await inquirer.prompt<{ address: string }>([
    {
      type: "input",
      name: "address",
      message: "Wallet address:",
      validate: (v: string) =>
        v.startsWith("0x") && v.length === 42 ? true : "Enter a valid 0x address",
    },
  ]);

  // Check if this address is already saved
  const savedAddresses = getSavedAddresses();
  const existingSaved = savedAddresses.find(
    (a) => a.address.toLowerCase() === address.toLowerCase()
  );
  if (existingSaved) {
    return { address, name: existingSaved.name };
  }

  // Offer to save the address
  const { shouldSave } = await inquirer.prompt<{ shouldSave: boolean }>([
    {
      type: "confirm",
      name: "shouldSave",
      message: "Save this address for future use?",
      default: false,
    },
  ]);

  if (shouldSave) {
    const { addressName } = await inquirer.prompt<{ addressName: string }>([
      {
        type: "input",
        name: "addressName",
        message: "Name for this address:",
        validate: (v: string) => (v.trim().length > 0 ? true : "Enter a name"),
      },
    ]);

    saveAddress({ name: addressName.trim(), address });
    console.log(`✓ Saved address as "${addressName.trim()}"`);
    return { address, name: addressName.trim() };
  }

  return { address };
}

// ---------- Convert Command ----------

interface ConvertOptions {
  dir?: string;
  address?: string;
  chain?: string;
  nativeSymbol?: string;
  native?: string;
  tokens?: string;
  internal?: string;
  nft721?: string;
  nft1155?: string;
  output?: string;
  cutoff?: string;
  dryRun?: boolean;
  verbose?: boolean;
}

// eslint-disable-next-line sonarjs/cognitive-complexity -- main CLI command with extensive interactive flow
async function convertCommand(opts: ConvertOptions): Promise<void> {
  let nativeFile: string | undefined;
  let tokensFile: string | undefined;
  let internalFile: string | undefined;
  let nft721File: string | undefined;
  let nft1155File: string | undefined;
  let importId: string | undefined;
  let detectedFiles: DetectedFile[] = [];

  // Determine if we're in fully interactive mode (no files specified via CLI)
  const isCliMode = !!(opts.native || opts.tokens || opts.internal || opts.nft721 || opts.nft1155);
  const isInteractiveMode = !opts.dir && !isCliMode;

  if (isInteractiveMode) {
    // New unified input flow with auto-detection
    const startDir = process.env["HOME"] ?? ".";
    const mode = await promptInputMode();
    const collected = await collectAndDetectFiles(mode, startDir);

    if (collected.length === 0) {
      console.log("No files selected. Cancelled.");
      return;
    }

    const confirmed = await confirmDetectedFiles(collected);
    if (!confirmed || confirmed.length === 0) {
      console.log("Cancelled.");
      return;
    }

    detectedFiles = confirmed;

    // Group files by type
    const grouped = groupFilesByType(confirmed);
    nativeFile = grouped.native[0];
    tokensFile = grouped.tokens[0];
    internalFile = grouped.internal[0];
    nft721File = grouped.nft721[0];
    nft1155File = grouped.nft1155[0];

    // Handle multiple files of the same type - concatenate later if needed
    if (opts.verbose) {
      console.log("\nFiles to process:");
      for (const f of confirmed) {
        console.log(`  ${f.typeName}: ${f.path}`);
      }
    }
  } else if (opts.dir) {
    // Directory mode - auto-detect files in directory
    const csvFiles = listCsvFiles(opts.dir);
    const categorized = categorizeFiles(csvFiles);

    nativeFile = categorized.native[0];
    tokensFile = categorized.tokens[0];
    internalFile = categorized.internal[0];
    nft721File = categorized.nft721[0];
    nft1155File = categorized.nft1155[0];

    // Build detectedFiles for import storage
    for (const filePath of csvFiles) {
      const type = detectCsvTypeFromFile(filePath);
      if (type !== "unknown") {
        detectedFiles.push({ path: filePath, type, typeName: getCsvTypeName(type) });
      }
    }

    // Extract import ID from directory name
    importId = path.basename(opts.dir);

    if (opts.verbose) {
      console.log("Auto-detected files:");
      if (nativeFile) console.log(`  Native: ${nativeFile}`);
      if (tokensFile) console.log(`  Tokens: ${tokensFile}`);
      if (internalFile) console.log(`  Internal: ${internalFile}`);
      if (nft721File) console.log(`  NFT (ERC-721): ${nft721File}`);
      if (nft1155File) console.log(`  NFT (ERC-1155): ${nft1155File}`);
    }
  } else {
    // CLI mode with explicit file paths
    nativeFile = opts.native;
    tokensFile = opts.tokens;
    internalFile = opts.internal;
    nft721File = opts.nft721;
    nft1155File = opts.nft1155;

    // Validate CLI-provided file paths and build detectedFiles
    const filesToValidate = [
      { path: nativeFile, label: "Native transactions", type: "native" as const },
      { path: tokensFile, label: "Token transfers", type: "tokens" as const },
      { path: internalFile, label: "Internal transactions", type: "internal" as const },
      { path: nft721File, label: "ERC-721 NFT transfers", type: "nft721" as const },
      { path: nft1155File, label: "ERC-1155 NFT transfers", type: "nft1155" as const },
    ];
    for (const { path: filePath, label, type } of filesToValidate) {
      if (filePath) {
        const error = validateCsvPath(filePath, label);
        if (error) {
          console.error(error);
          return;
        }
        detectedFiles.push({ path: filePath, type, typeName: getCsvTypeName(type) });
      }
    }
  }

  // Gather config interactively if needed
  let selectedAddress: AddressSelection | undefined;

  // Handle address selection (interactive with saved addresses support)
  if (!opts.address) {
    selectedAddress = await promptForAddress();
  } else {
    // CLI address provided - look up name from saved addresses
    const savedAddresses = getSavedAddresses();
    const existingSaved = savedAddresses.find(
      (a) => a.address.toLowerCase() === opts.address?.toLowerCase()
    );
    if (existingSaved) {
      selectedAddress = { address: opts.address, name: existingSaved.name };
    }
  }

  const addressName = selectedAddress?.name;

  // Prompt for chain first (needed for native symbol default)
  let chain: string;
  if (opts.chain) {
    chain = opts.chain;
  } else {
    const { chainAnswer } = await inquirer.prompt<{ chainAnswer: string }>([
      {
        type: "input",
        name: "chainAnswer",
        message: "Chain name (for CoinTracking Exchange field):",
        default: "Mantle",
      },
    ]);
    chain = chainAnswer;
  }

  // Get native symbol with smart default based on chain
  let nativeSymbol: string;
  if (opts.nativeSymbol) {
    nativeSymbol = opts.nativeSymbol;
  } else {
    const suggestedSymbol = getDefaultNativeSymbol(chain);
    const defaultSymbol = suggestedSymbol ?? "ETH";
    const symbolHint = suggestedSymbol
      ? ` (Cointracking uses "${suggestedSymbol}" for ${chain})`
      : "";

    const { symbolAnswer } = await inquirer.prompt<{ symbolAnswer: string }>([
      {
        type: "input",
        name: "symbolAnswer",
        message: `Native token symbol${symbolHint}:`,
        default: defaultSymbol,
      },
    ]);
    nativeSymbol = symbolAnswer;
  }

  // Resolve to Cointracking-compatible symbol
  const resolvedNativeSymbol = resolveNativeSymbol(chain, nativeSymbol);

  // Build exchange name: "Chain AddressName" or just "Chain" if no name
  const exchange = addressName ? `${chain} ${addressName}` : chain;

  const address = toAddress((opts.address ?? selectedAddress?.address) as string);

  const config: ConvertConfig = {
    address,
    nativeSymbol: resolvedNativeSymbol,
    exchange,
    cutoff: opts.cutoff ? dayjs.utc(opts.cutoff).toDate() : undefined,
    verbose: opts.verbose,
    dryRun: opts.dryRun,
  };

  console.log(`\nProcessing for ${address} on ${chain}...`);
  if (opts.verbose) {
    console.log(`  Exchange: ${exchange}`);
    console.log(
      `  Native symbol: ${resolvedNativeSymbol}${resolvedNativeSymbol !== nativeSymbol ? ` (resolved from ${nativeSymbol})` : ""}`
    );
  }

  // Read and parse all CSV files
  const nativeRows = nativeFile ? readCsv(nativeFile) : [];
  const tokenRows = tokensFile ? readCsv(tokensFile) : [];
  const internalRows = internalFile ? readCsv(internalFile) : [];
  const nft721Rows = nft721File ? readCsv(nft721File) : [];
  const nft1155Rows = nft1155File ? readCsv(nft1155File) : [];

  if (opts.verbose) {
    console.log(`  Native rows: ${nativeRows.length}`);
    console.log(`  Token rows: ${tokenRows.length}`);
    console.log(`  Internal rows: ${internalRows.length}`);
    console.log(`  NFT-721 rows: ${nft721Rows.length}`);
    console.log(`  NFT-1155 rows: ${nft1155Rows.length}`);
  }

  // Parse native transactions and create index
  const parsedNative = parseNativeRows(nativeRows);
  const nativeByHash = indexNativeByHash(parsedNative);

  // Track processed fee hashes to avoid double-counting
  const processedFeeHashes = new Set<TxHash>();
  const allRows: CoinTrackingRow[] = [];

  // 1. Process token transfers first (may include swaps)
  const tokenResult = transformTokenRows(tokenRows, config, nativeByHash, processedFeeHashes);
  allRows.push(...tokenResult.rows);

  // 2. Process native transactions (skip ones already handled by token swaps)
  const nativeResult = transformNativeRows(
    nativeRows,
    config,
    processedFeeHashes,
    tokenResult.processedHashes
  );
  allRows.push(...nativeResult);

  // 3. Process internal transactions
  const internalResult = transformInternalRows(
    internalRows,
    config,
    nativeByHash,
    processedFeeHashes
  );
  allRows.push(...internalResult);

  // 4. Process NFTs
  const nft721Result = transformNftRows(
    nft721Rows,
    false,
    config,
    nativeByHash,
    processedFeeHashes
  );
  allRows.push(...nft721Result);

  const nft1155Result = transformNftRows(
    nft1155Rows,
    true,
    config,
    nativeByHash,
    processedFeeHashes
  );
  allRows.push(...nft1155Result);

  // Sort by date
  allRows.sort((a, b) => dayjs(a.Date).valueOf() - dayjs(b.Date).valueOf());

  console.log(`\nTransformed ${allRows.length} rows:`);
  console.log(`  → Token transfers/swaps: ${tokenResult.rows.length}`);
  console.log(`  → Native transactions: ${nativeResult.length}`);
  console.log(`  → Internal transactions: ${internalResult.length}`);
  console.log(`  → NFTs (ERC-721): ${nft721Result.length}`);
  console.log(`  → NFTs (ERC-1155): ${nft1155Result.length}`);

  if (opts.dryRun) {
    console.log("\n[Dry run] Would write to:", opts.output ?? getOutputFile(importId ?? "output"));
    if (opts.verbose && allRows.length > 0) {
      console.log("\nSample output:");
      console.log(JSON.stringify(allRows.slice(0, 3), null, 2));
    }
    return;
  }

  // Determine output path
  let outputPath: string;
  if (opts.output) {
    outputPath = opts.output;
  } else if (importId) {
    ensureDataDirs();
    outputPath = getOutputFile(importId);
  } else {
    outputPath = "cointracking-output.csv";
  }

  // Write output
  const outputDir = path.dirname(outputPath);
  if (outputDir !== ".") {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  writeCoinTrackingCsv(outputPath, allRows);
  console.log(`\n✓ Wrote ${outputPath} with ${allRows.length} rows`);

  // Save import to organized folder structure
  if (detectedFiles.length > 0) {
    const { importPath, manifest } = saveImport({
      chain,
      address,
      inputFiles: detectedFiles,
      outputPath,
      outputRowCount: allRows.length,
    });
    console.log(`\n✓ Import saved to: ${importPath}`);
    console.log(`  Date range: ${manifest.dateRange.from} to ${manifest.dateRange.to}`);
  }

  // Update history if we have an import ID
  if (importId) {
    const dates = allRows
      .map((r) => r.Date)
      .filter(Boolean)
      .toSorted((a, b) => a.localeCompare(b));
    addImportRecord({
      id: importId,
      chain,
      address,
      nativeSymbol,
      processedAt: new Date().toISOString(),
      inputFiles: [nativeFile, tokensFile, internalFile, nft721File, nft1155File].filter(
        Boolean
      ) as string[],
      outputFile: outputPath,
      rowCount: allRows.length,
      dateRange: {
        from: dates[0] ?? "",
        to: dates.at(-1) ?? "",
      },
      importedToCoinTracking: false,
    });
  }
}

// ---------- List Command ----------

function listCommand(): void {
  const imports = listImports();

  if (imports.length === 0) {
    console.log("No imports found. Run `npm run ingest` to get started.");
    return;
  }

  console.log("\nImport History:");
  console.log("─".repeat(80));

  for (const imp of imports) {
    const status = imp.importedToCoinTracking ? "✓ Imported" : "○ Not imported";
    console.log(imp.id);
    console.log(`  Chain: ${imp.chain} (${imp.nativeSymbol})`);
    console.log(`  Address: ${imp.address}`);
    console.log(
      `  Rows: ${imp.rowCount} | Date range: ${imp.dateRange.from} to ${imp.dateRange.to}`
    );
    console.log(`  Output: ${imp.outputFile}`);
    console.log(`  Status: ${status}`);
    console.log("");
  }
}

// ---------- Mark Imported Command ----------

function markImportedCommand(id: string): void {
  const success = markAsImported(id);
  if (success) {
    console.log(`✓ Marked "${id}" as imported to CoinTracking`);
  } else {
    console.log(`✗ Import "${id}" not found`);
  }
}

// ---------- CLI Setup ----------

async function main(): Promise<void> {
  const argv = await yargs(hideBin(process.argv))
    .command("convert [dir]", "Convert EtherScan CSV exports to CoinTracking format", (yargs) =>
      yargs
        .positional("dir", { type: "string", describe: "Directory containing CSV files" })
        .option("address", { type: "string", describe: "Wallet address" })
        .option("chain", { type: "string", describe: "Chain name for Exchange field" })
        .option("nativeSymbol", {
          type: "string",
          describe: "Native token symbol (e.g., MNT, ETH)",
        })
        .option("native", { type: "string", describe: "Path to native transactions CSV" })
        .option("tokens", { type: "string", describe: "Path to token transfers CSV" })
        .option("internal", { type: "string", describe: "Path to internal transactions CSV" })
        .option("nft721", { type: "string", describe: "Path to ERC-721 NFT transfers CSV" })
        .option("nft1155", { type: "string", describe: "Path to ERC-1155 NFT transfers CSV" })
        .option("output", { type: "string", describe: "Output file path" })
        .option("cutoff", {
          type: "string",
          describe: "Only include txs after this date (YYYY-MM-DD)",
        })
        .option("dry-run", { type: "boolean", describe: "Preview without writing", default: false })
        .option("verbose", { type: "boolean", describe: "Show detailed output", default: false })
    )
    .command("ingest <files...>", "Organize raw CSV files into data/raw/ structure", (yargs) =>
      yargs.positional("files", {
        type: "string",
        array: true,
        describe: "CSV files to ingest",
      })
    )
    .command("list", "List all processed imports")
    .command("mark-imported <id>", "Mark an import as uploaded to CoinTracking", (yargs) =>
      yargs.positional("id", { type: "string", describe: "Import ID", demandOption: true })
    )
    .help()
    .alias("h", "help")
    .demandCommand(0)
    .strict()
    .parseAsync();

  const command = argv._[0];

  switch (command) {
    case "convert":
      await convertCommand(argv as unknown as ConvertOptions);
      break;

    case "ingest":
      await ingestFiles((argv["files"] as string[] | undefined) ?? []);
      break;

    case "list":
      listCommand();
      break;

    case "mark-imported":
      markImportedCommand(argv["id"] as string);
      break;

    default:
      // No command = interactive mode, run convert with prompts
      await convertCommand({});
      break;
  }
}

main().catch((error: unknown) => {
  // Handle user cancellation gracefully (Ctrl+C)
  if (error instanceof Error && error.name === "ExitPromptError") {
    console.log("\n\nCancelled.");
    process.exit(0);
  }

  console.error("Error:", error);
  process.exit(1);
});
