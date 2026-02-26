/**
 * Generic fetcher for Etherscan-compatible APIs (Blockscout, etc.).
 *
 * Fetches transaction data from the API and converts it to CSV files
 * matching the format expected by the cointracking-importer pipeline.
 *
 * Works with any chain that exposes the standard Etherscan API modules:
 *   - account/txlist (native transactions)
 *   - account/tokentx (ERC-20 token transfers)
 *   - account/txlistinternal (internal transactions)
 */

import { stringify } from "csv-stringify/sync";
import fs from "node:fs";
import path from "node:path";

// ---------- Types ----------

interface EtherscanTx {
  hash: string;
  blockNumber: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  gas: string;
  gasPrice: string;
  gasUsed: string;
  isError: string;
  txreceipt_status: string;
  input: string;
  methodId: string;
  contractAddress: string;
  functionName?: string;
  nonce: string;
}

interface EtherscanTokenTx {
  hash: string;
  blockNumber: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  contractAddress: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimal: string;
  gas: string;
  gasPrice: string;
  gasUsed: string;
}

interface EtherscanInternalTx {
  hash: string;
  blockNumber: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  contractAddress: string;
  input: string;
  type: string;
  gas: string;
  gasUsed: string;
  isError: string;
}

interface EtherscanApiResponse<T> {
  status: string;
  message: string;
  result: T[];
}

export interface FetcherConfig {
  /** Base URL for the Etherscan-compatible API (e.g., https://explorer.zora.energy/api) */
  apiBaseUrl: string;
  /** Wallet address to fetch transactions for */
  address: string;
  /** Native token symbol (e.g., ETH) */
  nativeSymbol: string;
  /** Chain name for display */
  chain: string;
  /** Output directory for CSV files */
  outputDir: string;
  /** Whether to print verbose output */
  verbose?: boolean;
}

// ---------- API Fetching ----------

async function fetchApi<T>(
  baseUrl: string,
  params: Record<string, string>
): Promise<EtherscanApiResponse<T>> {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as EtherscanApiResponse<T>;
}

async function fetchAllPages<T>(
  baseUrl: string,
  params: Record<string, string>,
  verbose?: boolean
): Promise<T[]> {
  const pageSize = 10_000;
  let page = 1;
  const allResults: T[] = [];

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    const response = await fetchApi<T>(baseUrl, {
      ...params,
      page: String(page),
      offset: String(pageSize),
    });

    const results = response.result;
    if (verbose) {
      console.log(`  Page ${page}: ${results.length} results`);
    }

    allResults.push(...results);

    // If we got fewer than pageSize results, we've reached the end
    if (results.length < pageSize) break;
    page++;
  }

  return allResults;
}

// ---------- Timestamp Conversion ----------

