import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  categorizeFiles,
  detectCsvType,
  detectCsvTypeFromFile,
  getCsvTypeName,
} from "../../src/detect.js";

describe("detectCsvType", () => {
  it("detects native transactions by Value_IN column", () => {
    const headers = ["Transaction Hash", "Value_IN(MNT)", "Value_OUT(MNT)", "TxnFee(MNT)"];
    expect(detectCsvType(headers)).toBe("native");
  });

  it("detects native transactions by Value_OUT column", () => {
    const headers = ["Transaction Hash", "Value_OUT(ETH)", "From", "To"];
    expect(detectCsvType(headers)).toBe("native");
  });

  it("detects token transfers by TokenValue + TokenSymbol", () => {
    const headers = ["Transaction Hash", "TokenValue", "TokenSymbol", "From", "To"];
    expect(detectCsvType(headers)).toBe("tokens");
  });

  it("detects internal txs by ParentTxFrom", () => {
    const headers = ["Txhash", "ParentTxFrom", "Value_IN(ETH)", "From", "To"];
    expect(detectCsvType(headers)).toBe("internal");
  });

  it("detects ERC-721 by TokenId without TokenValue", () => {
    const headers = ["Txhash", "TokenId", "TokenSymbol", "From", "To"];
    expect(detectCsvType(headers)).toBe("nft721");
  });

  it("detects ERC-1155 by TokenId with TokenValue", () => {
    const headers = ["Txhash", "TokenId", "TokenValue", "TokenSymbol", "From", "To"];
    expect(detectCsvType(headers)).toBe("nft1155");
  });

  it("returns unknown for unrecognized format", () => {
    const headers = ["SomeColumn", "AnotherColumn"];
    expect(detectCsvType(headers)).toBe("unknown");
  });
});

describe("getCsvTypeName", () => {
  it("returns human-readable names", () => {
    expect(getCsvTypeName("native")).toBe("Native Transactions");
    expect(getCsvTypeName("tokens")).toBe("Token Transfers (ERC-20)");
    expect(getCsvTypeName("internal")).toBe("Internal Transactions");
    expect(getCsvTypeName("nft721")).toBe("NFT Transfers (ERC-721)");
    expect(getCsvTypeName("nft1155")).toBe("NFT Transfers (ERC-1155)");
    expect(getCsvTypeName("unknown")).toBe("Unknown");
  });
});

describe("detectCsvType - edge cases", () => {
  it("handles empty headers", () => {
    expect(detectCsvType([])).toBe("unknown");
  });

  it("does not handle headers with extra whitespace (requires pre-trimming)", () => {
    const headers = ["  Transaction Hash  ", "  Value_IN(MNT)  ", "  Value_OUT(MNT)  "];
    // Headers with whitespace won't match patterns - they need to be trimmed before detection
    // This documents actual behavior; getCsvHeaders trims during reading
    expect(detectCsvType(headers)).toBe("unknown");
  });

  it("prioritizes internal over native when both fields present", () => {
    const headers = ["Txhash", "ParentTxFrom", "Value_IN(ETH)", "Value_OUT(ETH)"];
    expect(detectCsvType(headers)).toBe("internal");
  });

  it("detects tokens even with varying TokenValue column names", () => {
    const headers = ["Transaction Hash", "TokenValue", "TokenSymbol"];
    expect(detectCsvType(headers)).toBe("tokens");
    // Pattern matching works with "TokenValue"
    // Note: "Token Value" with space may not match due to pattern definitions
  });

  it("distinguishes tokens from native when both TokenValue and Value_IN present", () => {
    // This is an edge case - tokens should have TokenValue/TokenSymbol but NOT Value_IN/OUT
    const headers = ["Transaction Hash", "TokenValue", "TokenSymbol", "Value_IN(ETH)"];
    // According to detection logic, if Value_IN is present, it won't be tokens
    expect(detectCsvType(headers)).toBe("native");
  });
});

