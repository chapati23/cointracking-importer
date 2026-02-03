import { describe, expect, it } from "vitest";
import { parseNativeRow, shouldSkipNativeTx, transformNativeRows } from "../../src/transformers/native.js";
import { toAddress, type TxHash } from "../../src/types.js";

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
  it("skips Approve transactions with zero value", () => {
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
    expect(shouldSkipNativeTx(tx)).toBe(true);
  });

  it("skips any transaction with zero in and out", () => {
    const tx = {
      txHash: "0xabc" as TxHash,
      dateTime: "2024-12-04",
      from: USER_ADDRESS,
      to: toAddress("0xcontract"),
      valueIn: 0,
      valueOut: 0,
      fee: 0.001,
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

  it("skips Approve transactions", () => {
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

    expect(result).toHaveLength(0);
  });
});