function unixToDateTime(timestamp: string): string {
  const date = new Date(Number(timestamp) * 1000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// ---------- Value Conversion ----------

function trimTrailingZeros(s: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === "0") end--;
  return end === 0 ? "0" : s.slice(0, end);
}

function weiToEther(wei: string): string {
  if (!wei || wei === "0") return "0";

  // Pad to at least 19 chars to ensure 18 decimal places
  const padded = wei.padStart(19, "0");
  const intPart = padded.slice(0, -18) || "0";
  const decPart = padded.slice(-18);

  const trimmedDec = trimTrailingZeros(decPart);
  return trimmedDec === "0" ? intPart : `${intPart}.${trimmedDec}`;
}

function tokenValueToDecimal(value: string, decimals: string): string {
  if (!value || value === "0") return "0";

  const dec = Number(decimals) || 18;
  const padded = value.padStart(dec + 1, "0");
  const intPart = padded.slice(0, padded.length - dec) || "0";
  const decPart = padded.slice(padded.length - dec);

  const trimmedDec = trimTrailingZeros(decPart);
  return trimmedDec === "0" ? intPart : `${intPart}.${trimmedDec}`;
}

// ---------- Fee Calculation ----------

function calculateFee(gasUsed: string, gasPrice: string): string {
  if (!gasUsed || !gasPrice) return "0";

  const gasUsedBig = BigInt(gasUsed);
  const gasPriceBig = BigInt(gasPrice);
  const feeWei = (gasUsedBig * gasPriceBig).toString();
  return weiToEther(feeWei);
}

// ---------- Method Name Extraction ----------

function extractMethod(tx: EtherscanTx): string {
  // If functionName is available, extract the method name
  if (tx.functionName) {
    const match = /^(\w+)\(/.exec(tx.functionName);
    if (match?.[1]) return match[1];
  }

  // Simple transfer (no input data)
  if (tx.input === "0x" || tx.input === "") return "Transfer";

  // Just methodId available
  if (tx.methodId && tx.methodId !== "0x") return tx.methodId;

  return "";
}

// ---------- CSV Generation ----------

function generateNativeCsv(txs: EtherscanTx[], address: string, nativeSymbol: string): string {
  const addr = address.toLowerCase();

  const headers = [
    "Transaction Hash",
    "Blockno",
    "UnixTimestamp",
    `DateTime (UTC)`,
    "From",
    "To",
    "ContractAddress",
    `Value_IN(${nativeSymbol})`,
    `Value_OUT(${nativeSymbol})`,
    `CurrentValue @ $0/${nativeSymbol}`,
    `TxnFee(${nativeSymbol})`,
    `TxnFee(USD)`,
    `Historical $Price/${nativeSymbol}`,
    "Status",
    "ErrCode",
    "Method",
  ];

  const rows = txs.map((tx) => {
    const valueEther = weiToEther(tx.value);
    const isIncoming = tx.to.toLowerCase() === addr;
    const isOutgoing = tx.from.toLowerCase() === addr;
    const fee = calculateFee(tx.gasUsed, tx.gasPrice);

    return [
      tx.hash,
      tx.blockNumber,
      tx.timeStamp,
      unixToDateTime(tx.timeStamp),
      tx.from,
      tx.to,
      tx.contractAddress,
      isIncoming ? valueEther : "0",
      isOutgoing && tx.to.toLowerCase() !== addr ? valueEther : "0",
      "0",
      fee,
      "0",
      "0",
      tx.txreceipt_status === "1" ? "" : "Error",
      tx.isError === "1" ? "1" : "",
      extractMethod(tx),
    ];
  });

  return stringify([headers, ...rows]);
}

function generateTokenCsv(txs: EtherscanTokenTx[]): string {
  const headers = [
    "Transaction Hash",
    "Blockno",
    "UnixTimestamp",
    "DateTime (UTC)",
    "From",
    "To",
    "TokenValue",
    "USDValueDayOfTx",
    "ContractAddress",
    "TokenName",
    "TokenSymbol",
  ];

  const rows = txs.map((tx) => [
    tx.hash,
    tx.blockNumber,
    tx.timeStamp,
    unixToDateTime(tx.timeStamp),
    tx.from,
    tx.to,
    tokenValueToDecimal(tx.value, tx.tokenDecimal),
    "N/A",
    tx.contractAddress,
    tx.tokenName,
    tx.tokenSymbol,
  ]);

  return stringify([headers, ...rows]);
}

function generateInternalCsv(
  txs: EtherscanInternalTx[],
  address: string,
  nativeSymbol: string
): string {
  const addr = address.toLowerCase();

  const headers = [
    "Transaction Hash",
    "Blockno",
    "UnixTimestamp",
    "DateTime (UTC)",
    "ParentTxFrom",
    "ParentTxTo",
    "From",
    "To",
    "ContractAddress",
    `Value_IN(${nativeSymbol})`,
    `Value_OUT(${nativeSymbol})`,
    `CurrentValue @ $0/${nativeSymbol}`,
    "Status",
    "ErrCode",
    "Type",
  ];

  const rows = txs.map((tx) => {
    const valueEther = weiToEther(tx.value);
    const isIncoming = tx.to.toLowerCase() === addr;

    return [
      tx.hash,
      tx.blockNumber,
      tx.timeStamp,
      unixToDateTime(tx.timeStamp),
      "", // ParentTxFrom - not available from API
      "", // ParentTxTo - not available from API
      tx.from,
      tx.to,
      tx.contractAddress,
      isIncoming ? valueEther : "0",
      isIncoming ? "0" : valueEther,
      "0",
      tx.isError === "1" ? "Error" : "",
      tx.isError === "1" ? "1" : "",
      tx.type,
    ];
  });

  return stringify([headers, ...rows]);
}

// ---------- Main Fetch Function ----------

export interface FetchResult {
  nativeFile?: string;
  tokensFile?: string;
  internalFile?: string;
  nativeTxCount: number;
  tokenTxCount: number;
  internalTxCount: number;
}

export async function fetchAndGenerateCsvs(config: FetcherConfig): Promise<FetchResult> {
  const { apiBaseUrl, address, nativeSymbol, outputDir, verbose } = config;

  fs.mkdirSync(outputDir, { recursive: true });

  const baseParams = {
    module: "account",
    address,
    startblock: "0",
    endblock: "99999999",
    sort: "asc",
  };

  const result: FetchResult = {
    nativeTxCount: 0,
    tokenTxCount: 0,
    internalTxCount: 0,
  };

  // Fetch native transactions
  if (verbose) console.log("Fetching native transactions...");
  const nativeTxs = await fetchAllPages<EtherscanTx>(
    apiBaseUrl,
    { ...baseParams, action: "txlist" },
    verbose
  );
  result.nativeTxCount = nativeTxs.length;

  if (nativeTxs.length > 0) {
    const csv = generateNativeCsv(nativeTxs, address, nativeSymbol);
    const filePath = path.join(outputDir, "native.csv");
    fs.writeFileSync(filePath, csv, "utf8");
    result.nativeFile = filePath;
    if (verbose) console.log(`  Wrote ${nativeTxs.length} native txs to ${filePath}`);
  }

  // Fetch token transfers
  if (verbose) console.log("Fetching token transfers...");
  const tokenTxs = await fetchAllPages<EtherscanTokenTx>(
    apiBaseUrl,
    { ...baseParams, action: "tokentx" },
    verbose
  );
  result.tokenTxCount = tokenTxs.length;

  if (tokenTxs.length > 0) {
    const csv = generateTokenCsv(tokenTxs);
    const filePath = path.join(outputDir, "tokens.csv");
    fs.writeFileSync(filePath, csv, "utf8");
    result.tokensFile = filePath;
    if (verbose) console.log(`  Wrote ${tokenTxs.length} token txs to ${filePath}`);
  }

  // Fetch internal transactions
  if (verbose) console.log("Fetching internal transactions...");
  const internalTxs = await fetchAllPages<EtherscanInternalTx>(
    apiBaseUrl,
    { ...baseParams, action: "txlistinternal" },
    verbose
  );
  result.internalTxCount = internalTxs.length;

  if (internalTxs.length > 0) {
    const csv = generateInternalCsv(internalTxs, address, nativeSymbol);
    const filePath = path.join(outputDir, "internal.csv");
    fs.writeFileSync(filePath, csv, "utf8");
    result.internalFile = filePath;
    if (verbose) console.log(`  Wrote ${internalTxs.length} internal txs to ${filePath}`);
  }

  return result;
}