describe("detectCsvTypeFromFile", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "detect-test-"));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it("detects native transactions from file", () => {
    const csvContent = `Transaction Hash,DateTime (UTC),From,To,Value_IN(MNT),Value_OUT(MNT)
0xabc,2024-01-01,0x111,0x222,0,100`;
    const filePath = path.join(tempDir, "native.csv");
    fs.writeFileSync(filePath, csvContent);

    expect(detectCsvTypeFromFile(filePath)).toBe("native");
  });

  it("detects token transfers from file", () => {
    const csvContent = `Transaction Hash,DateTime (UTC),From,To,TokenValue,TokenSymbol
0xabc,2024-01-01,0x111,0x222,100,USDC`;
    const filePath = path.join(tempDir, "tokens.csv");
    fs.writeFileSync(filePath, csvContent);

    expect(detectCsvTypeFromFile(filePath)).toBe("tokens");
  });

  it("detects internal transactions from file", () => {
    const csvContent = `Txhash,DateTime (UTC),From,To,ParentTxFrom,Value_IN(ETH)
0xabc,2024-01-01,0x111,0x222,0xparent,1`;
    const filePath = path.join(tempDir, "internal.csv");
    fs.writeFileSync(filePath, csvContent);

    expect(detectCsvTypeFromFile(filePath)).toBe("internal");
  });

  it("detects ERC-721 NFT from file", () => {
    const csvContent = `Txhash,DateTime (UTC),From,To,TokenId,TokenSymbol
0xabc,2024-01-01,0x111,0x222,1234,BAYC`;
    const filePath = path.join(tempDir, "nft721.csv");
    fs.writeFileSync(filePath, csvContent);

    expect(detectCsvTypeFromFile(filePath)).toBe("nft721");
  });

  it("detects ERC-1155 NFT from file", () => {
    const csvContent = `Txhash,DateTime (UTC),From,To,TokenId,TokenValue,TokenSymbol
0xabc,2024-01-01,0x111,0x222,1234,5,ITEM`;
    const filePath = path.join(tempDir, "nft1155.csv");
    fs.writeFileSync(filePath, csvContent);

    expect(detectCsvTypeFromFile(filePath)).toBe("nft1155");
  });

  it("returns unknown for unrecognized file format", () => {
    const csvContent = `Name,Age,City
John,30,NYC`;
    const filePath = path.join(tempDir, "unknown.csv");
    fs.writeFileSync(filePath, csvContent);

    expect(detectCsvTypeFromFile(filePath)).toBe("unknown");
  });

  it("handles empty file", () => {
    const filePath = path.join(tempDir, "empty.csv");
    fs.writeFileSync(filePath, "");

    expect(detectCsvTypeFromFile(filePath)).toBe("unknown");
  });
});

describe("categorizeFiles", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "categorize-test-"));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it("categorizes multiple files by type", () => {
    // Create test files
    const nativeContent = `Transaction Hash,Value_IN(ETH),Value_OUT(ETH)
0xabc,0,100`;
    const tokensContent = `Transaction Hash,TokenValue,TokenSymbol
0xdef,50,USDC`;
    const unknownContent = `A,B,C
1,2,3`;

    const nativePath = path.join(tempDir, "native.csv");
    const tokensPath = path.join(tempDir, "tokens.csv");
    const unknownPath = path.join(tempDir, "unknown.csv");

    fs.writeFileSync(nativePath, nativeContent);
    fs.writeFileSync(tokensPath, tokensContent);
    fs.writeFileSync(unknownPath, unknownContent);

    const result = categorizeFiles([nativePath, tokensPath, unknownPath]);

    expect(result.native).toHaveLength(1);
    expect(result.native[0]).toBe(nativePath);
    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0]).toBe(tokensPath);
    expect(result.unknown).toHaveLength(1);
    expect(result.unknown[0]).toBe(unknownPath);
    expect(result.internal).toHaveLength(0);
    expect(result.nft721).toHaveLength(0);
    expect(result.nft1155).toHaveLength(0);
  });

  it("handles empty file list", () => {
    const result = categorizeFiles([]);

    expect(result.native).toHaveLength(0);
    expect(result.tokens).toHaveLength(0);
    expect(result.internal).toHaveLength(0);
    expect(result.nft721).toHaveLength(0);
    expect(result.nft1155).toHaveLength(0);
    expect(result.unknown).toHaveLength(0);
  });

  it("handles multiple files of same type", () => {
    const content = `Transaction Hash,Value_IN(ETH),Value_OUT(ETH)
0xabc,0,100`;

    const path1 = path.join(tempDir, "native1.csv");
    const path2 = path.join(tempDir, "native2.csv");
    const path3 = path.join(tempDir, "native3.csv");

    fs.writeFileSync(path1, content);
    fs.writeFileSync(path2, content);
    fs.writeFileSync(path3, content);

    const result = categorizeFiles([path1, path2, path3]);

    expect(result.native).toHaveLength(3);
  });
});
