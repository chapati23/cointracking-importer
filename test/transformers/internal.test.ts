import { describe, expect, it } from "vitest";
import {
  parseInternalRow,
  parseInternalRows,
  transformInternalRows,
  transformInternalTx,
} from "../../src/transformers/internal.js";
import { toAddress, type ParsedNativeTx, type TxHash } from "../../src/types.js";

const USER_ADDRESS = toAddress("0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
const OTHER_ADDRESS = toAddress("0x1111111111111111111111111111111111111111");
const CONTRACT_ADDRESS = toAddress("0x2222222222222222222222222222222222222222");

describe("parseInternalRow", () => {
  it("parses internal transaction row correctly", () => {
    const row = {
      "Transaction Hash": "0xabc123",
      "DateTime (UTC)": "2024-12-04 11:52:56",
      From: "0x1111111111111111111111111111111111111111",
      To: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
      "Value_IN(MNT)": "5.5",
      "Value_OUT(MNT)": "0",
      ContractAddress: "0x2222222222222222222222222222222222222222",
    };

    const parsed = parseInternalRow(row);
    expect(parsed.txHash).toBe("0xabc123");
    expect(parsed.dateTime).toBe("2024-12-04 11:52:56");
    expect(parsed.from).toBe("0x1111111111111111111111111111111111111111");
    expect(parsed.to).toBe("0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
    expect(parsed.valueIn).toBe(5.5);
    expect(parsed.valueOut).toBe(0);
    expect(parsed.contractAddress).toBe("0x2222222222222222222222222222222222222222");
  });

  it("normalizes addresses to lowercase", () => {
    const row = {
      "Transaction Hash": "0xABC123",
      "DateTime (UTC)": "2024-12-04",
      From: "0xD8DA6BF26964AF9D7EED9E03E53415D37AA96045",
      To: "0x1111111111111111111111111111111111111111",
      "Value_IN(MNT)": "0",
      "Value_OUT(MNT)": "10",
      ContractAddress: "0xCONTRACT",
    };

    const parsed = parseInternalRow(row);
    expect(parsed.txHash).toBe("0xabc123");
    expect(parsed.from).toBe("0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
  });

  it("handles missing values as zero", () => {
    const row = {
      "Transaction Hash": "0xabc123",
      "DateTime (UTC)": "2024-12-04",
      From: "0xfrom",
      To: "0xto",
    };

    const parsed = parseInternalRow(row);
    expect(parsed.valueIn).toBe(0);
    expect(parsed.valueOut).toBe(0);
  });

  it("handles comma-separated numbers", () => {
    const row = {
      "Transaction Hash": "0xabc123",
      "DateTime (UTC)": "2024-12-04",
      From: "0xfrom",
      To: "0xto",
      "Value_IN(MNT)": "1,234.56",
      "Value_OUT(MNT)": "0",
    };

    const parsed = parseInternalRow(row);
    expect(parsed.valueIn).toBe(1234.56);
  });
});

describe("parseInternalRows", () => {
  it("parses multiple rows", () => {
    const rows = [
      {
        "Transaction Hash": "0xabc",
        "DateTime (UTC)": "2024-12-04",
        From: "0xfrom1",
        To: "0xto1",
        "Value_IN(MNT)": "10",
        "Value_OUT(MNT)": "0",
      },
      {
        "Transaction Hash": "0xdef",
        "DateTime (UTC)": "2024-12-05",
        From: "0xfrom2",
        To: "0xto2",
        "Value_IN(MNT)": "0",
        "Value_OUT(MNT)": "20",
      },
    ];

    const parsed = parseInternalRows(rows);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.txHash).toBe("0xabc");
    expect(parsed[1]?.txHash).toBe("0xdef");
  });

  it("filters out rows with empty txHash", () => {
    const rows = [
      {
        "Transaction Hash": "0xabc",
        "DateTime (UTC)": "2024-12-04",
        From: "0xfrom",
        To: "0xto",
        "Value_IN(MNT)": "10",
        "Value_OUT(MNT)": "0",
      },
      {
        "Transaction Hash": "",
        "DateTime (UTC)": "2024-12-04",
        From: "0xfrom2",
        To: "0xto2",
        "Value_IN(MNT)": "5",
        "Value_OUT(MNT)": "0",
      },
    ];

    const parsed = parseInternalRows(rows);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.txHash).toBe("0xabc");
  });
});

describe("transformInternalTx", () => {
  const config = {
    address: USER_ADDRESS,
    nativeSymbol: "MNT",
    exchange: "Mantle",
  };

  it("creates Deposit for incoming internal transfer", () => {
    const tx = {
      txHash: "0xabc123" as TxHash,
      dateTime: "2024-12-04 11:52:56",
      from: OTHER_ADDRESS,
      to: USER_ADDRESS,
      valueIn: 5.5,
      valueOut: 0,
      contractAddress: CONTRACT_ADDRESS,
    };

    const processedFeeHashes = new Set<TxHash>();
    const nativeByHash = new Map<TxHash, ParsedNativeTx>();

    const result = transformInternalTx(tx, config, processedFeeHashes, nativeByHash);

    expect(result).not.toBeNull();
    expect(result?.Type).toBe("Deposit");
    expect(result?.BuyAmount).toBe("5.5");
    expect(result?.BuyCurrency).toBe("MNT");
    expect(result?.Comment).toContain("Internal in");
    expect(result?.Comment).toContain("0xabc123");
  });

  it("creates Withdrawal for outgoing internal transfer", () => {
    const tx = {
      txHash: "0xabc123" as TxHash,
      dateTime: "2024-12-04 11:52:56",
      from: USER_ADDRESS,
      to: OTHER_ADDRESS,
      valueIn: 0,
      valueOut: 10,
      contractAddress: CONTRACT_ADDRESS,
    };

    const processedFeeHashes = new Set<TxHash>();
    const nativeByHash = new Map<TxHash, ParsedNativeTx>();

    const result = transformInternalTx(tx, config, processedFeeHashes, nativeByHash);

    expect(result).not.toBeNull();
    expect(result?.Type).toBe("Withdrawal");
    expect(result?.SellAmount).toBe("10");
    expect(result?.SellCurrency).toBe("MNT");
    expect(result?.Comment).toContain("Internal out");
  });

  it("returns null for zero value transactions", () => {
    const tx = {
      txHash: "0xabc123" as TxHash,
      dateTime: "2024-12-04 11:52:56",
      from: OTHER_ADDRESS,
      to: USER_ADDRESS,
      valueIn: 0,
      valueOut: 0,
      contractAddress: CONTRACT_ADDRESS,
    };

    const processedFeeHashes = new Set<TxHash>();
    const nativeByHash = new Map<TxHash, ParsedNativeTx>();

    const result = transformInternalTx(tx, config, processedFeeHashes, nativeByHash);
    expect(result).toBeNull();
  });

  it("applies fee from native transaction", () => {
    const tx = {
      txHash: "0xabc123" as TxHash,
      dateTime: "2024-12-04 11:52:56",
      from: OTHER_ADDRESS,
      to: USER_ADDRESS,
      valueIn: 5,
      valueOut: 0,
      contractAddress: CONTRACT_ADDRESS,
    };

    const nativeTx: ParsedNativeTx = {
      txHash: "0xabc123" as TxHash,
      dateTime: "2024-12-04 11:52:56",
      from: OTHER_ADDRESS,
      to: USER_ADDRESS,
      valueIn: 0,
      valueOut: 0,
      fee: 0.001,
      method: "",
    };

    const processedFeeHashes = new Set<TxHash>();
    const nativeByHash = new Map<TxHash, ParsedNativeTx>();
    nativeByHash.set("0xabc123" as TxHash, nativeTx);

    const result = transformInternalTx(tx, config, processedFeeHashes, nativeByHash);

    expect(result).not.toBeNull();
    expect(result?.Fee).toBe("0.001");
    expect(result?.FeeCurrency).toBe("MNT");
    expect(processedFeeHashes.has("0xabc123" as TxHash)).toBe(true);
  });

  it("does not apply fee if already processed", () => {
    const tx = {
      txHash: "0xabc123" as TxHash,
      dateTime: "2024-12-04 11:52:56",
      from: OTHER_ADDRESS,
      to: USER_ADDRESS,
      valueIn: 5,
      valueOut: 0,
      contractAddress: CONTRACT_ADDRESS,
    };

    const nativeTx: ParsedNativeTx = {
      txHash: "0xabc123" as TxHash,
      dateTime: "2024-12-04",
      from: OTHER_ADDRESS,
      to: USER_ADDRESS,
      valueIn: 0,
      valueOut: 0,
      fee: 0.001,
      method: "",
    };

    const processedFeeHashes = new Set<TxHash>(["0xabc123" as TxHash]);
    const nativeByHash = new Map<TxHash, ParsedNativeTx>();
    nativeByHash.set("0xabc123" as TxHash, nativeTx);

    const result = transformInternalTx(tx, config, processedFeeHashes, nativeByHash);

    expect(result).not.toBeNull();
    expect(result?.Fee).toBe("");
    expect(result?.FeeCurrency).toBe("");
  });
});

describe("transformInternalRows - deduplication", () => {
  const config = {
    address: USER_ADDRESS,
    nativeSymbol: "MNT",
    exchange: "Mantle",
  };

  it("skips internal tx that duplicates native tx (same valueIn)", () => {
    const rows = [
      {
        "Transaction Hash": "0xabc123",
        "DateTime (UTC)": "2024-12-04",
        From: OTHER_ADDRESS,
        To: USER_ADDRESS,
        "Value_IN(MNT)": "10",
        "Value_OUT(MNT)": "0",
      },
    ];

    const nativeTx: ParsedNativeTx = {
      txHash: "0xabc123" as TxHash,
      dateTime: "2024-12-04",
      from: OTHER_ADDRESS,
      to: USER_ADDRESS,
      valueIn: 10, // Same value
      valueOut: 0,
      fee: 0.001,
      method: "",
    };

    const processedFeeHashes = new Set<TxHash>();
    const nativeByHash = new Map<TxHash, ParsedNativeTx>();
    nativeByHash.set("0xabc123" as TxHash, nativeTx);

    const result = transformInternalRows(rows, config, nativeByHash, processedFeeHashes);
    expect(result).toHaveLength(0);
  });

  it("skips internal tx that duplicates native tx (same valueOut)", () => {
    const rows = [
      {
        "Transaction Hash": "0xabc123",
        "DateTime (UTC)": "2024-12-04",
        From: USER_ADDRESS,
        To: OTHER_ADDRESS,
        "Value_IN(MNT)": "0",
        "Value_OUT(MNT)": "20",
      },
    ];

    const nativeTx: ParsedNativeTx = {
      txHash: "0xabc123" as TxHash,
      dateTime: "2024-12-04",
      from: USER_ADDRESS,
      to: OTHER_ADDRESS,
      valueIn: 0,
      valueOut: 20, // Same value
      fee: 0.001,
      method: "",
    };

    const processedFeeHashes = new Set<TxHash>();
    const nativeByHash = new Map<TxHash, ParsedNativeTx>();
    nativeByHash.set("0xabc123" as TxHash, nativeTx);

    const result = transformInternalRows(rows, config, nativeByHash, processedFeeHashes);
    expect(result).toHaveLength(0);
  });

  it("includes internal tx when values differ from native tx", () => {
    const rows = [
      {
        "Transaction Hash": "0xabc123",
        "DateTime (UTC)": "2024-12-04",
        From: OTHER_ADDRESS,
        To: USER_ADDRESS,
        "Value_IN(MNT)": "5",
        "Value_OUT(MNT)": "0",
      },
    ];

    const nativeTx: ParsedNativeTx = {
      txHash: "0xabc123" as TxHash,
      dateTime: "2024-12-04",
      from: OTHER_ADDRESS,
      to: USER_ADDRESS,
      valueIn: 10, // Different value
      valueOut: 0,
      fee: 0.001,
      method: "",
    };

    const processedFeeHashes = new Set<TxHash>();
    const nativeByHash = new Map<TxHash, ParsedNativeTx>();
    nativeByHash.set("0xabc123" as TxHash, nativeTx);

    const result = transformInternalRows(rows, config, nativeByHash, processedFeeHashes);
    expect(result).toHaveLength(1);
    expect(result[0]?.Type).toBe("Deposit");
    expect(result[0]?.BuyAmount).toBe("5");
  });

  it("includes internal tx when no native tx exists", () => {
    const rows = [
      {
        "Transaction Hash": "0xabc123",
        "DateTime (UTC)": "2024-12-04",
        From: OTHER_ADDRESS,
        To: USER_ADDRESS,
        "Value_IN(MNT)": "15",
        "Value_OUT(MNT)": "0",
      },
    ];

    const processedFeeHashes = new Set<TxHash>();
    const nativeByHash = new Map<TxHash, ParsedNativeTx>();

    const result = transformInternalRows(rows, config, nativeByHash, processedFeeHashes);
    expect(result).toHaveLength(1);
    expect(result[0]?.Type).toBe("Deposit");
  });
});

describe("transformInternalRows", () => {
  const config = {
    address: USER_ADDRESS,
    nativeSymbol: "MNT",
    exchange: "Mantle",
  };

  it("transforms multiple internal transactions", () => {
    const rows = [
      {
        "Transaction Hash": "0xabc",
        "DateTime (UTC)": "2024-12-04",
        From: OTHER_ADDRESS,
        To: USER_ADDRESS,
        "Value_IN(MNT)": "10",
        "Value_OUT(MNT)": "0",
      },
      {
        "Transaction Hash": "0xdef",
        "DateTime (UTC)": "2024-12-05",
        From: USER_ADDRESS,
        To: OTHER_ADDRESS,
        "Value_IN(MNT)": "0",
        "Value_OUT(MNT)": "5",
      },
    ];

    const processedFeeHashes = new Set<TxHash>();
    const nativeByHash = new Map<TxHash, ParsedNativeTx>();

    const result = transformInternalRows(rows, config, nativeByHash, processedFeeHashes);

    expect(result).toHaveLength(2);
    expect(result[0]?.Type).toBe("Deposit");
    expect(result[0]?.BuyAmount).toBe("10");
    expect(result[1]?.Type).toBe("Withdrawal");
    expect(result[1]?.SellAmount).toBe("5");
  });

  it("sets exchange from config", () => {
    const rows = [
      {
        "Transaction Hash": "0xabc",
        "DateTime (UTC)": "2024-12-04",
        From: OTHER_ADDRESS,
        To: USER_ADDRESS,
        "Value_IN(MNT)": "10",
        "Value_OUT(MNT)": "0",
      },
    ];

    const processedFeeHashes = new Set<TxHash>();
    const nativeByHash = new Map<TxHash, ParsedNativeTx>();

    const result = transformInternalRows(rows, config, nativeByHash, processedFeeHashes);

    expect(result[0]?.Exchange).toBe("Mantle");
  });

  it("preserves dateTime in output", () => {
    const rows = [
      {
        "Transaction Hash": "0xabc",
        "DateTime (UTC)": "2024-12-04 15:30:00",
        From: OTHER_ADDRESS,
        To: USER_ADDRESS,
        "Value_IN(MNT)": "10",
        "Value_OUT(MNT)": "0",
      },
    ];

    const processedFeeHashes = new Set<TxHash>();
    const nativeByHash = new Map<TxHash, ParsedNativeTx>();

    const result = transformInternalRows(rows, config, nativeByHash, processedFeeHashes);

    expect(result[0]?.Date).toBe("2024-12-04 15:30:00");
  });
});
