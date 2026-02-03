import { describe, expect, it } from "vitest";
import {
  FIELD_PATTERNS,
  getField,
  getFieldByKey,
  headersHaveField,
  normalizeNumber,
} from "../../src/field-mapping.js";

describe("getField", () => {
  it("finds DateTime (UTC) in MantleScan format", () => {
    const row = { "DateTime (UTC)": "2024-12-04 11:52:56" };
    expect(getField(row, FIELD_PATTERNS.dateTime)).toBe("2024-12-04 11:52:56");
  });

  it("finds Value_IN(MNT) with regex pattern", () => {
    const row = { "Value_IN(MNT)": "109" };
    expect(getField(row, FIELD_PATTERNS.valueIn)).toBe("109");
  });

  it("finds Value_OUT(ETH) for Ethereum exports", () => {
    const row = { "Value_OUT(ETH)": "0.5" };
    expect(getField(row, FIELD_PATTERNS.valueOut)).toBe("0.5");
  });

  it("finds TxnFee(MNT) with regex pattern", () => {
    const row = { "TxnFee(MNT)": "0.001" };
    expect(getField(row, FIELD_PATTERNS.fee)).toBe("0.001");
  });

  it("returns empty string if no match found", () => {
    const row = { SomeOtherField: "value" };
    expect(getField(row, FIELD_PATTERNS.txHash)).toBe("");
  });

  it("is case-insensitive for string patterns", () => {
    const row = { "transaction hash": "0xabc" };
    expect(getField(row, FIELD_PATTERNS.txHash)).toBe("0xabc");
  });
});

describe("getFieldByKey", () => {
  it("gets field by predefined key", () => {
    const row = { "Transaction Hash": "0x123", Method: "Approve" };
    expect(getFieldByKey(row, "txHash")).toBe("0x123");
    expect(getFieldByKey(row, "method")).toBe("Approve");
  });
});

describe("normalizeNumber", () => {
  it("parses simple numbers", () => {
    expect(normalizeNumber("123")).toBe(123);
    expect(normalizeNumber("0.5")).toBe(0.5);
  });

  it("handles comma-separated numbers", () => {
    expect(normalizeNumber("1,234.56")).toBe(1234.56);
    expect(normalizeNumber("1,000,000")).toBe(1000000);
  });

  it("handles whitespace", () => {
    expect(normalizeNumber(" 123 ")).toBe(123);
    expect(normalizeNumber("123 456")).toBe(123456);
  });

  it("returns 0 for invalid input", () => {
    expect(normalizeNumber("")).toBe(0);
    expect(normalizeNumber(undefined)).toBe(0);
    expect(normalizeNumber("abc")).toBe(0);
  });
});

describe("headersHaveField", () => {
  it("detects native transaction headers", () => {
    const headers = ["Transaction Hash", "Value_IN(MNT)", "Value_OUT(MNT)", "TxnFee(MNT)"];
    expect(headersHaveField(headers, FIELD_PATTERNS.valueIn)).toBe(true);
    expect(headersHaveField(headers, FIELD_PATTERNS.valueOut)).toBe(true);
    expect(headersHaveField(headers, FIELD_PATTERNS.fee)).toBe(true);
  });

  it("detects token transfer headers", () => {
    const headers = ["Transaction Hash", "TokenValue", "TokenSymbol"];
    expect(headersHaveField(headers, FIELD_PATTERNS.tokenValue)).toBe(true);
    expect(headersHaveField(headers, FIELD_PATTERNS.tokenSymbol)).toBe(true);
  });

  it("returns false for missing fields", () => {
    const headers = ["Transaction Hash", "From", "To"];
    expect(headersHaveField(headers, FIELD_PATTERNS.valueIn)).toBe(false);
    expect(headersHaveField(headers, FIELD_PATTERNS.tokenValue)).toBe(false);
  });

  it("handles empty headers array", () => {
    expect(headersHaveField([], FIELD_PATTERNS.txHash)).toBe(false);
  });

  it("detects internal transaction headers", () => {
    const headers = ["Txhash", "ParentTxFrom", "ParentTxTo", "Value_IN(ETH)"];
    expect(headersHaveField(headers, FIELD_PATTERNS.parentTxFrom)).toBe(true);
    expect(headersHaveField(headers, FIELD_PATTERNS.parentTxTo)).toBe(true);
  });

  it("detects NFT headers", () => {
    const headers = ["Txhash", "TokenId", "TokenSymbol"];
    expect(headersHaveField(headers, FIELD_PATTERNS.tokenId)).toBe(true);
  });
});

