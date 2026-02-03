import { describe, expect, it } from "vitest";
import { detectCsvType, getCsvTypeName } from "../../src/detect.js";

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
