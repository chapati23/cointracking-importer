import { describe, expect, it } from "vitest";
import {
  indexNativeByHash,
  parseNativeRow,
  parseNativeRows,
  shouldSkipNativeTx,
  transformNativeRows,
  transformNativeTx,
} from "../../src/transformers/native.js";
import { toAddress, type ParsedNativeTx, type TxHash } from "../../src/types.js";

const USER_ADDRESS = toAddress("0xd8da6bf26964af9d7eed9e03e53415d37aa96045");

describe("parseNativeRow", () => {
  it("parses MantleScan native row correctly", () => {
    const row = {
      "Transaction Hash": "0xabc123",
      "DateTime (UTC)": "2024-12-04 11:52:56",
      From: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
      To: "0x1111111111111111111111111111111111111111",
      "Value_IN(MNT)": "0",
      "Value_OUT(MNT)": "109",
      "TxnFee(MNT)": "0.001",
      Method: "Transfer",
    };

    const parsed = parseNativeRow(row);
    expect(parsed.txHash).toBe("0xabc123");
    expect(parsed.dateTime).toBe("2024-12-04 11:52:56");
    expect(parsed.from).toBe("0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
    expect(parsed.valueIn).toBe(0);
    expect(parsed.valueOut).toBe(109);
    expect(parsed.fee).toBe(0.001);
    expect(parsed.method).toBe("Transfer");
  });
});

describe("shouldSkipNativeTx", () => {
  it("does not skip transactions with fees even if zero value", () => {
    const tx = {
      txHash: "0xabc" as TxHash,
      dateTime: "2024-12-04",
      from: USER_ADDRESS,
      to: toAddress("0xcontract"),
      valueIn: 0,
      valueOut: 0,
      fee: 0.001,
      method: "Approve",
    };
    expect(shouldSkipNativeTx(tx)).toBe(false);
  });

  it("skips transactions with zero value AND zero fee", () => {
    const tx = {
      txHash: "0xabc" as TxHash,
      dateTime: "2024-12-04",
      from: USER_ADDRESS,
      to: toAddress("0xcontract"),
      valueIn: 0,
      valueOut: 0,
      fee: 0,
      method: "SomeMethod",
    };
    expect(shouldSkipNativeTx(tx)).toBe(true);
  });

  it("does not skip transactions with value", () => {
    const tx = {
      txHash: "0xabc" as TxHash,
      dateTime: "2024-12-04",
      from: USER_ADDRESS,
      to: toAddress("0xcontract"),
      valueIn: 0,
      valueOut: 100,
      fee: 0.001,
      method: "Transfer",
    };
    expect(shouldSkipNativeTx(tx)).toBe(false);
  });
});

describe("transformNativeRows", () => {
  const config = {
    address: USER_ADDRESS,
    nativeSymbol: "MNT",
    exchange: "Mantle",
  };

  it("creates Withdrawal for outgoing native transfer", () => {
    const rows = [
      {
        "Transaction Hash": "0xabc123",
        "DateTime (UTC)": "2024-12-04 11:54:20",
        From: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        To: "0x1111111111111111111111111111111111111111",
        "Value_IN(MNT)": "0",
        "Value_OUT(MNT)": "109",
        "TxnFee(MNT)": "0.001",
        Method: "Transfer",
      },
    ];

    const processedFeeHashes = new Set<TxHash>();
    const result = transformNativeRows(rows, config, processedFeeHashes);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      Type: "Withdrawal",
      SellAmount: "109",
      SellCurrency: "MNT",
      Exchange: "Mantle",
    });
  });

  it("creates Deposit for incoming native transfer", () => {
    const rows = [
      {
        "Transaction Hash": "0xabc123",
        "DateTime (UTC)": "2024-12-04 11:54:20",
        From: "0xsender",
        To: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        "Value_IN(MNT)": "50",
        "Value_OUT(MNT)": "0",
        "TxnFee(MNT)": "0",
        Method: "",
      },
    ];

    const processedFeeHashes = new Set<TxHash>();
    const result = transformNativeRows(rows, config, processedFeeHashes);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      Type: "Deposit",
      BuyAmount: "50",
      BuyCurrency: "MNT",
    });
  });

  it("creates Other Fee for Approve transactions with fees but no value", () => {
    const rows = [
      {
        "Transaction Hash": "0xabc123",
        "DateTime (UTC)": "2024-12-04 11:52:56",
        From: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        To: "0x1111111111111111111111111111111111111111",
        "Value_IN(MNT)": "0",
        "Value_OUT(MNT)": "0",
        "TxnFee(MNT)": "0.001",
        Method: "Approve",
      },
    ];

    const processedFeeHashes = new Set<TxHash>();
    const result = transformNativeRows(rows, config, processedFeeHashes);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      Type: "Other Fee",
      SellAmount: "0.001",
      SellCurrency: "MNT",
      Fee: "",
      FeeCurrency: "",
      Exchange: "Mantle",
      Comment: "Approve 0xabc123",
    });
  });

  it("skips transactions with zero value AND zero fee", () => {
    const rows = [
      {
        "Transaction Hash": "0xabc123",
        "DateTime (UTC)": "2024-12-04 11:52:56",
        From: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        To: "0x1111111111111111111111111111111111111111",
        "Value_IN(MNT)": "0",
        "Value_OUT(MNT)": "0",
        "TxnFee(MNT)": "0",
        Method: "Approve",
      },
    ];

    const processedFeeHashes = new Set<TxHash>();
    const result = transformNativeRows(rows, config, processedFeeHashes);

    expect(result).toHaveLength(0);
  });

  it("skips hashes in skipHashes set", () => {
    const rows = [
      {
        "Transaction Hash": "0xskipme",
        "DateTime (UTC)": "2024-12-04 11:54:20",
        From: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        To: "0x1111111111111111111111111111111111111111",
        "Value_IN(MNT)": "0",
        "Value_OUT(MNT)": "100",
        "TxnFee(MNT)": "0.001",
        Method: "Transfer",
      },
      {
        "Transaction Hash": "0xkeepme",
        "DateTime (UTC)": "2024-12-04 11:55:20",
        From: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        To: "0x1111111111111111111111111111111111111111",
        "Value_IN(MNT)": "0",
        "Value_OUT(MNT)": "50",
        "TxnFee(MNT)": "0.001",
        Method: "Transfer",
      },
    ];

    const processedFeeHashes = new Set<TxHash>();
    const skipHashes = new Set<TxHash>(["0xskipme" as TxHash]);
    const result = transformNativeRows(rows, config, processedFeeHashes, skipHashes);

    expect(result).toHaveLength(1);
    expect(result[0]?.Comment).toContain("0xkeepme");
  });
});

