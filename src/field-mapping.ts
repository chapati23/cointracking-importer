import type { CsvRow } from "./types.js";

// ---------- Field Pattern Definitions ----------

type FieldPattern = string | RegExp;

export const FIELD_PATTERNS = {
  // Common fields
  txHash: ["Transaction Hash", "Txhash", "TxHash", "Hash"],
  dateTime: ["DateTime (UTC)", "DateTime UTC", "Date Time (UTC)", "DateTime", "Timestamp"],
  unixTimestamp: ["UnixTimestamp", "Unix Timestamp", "Timestamp"],
  from: ["From"],
  to: ["To"],
  method: ["Method", "Function"],
  contractAddress: ["ContractAddress", "Contract Address"],

  // Native transaction fields
  valueIn: [/^Value_IN\(.+\)$/, /^Value IN\(.+\)$/, "Value_IN", "ValueIN", "Value In"],
  valueOut: [/^Value_OUT\(.+\)$/, /^Value OUT\(.+\)$/, "Value_OUT", "ValueOUT", "Value Out"],
  fee: [/^TxnFee\(.+\)$/, /^Txn Fee\(.+\)$/, "TxnFee", "Txn Fee", "Transaction Fee"],

  // Token transfer fields
  tokenValue: ["TokenValue", "Token Value", "Value", "Quantity"],
  tokenSymbol: ["TokenSymbol", "Token Symbol", "Symbol"],
  tokenName: ["TokenName", "Token Name", "Name"],

  // Internal transaction fields
  parentTxFrom: ["ParentTxFrom", "Parent Tx From"],
  parentTxTo: ["ParentTxTo", "Parent Tx To"],

  // NFT fields
  tokenId: ["TokenId", "Token ID", "TokenID", "NFT Token ID"],
} as const satisfies Record<string, readonly FieldPattern[]>;

export type FieldKey = keyof typeof FIELD_PATTERNS;

// ---------- Field Matching Logic ----------

function matchesPattern(fieldName: string, pattern: FieldPattern): boolean {
  if (typeof pattern === "string") {
    return fieldName.toLowerCase() === pattern.toLowerCase();
  }
  return pattern.test(fieldName);
}

/**
 * Find the actual column name in a CSV row that matches any of the given patterns.
 * Returns the matching key name from the row, or undefined if no match.
 */
export function findMatchingKey(row: CsvRow, patterns: readonly FieldPattern[]): string | undefined {
  const keys = Object.keys(row);
  for (const pattern of patterns) {
    const match = keys.find((key) => matchesPattern(key, pattern));
    if (match) return match;
  }
  return undefined;
}

/**
 * Get a field value from a CSV row using flexible pattern matching.
 * Returns empty string if no matching field is found.
 */
export function getField(row: CsvRow, patterns: readonly FieldPattern[]): string {
  const key = findMatchingKey(row, patterns);
  return key ? (row[key] ?? "") : "";
}

/**
 * Get a field value by field key name.
 */
export function getFieldByKey(row: CsvRow, fieldKey: FieldKey): string {
  return getField(row, FIELD_PATTERNS[fieldKey]);
}

// ---------- Number Parsing ----------

/**
 * Parse a number from a string, handling commas and whitespace.
 * Returns 0 for invalid/empty input.
 */
export function normalizeNumber(s: string | undefined): number {
  if (!s) return 0;
  const cleaned = s.replace(/\s/g, "").replace(/,/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

// ---------- CSV Header Analysis ----------

/**
 * Check if headers contain a pattern match.
 */
export function headersHaveField(headers: string[], patterns: readonly FieldPattern[]): boolean {
  for (const pattern of patterns) {
    if (headers.some((h) => matchesPattern(h, pattern))) {
      return true;
    }
  }
  return false;
}