describe("normalizeNumber - edge cases", () => {
  it("handles empty string", () => {
    expect(normalizeNumber("")).toBe(0);
  });

  it("handles whitespace-only string", () => {
    expect(normalizeNumber("   ")).toBe(0);
  });

  it("handles numbers with leading/trailing whitespace", () => {
    expect(normalizeNumber("  123.45  ")).toBe(123.45);
  });

  it("handles very large numbers", () => {
    expect(normalizeNumber("999999999999999")).toBe(999999999999999);
  });

  it("handles negative numbers", () => {
    expect(normalizeNumber("-123.45")).toBe(-123.45);
  });

  it("handles scientific notation", () => {
    expect(normalizeNumber("1e10")).toBe(10000000000);
    expect(normalizeNumber("1.5e2")).toBe(150);
  });

  it("handles numbers with multiple commas", () => {
    expect(normalizeNumber("1,234,567,890")).toBe(1234567890);
  });

  it("returns 0 for NaN results", () => {
    expect(normalizeNumber("NaN")).toBe(0);
  });

  it("returns 0 for Infinity", () => {
    expect(normalizeNumber("Infinity")).toBe(0);
  });

  it("handles undefined", () => {
    expect(normalizeNumber(undefined)).toBe(0);
  });
});

describe("getField - dynamic regex patterns", () => {
  it("matches Value_IN with different native symbols", () => {
    const rowMNT = { "Value_IN(MNT)": "100" };
    const rowETH = { "Value_IN(ETH)": "200" };
    const rowBNB = { "Value_IN(BNB)": "300" };

    expect(getField(rowMNT, FIELD_PATTERNS.valueIn)).toBe("100");
    expect(getField(rowETH, FIELD_PATTERNS.valueIn)).toBe("200");
    expect(getField(rowBNB, FIELD_PATTERNS.valueIn)).toBe("300");
  });

  it("matches Value_OUT with different native symbols", () => {
    const rowMNT = { "Value_OUT(MNT)": "100" };
    const rowETH = { "Value_OUT(ETH)": "200" };

    expect(getField(rowMNT, FIELD_PATTERNS.valueOut)).toBe("100");
    expect(getField(rowETH, FIELD_PATTERNS.valueOut)).toBe("200");
  });

  it("matches TxnFee with different native symbols", () => {
    const rowMNT = { "TxnFee(MNT)": "0.001" };
    const rowUSD = { "TxnFee(USD)": "0.05" };

    expect(getField(rowMNT, FIELD_PATTERNS.fee)).toBe("0.001");
    expect(getField(rowUSD, FIELD_PATTERNS.fee)).toBe("0.05");
  });
});

describe("getFieldByKey - all field keys", () => {
  it("gets txHash field", () => {
    const row1 = { "Transaction Hash": "0xabc" };
    const row2 = { Txhash: "0xdef" };
    const row3 = { TxHash: "0xghi" };

    expect(getFieldByKey(row1, "txHash")).toBe("0xabc");
    expect(getFieldByKey(row2, "txHash")).toBe("0xdef");
    expect(getFieldByKey(row3, "txHash")).toBe("0xghi");
  });

  it("gets dateTime field", () => {
    const row1 = { "DateTime (UTC)": "2024-01-01 12:00:00" };
    const row2 = { DateTime: "2024-01-02" };

    expect(getFieldByKey(row1, "dateTime")).toBe("2024-01-01 12:00:00");
    expect(getFieldByKey(row2, "dateTime")).toBe("2024-01-02");
  });

  it("gets from and to fields", () => {
    const row = { From: "0x111", To: "0x222" };

    expect(getFieldByKey(row, "from")).toBe("0x111");
    expect(getFieldByKey(row, "to")).toBe("0x222");
  });

  it("gets method field", () => {
    const row1 = { Method: "Transfer" };
    const row2 = { Function: "swap" };

    expect(getFieldByKey(row1, "method")).toBe("Transfer");
    expect(getFieldByKey(row2, "method")).toBe("swap");
  });

  it("gets token fields", () => {
    const row = {
      TokenValue: "100",
      TokenSymbol: "USDC",
      TokenName: "USD Coin",
    };

    expect(getFieldByKey(row, "tokenValue")).toBe("100");
    expect(getFieldByKey(row, "tokenSymbol")).toBe("USDC");
    expect(getFieldByKey(row, "tokenName")).toBe("USD Coin");
  });

  it("gets NFT tokenId field", () => {
    const row1 = { TokenId: "1234" };
    const row2 = { "Token ID": "5678" };

    expect(getFieldByKey(row1, "tokenId")).toBe("1234");
    expect(getFieldByKey(row2, "tokenId")).toBe("5678");
  });

  it("gets internal transaction fields", () => {
    const row = {
      ParentTxFrom: "0xparent1",
      ParentTxTo: "0xparent2",
    };

    expect(getFieldByKey(row, "parentTxFrom")).toBe("0xparent1");
    expect(getFieldByKey(row, "parentTxTo")).toBe("0xparent2");
  });

  it("returns empty string for missing field", () => {
    const row = { SomeOtherField: "value" };

    expect(getFieldByKey(row, "txHash")).toBe("");
    expect(getFieldByKey(row, "valueIn")).toBe("");
  });
});