describe("parseNativeRows", () => {
  it("parses multiple rows", () => {
    const rows = [
      {
        "Transaction Hash": "0xabc",
        "DateTime (UTC)": "2024-12-04",
        From: "0xfrom1",
        To: "0xto1",
        "Value_IN(MNT)": "10",
        "Value_OUT(MNT)": "0",
        "TxnFee(MNT)": "0.001",
        Method: "",
      },
      {
        "Transaction Hash": "0xdef",
        "DateTime (UTC)": "2024-12-05",
        From: "0xfrom2",
        To: "0xto2",
        "Value_IN(MNT)": "0",
        "Value_OUT(MNT)": "20",
        "TxnFee(MNT)": "0.002",
        Method: "Transfer",
      },
    ];

    const parsed = parseNativeRows(rows);
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
        "TxnFee(MNT)": "0.001",
        Method: "",
      },
      {
        "Transaction Hash": "",
        "DateTime (UTC)": "2024-12-04",
        From: "0xfrom2",
        To: "0xto2",
        "Value_IN(MNT)": "5",
        "Value_OUT(MNT)": "0",
        "TxnFee(MNT)": "0.001",
        Method: "",
      },
    ];

    const parsed = parseNativeRows(rows);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.txHash).toBe("0xabc");
  });
});

describe("indexNativeByHash", () => {
  it("creates correct index", () => {
    const txs: ParsedNativeTx[] = [
      {
        txHash: "0xabc" as TxHash,
        dateTime: "2024-12-04",
        from: toAddress("0xfrom1"),
        to: toAddress("0xto1"),
        valueIn: 10,
        valueOut: 0,
        fee: 0.001,
        method: "",
      },
      {
        txHash: "0xdef" as TxHash,
        dateTime: "2024-12-05",
        from: toAddress("0xfrom2"),
        to: toAddress("0xto2"),
        valueIn: 0,
        valueOut: 20,
        fee: 0.002,
        method: "Transfer",
      },
    ];

    const index = indexNativeByHash(txs);

    expect(index.size).toBe(2);
    expect(index.get("0xabc" as TxHash)?.valueIn).toBe(10);
    expect(index.get("0xdef" as TxHash)?.valueOut).toBe(20);
  });

  it("overwrites duplicate hashes with last occurrence", () => {
    const txs: ParsedNativeTx[] = [
      {
        txHash: "0xsame" as TxHash,
        dateTime: "2024-12-04",
        from: toAddress("0xfrom1"),
        to: toAddress("0xto1"),
        valueIn: 10,
        valueOut: 0,
        fee: 0.001,
        method: "First",
      },
      {
        txHash: "0xsame" as TxHash,
        dateTime: "2024-12-05",
        from: toAddress("0xfrom2"),
        to: toAddress("0xto2"),
        valueIn: 0,
        valueOut: 20,
        fee: 0.002,
        method: "Second",
      },
    ];

    const index = indexNativeByHash(txs);

    expect(index.size).toBe(1);
    expect(index.get("0xsame" as TxHash)?.method).toBe("Second");
  });

  it("skips empty txHash", () => {
    const txs: ParsedNativeTx[] = [
      {
        txHash: "" as TxHash,
        dateTime: "2024-12-04",
        from: toAddress("0xfrom1"),
        to: toAddress("0xto1"),
        valueIn: 10,
        valueOut: 0,
        fee: 0.001,
        method: "",
      },
    ];

    const index = indexNativeByHash(txs);
    expect(index.size).toBe(0);
  });
});

