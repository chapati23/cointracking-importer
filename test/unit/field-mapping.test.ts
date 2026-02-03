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
});
