import { describe, expect, it } from "vitest";
import { parseTokenRow, transformTokenRows } from "../../src/transformers/tokens.js";
import { toAddress, type ParsedNativeTx, type TxHash } from "../../src/types.js";

const USER_ADDRESS = toAddress("0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
const ZERO_ADDRESS = toAddress("0x0000000000000000000000000000000000000000");

describe("parseTokenRow", () => {
  it("parses MantleScan token row correctly", () => {
    const row = {
      "Transaction Hash": "0xabc123",
      "DateTime (UTC)": "2024-12-04 11:54:20",
      From: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
      To: "0x0000000000000000000000000000000000000000",
      TokenValue: "139.363383787305758606",
      TokenSymbol: "PENDLE",
      TokenName: "ERC-20: PENDLE",
      ContractAddress: "0xcontract",
    };

    const parsed = parseTokenRow(row);
    expect(parsed.txHash).toBe("0xabc123");
    expect(parsed.value).toBeCloseTo(139.363383787305758606);
    expect(parsed.symbol).toBe("PENDLE");
    expect(parsed.to).toBe(ZERO_ADDRESS);
  });
});

describe("transformTokenRows", () => {
  const config = {
    address: USER_ADDRESS,
    nativeSymbol: "MNT",
    exchange: "Mantle",
  };

  it("creates Withdrawal for token burn (to zero address)", () => {
    const rows = [
      {
        "Transaction Hash": "0xabc123",
        "DateTime (UTC)": "2024-12-04 11:54:20",
        From: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        To: "0x0000000000000000000000000000000000000000",
        TokenValue: "100",
        TokenSymbol: "TOKEN",
        TokenName: "Token",
        ContractAddress: "0xcontract",
      },
    ];

    const nativeByHash = new Map<TxHash, ParsedNativeTx>();
    const processedFeeHashes = new Set<TxHash>();
    const result = transformTokenRows(rows, config, nativeByHash, processedFeeHashes);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      Type: "Withdrawal",
      SellAmount: "100",
      SellCurrency: "TOKEN",
      Comment: expect.stringContaining("burn"),
    });
  });

  it("detects simple 1:1 swap", () => {
    const rows = [
      {
        "Transaction Hash": "0xswap123",
        "DateTime (UTC)": "2024-12-04 12:00:00",
        From: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        To: "0xrouter",
        TokenValue: "100",
        TokenSymbol: "USDC",
        TokenName: "USD Coin",
        ContractAddress: "0xusdc",
      },
      {
        "Transaction Hash": "0xswap123",
        "DateTime (UTC)": "2024-12-04 12:00:00",
        From: "0xrouter",
        To: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        TokenValue: "0.05",
        TokenSymbol: "WETH",
        TokenName: "Wrapped Ether",
        ContractAddress: "0xweth",
      },
    ];

    const nativeByHash = new Map<TxHash, ParsedNativeTx>();
    const processedFeeHashes = new Set<TxHash>();
    const result = transformTokenRows(rows, config, nativeByHash, processedFeeHashes);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      Type: "Trade",
      BuyAmount: "0.05",
      BuyCurrency: "WETH",
      SellAmount: "100",
      SellCurrency: "USDC",
    });
  });

  it("creates Deposit for incoming token (airdrop from zero)", () => {
    const rows = [
      {
        "Transaction Hash": "0xmint123",
        "DateTime (UTC)": "2024-12-04 12:00:00",
        From: "0x0000000000000000000000000000000000000000",
        To: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        TokenValue: "1000",
        TokenSymbol: "AIRDROP",
        TokenName: "Airdrop Token",
        ContractAddress: "0xairdrop",
      },
    ];

    const nativeByHash = new Map<TxHash, ParsedNativeTx>();
    const processedFeeHashes = new Set<TxHash>();
    const result = transformTokenRows(rows, config, nativeByHash, processedFeeHashes);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      Type: "Airdrop",
      BuyAmount: "1000",
      BuyCurrency: "AIRDROP",
    });
  });
});