describe("transformNativeTx - edge cases", () => {
  const config = {
    address: USER_ADDRESS,
    nativeSymbol: "MNT",
    exchange: "Mantle",
  };

  it("handles very large values with decimal precision", () => {
    const tx: ParsedNativeTx = {
      txHash: "0xabc" as TxHash,
      dateTime: "2024-12-04",
      from: toAddress("0xsender"),
      to: USER_ADDRESS,
      valueIn: 1234567890.12345,
      valueOut: 0,
      fee: 0.000001,
      method: "",
    };

    const processedFeeHashes = new Set<TxHash>();
    const result = transformNativeTx(tx, config, processedFeeHashes);

    expect(result).not.toBeNull();
    expect(result?.BuyAmount).toBe("1234567890.12345");
    expect(result?.Fee).toBe("0.000001");
  });

  it("applies fee only once per transaction hash", () => {
    const tx1: ParsedNativeTx = {
      txHash: "0xsame" as TxHash,
      dateTime: "2024-12-04",
      from: toAddress("0xsender"),
      to: USER_ADDRESS,
      valueIn: 10,
      valueOut: 0,
      fee: 0.001,
      method: "",
    };

    const tx2: ParsedNativeTx = {
      txHash: "0xsame" as TxHash,
      dateTime: "2024-12-04",
      from: USER_ADDRESS,
      to: toAddress("0xreceiver"),
      valueIn: 0,
      valueOut: 5,
      fee: 0.001,
      method: "",
    };

    const processedFeeHashes = new Set<TxHash>();

    const result1 = transformNativeTx(tx1, config, processedFeeHashes);
    const result2 = transformNativeTx(tx2, config, processedFeeHashes);

    expect(result1?.Fee).toBe("0.001");
    expect(result2?.Fee).toBe(""); // Fee already processed
  });

  it("handles transactions with empty method field", () => {
    const tx: ParsedNativeTx = {
      txHash: "0xabc" as TxHash,
      dateTime: "2024-12-04",
      from: USER_ADDRESS,
      to: toAddress("0xreceiver"),
      valueIn: 0,
      valueOut: 100,
      fee: 0.001,
      method: "",
    };

    const processedFeeHashes = new Set<TxHash>();
    const result = transformNativeTx(tx, config, processedFeeHashes);

    expect(result).not.toBeNull();
    expect(result?.Comment).toBe("Native out 0xabc");
  });

  it("includes method in comment when present", () => {
    const tx: ParsedNativeTx = {
      txHash: "0xabc" as TxHash,
      dateTime: "2024-12-04",
      from: USER_ADDRESS,
      to: toAddress("0xreceiver"),
      valueIn: 0,
      valueOut: 100,
      fee: 0.001,
      method: "swap",
    };

    const processedFeeHashes = new Set<TxHash>();
    const result = transformNativeTx(tx, config, processedFeeHashes);

    expect(result?.Comment).toBe("swap 0xabc");
  });

  it("creates Deposit for bridge self-transfer (from === to === address)", () => {
    const tx: ParsedNativeTx = {
      txHash: "0xabc" as TxHash,
      dateTime: "2024-12-04",
      from: USER_ADDRESS,
      to: USER_ADDRESS,
      valueIn: 100,
      valueOut: 0,
      fee: 0.001,
      method: "",
    };

    const processedFeeHashes = new Set<TxHash>();
    const result = transformNativeTx(tx, config, processedFeeHashes);

    // Self-transfers are bridge deposits (e.g. L1→L2 OP Stack)
    expect(result).toEqual({
      Type: "Deposit",
      BuyAmount: "100",
      BuyCurrency: "MNT",
      SellAmount: "",
      SellCurrency: "",
      Fee: "0.001",
      FeeCurrency: "MNT",
      Exchange: "Mantle",
      TradeGroup: "",
      Comment: "Bridge deposit 0xabc",
      Date: "2024-12-04",
    });
  });

  it("creates Withdrawal when user is both sender and receiver with valueOut", () => {
    const tx: ParsedNativeTx = {
      txHash: "0xabc" as TxHash,
      dateTime: "2024-12-04",
      from: USER_ADDRESS,
      to: USER_ADDRESS,
      valueIn: 0,
      valueOut: 100,
      fee: 0.001,
      method: "",
    };

    const processedFeeHashes = new Set<TxHash>();
    const result = transformNativeTx(tx, config, processedFeeHashes);

    // Should create Withdrawal because from === config.address and valueOut > 0
    expect(result).not.toBeNull();
    expect(result?.Type).toBe("Withdrawal");
  });

  it("preserves dateTime exactly in output", () => {
    const tx: ParsedNativeTx = {
      txHash: "0xabc" as TxHash,
      dateTime: "2024-12-04 15:30:45",
      from: toAddress("0xsender"),
      to: USER_ADDRESS,
      valueIn: 10,
      valueOut: 0,
      fee: 0,
      method: "",
    };

    const processedFeeHashes = new Set<TxHash>();
    const result = transformNativeTx(tx, config, processedFeeHashes);

    expect(result?.Date).toBe("2024-12-04 15:30:45");
  });
});
