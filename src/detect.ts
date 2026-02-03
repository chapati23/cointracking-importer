import { getCsvHeaders } from "./csv-utils.js";
import { FIELD_PATTERNS, headersHaveField } from "./field-mapping.js";
import type { CsvType } from "./types.js";

/**
 * Detect CSV type from headers.
 *
 * Detection rules:
 * - Has `ParentTxFrom` → internal transactions
 * - Has `TokenId` without `TokenValue` → ERC-721 NFT
 * - Has `TokenId` with `TokenValue` → ERC-1155 NFT
 * - Has `TokenValue` + `TokenSymbol` → token transfers
 * - Has `Value_IN(*)` or `Value_OUT(*)` → native transactions
 */
export function detectCsvType(headers: string[]): CsvType {
  const hasParentTxFrom = headersHaveField(headers, FIELD_PATTERNS.parentTxFrom);
  const hasTokenId = headersHaveField(headers, FIELD_PATTERNS.tokenId);
  const hasTokenValue = headersHaveField(headers, FIELD_PATTERNS.tokenValue);
  const hasTokenSymbol = headersHaveField(headers, FIELD_PATTERNS.tokenSymbol);
  const hasValueIn = headersHaveField(headers, FIELD_PATTERNS.valueIn);
  const hasValueOut = headersHaveField(headers, FIELD_PATTERNS.valueOut);

  // Internal transactions have ParentTxFrom
  if (hasParentTxFrom) {
    return "internal";
  }

  // NFTs have TokenId
  if (hasTokenId) {
    // ERC-1155 has quantity (TokenValue), ERC-721 does not
    return hasTokenValue ? "nft1155" : "nft721";
  }

  // Token transfers have TokenValue + TokenSymbol but no ValueIn/ValueOut
  if (hasTokenValue && hasTokenSymbol && !hasValueIn && !hasValueOut) {
    return "tokens";
  }

  // Native transactions have Value_IN or Value_OUT
  if (hasValueIn || hasValueOut) {
    return "native";
  }

  return "unknown";
}

/**
 * Detect CSV type from file path.
 */
export function detectCsvTypeFromFile(filePath: string): CsvType {
  const headers = getCsvHeaders(filePath);
  return detectCsvType(headers);
}

/**
 * Get human-readable name for CSV type.
 */
export function getCsvTypeName(type: CsvType): string {
  const names: Record<CsvType, string> = {
    native: "Native Transactions",
    tokens: "Token Transfers (ERC-20)",
    internal: "Internal Transactions",
    nft721: "NFT Transfers (ERC-721)",
    nft1155: "NFT Transfers (ERC-1155)",
    unknown: "Unknown",
  };
  return names[type];
}

/**
 * Auto-detect and categorize CSV files in a directory.
 */
export function categorizeFiles(filePaths: string[]): Record<CsvType, string[]> {
  const result: Record<CsvType, string[]> = {
    native: [],
    tokens: [],
    internal: [],
    nft721: [],
    nft1155: [],
    unknown: [],
  };

  for (const filePath of filePaths) {
    const type = detectCsvTypeFromFile(filePath);
    result[type].push(filePath);
  }

  return result;
}
