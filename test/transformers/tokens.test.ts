import { describe, expect, it } from "vitest";
import {
  classifyTransfers,
  groupByTxHash,
  parseTokenRow,
  parseTokenRows,
  transformTokenRows,
} from "../../src/transformers/tokens.js";
import {
  toAddress,
  type ParsedNativeTx,
  type ParsedTokenTransfer,
  type TxHash,
} from "../../src/types.js";

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
    expect(parsed.value).toBeCloseTo(139.3634, 4);
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
    const row = result.rows[0];
    expect(row).toBeDefined();
    expect(row?.Type).toBe("Withdrawal");
    expect(row?.SellAmount).toBe("100");
    expect(row?.SellCurrency).toBe("TOKEN");
    expect(row?.Comment).toContain("burn");
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

  it("creates Deposit for incoming token (from non-zero address)", () => {
    const rows = [
      {
        "Transaction Hash": "0xdeposit123",
        "DateTime (UTC)": "2024-12-04 12:00:00",
        From: "0xsender",
        To: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        TokenValue: "500",
        TokenSymbol: "USDC",
        TokenName: "USD Coin",
        ContractAddress: "0xusdc",
      },
    ];

    const nativeByHash = new Map<TxHash, ParsedNativeTx>();
    const processedFeeHashes = new Set<TxHash>();
    const result = transformTokenRows(rows, config, nativeByHash, processedFeeHashes);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      Type: "Deposit",
      BuyAmount: "500",
      BuyCurrency: "USDC",
    });
  });

  it("handles multi-token swap (2+ outgoing, 1 incoming)", () => {
    const rows = [
      // First outgoing token
      {
        "Transaction Hash": "0xmultiswap",
        "DateTime (UTC)": "2024-12-04 12:00:00",
        From: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        To: "0xrouter",
        TokenValue: "100",
        TokenSymbol: "USDC",
        TokenName: "USD Coin",
        ContractAddress: "0xusdc",
      },
      // Second outgoing token (ignored in result)
      {
        "Transaction Hash": "0xmultiswap",
        "DateTime (UTC)": "2024-12-04 12:00:00",
        From: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        To: "0xrouter",
        TokenValue: "50",
        TokenSymbol: "DAI",
        TokenName: "Dai Stablecoin",
        ContractAddress: "0xdai",
      },
      // Incoming token
      {
        "Transaction Hash": "0xmultiswap",
        "DateTime (UTC)": "2024-12-04 12:00:00",
        From: "0xrouter",
        To: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        TokenValue: "0.08",
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
      BuyAmount: "0.08",
      BuyCurrency: "WETH",
      SellAmount: "100", // First outgoing
      SellCurrency: "USDC",
    });
  });

  it("handles multi-token swap (1 outgoing, 2+ incoming)", () => {
    const rows = [
      // Outgoing token
      {
        "Transaction Hash": "0xmultiswap2",
        "DateTime (UTC)": "2024-12-04 12:00:00",
        From: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        To: "0xrouter",
        TokenValue: "1",
        TokenSymbol: "WETH",
        TokenName: "Wrapped Ether",
        ContractAddress: "0xweth",
      },
      // First incoming token (ignored in result)
      {
        "Transaction Hash": "0xmultiswap2",
        "DateTime (UTC)": "2024-12-04 12:00:00",
        From: "0xrouter",
        To: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        TokenValue: "1000",
        TokenSymbol: "USDC",
        TokenName: "USD Coin",
        ContractAddress: "0xusdc",
      },
      // Second incoming token (used in result - last incoming)
      {
        "Transaction Hash": "0xmultiswap2",
        "DateTime (UTC)": "2024-12-04 12:00:00",
        From: "0xrouter",
        To: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        TokenValue: "1000",
        TokenSymbol: "DAI",
        TokenName: "Dai Stablecoin",
        ContractAddress: "0xdai",
      },
    ];

    const nativeByHash = new Map<TxHash, ParsedNativeTx>();
    const processedFeeHashes = new Set<TxHash>();
    const result = transformTokenRows(rows, config, nativeByHash, processedFeeHashes);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      Type: "Trade",
      BuyAmount: "1000",
      BuyCurrency: "DAI", // Last incoming
      SellAmount: "1",
      SellCurrency: "WETH",
    });
  });

  it("filters out zero value transfers", () => {
    const rows = [
      {
        "Transaction Hash": "0xzero",
        "DateTime (UTC)": "2024-12-04 12:00:00",
        From: "0xsender",
        To: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        TokenValue: "0",
        TokenSymbol: "TOKEN",
        TokenName: "Token",
        ContractAddress: "0xtoken",
      },
    ];

    const nativeByHash = new Map<TxHash, ParsedNativeTx>();
    const processedFeeHashes = new Set<TxHash>();
    const result = transformTokenRows(rows, config, nativeByHash, processedFeeHashes);

    expect(result.rows).toHaveLength(0);
  });

  it("returns processedHashes for skipping in native transformer", () => {
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

    expect(result.processedHashes.has("0xswap123" as TxHash)).toBe(true);
  });

  it("applies fee from native transaction to swap", () => {
    const rows = [
      {
        "Transaction Hash": "0xswapfee",
        "DateTime (UTC)": "2024-12-04 12:00:00",
        From: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        To: "0xrouter",
        TokenValue: "100",
        TokenSymbol: "USDC",
        TokenName: "USD Coin",
        ContractAddress: "0xusdc",
      },
      {
        "Transaction Hash": "0xswapfee",
        "DateTime (UTC)": "2024-12-04 12:00:00",
        From: "0xrouter",
        To: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        TokenValue: "0.05",
        TokenSymbol: "WETH",
        TokenName: "Wrapped Ether",
        ContractAddress: "0xweth",
      },
    ];

    const nativeTx: ParsedNativeTx = {
      txHash: "0xswapfee" as TxHash,
      dateTime: "2024-12-04 12:00:00",
      from: USER_ADDRESS,
      to: toAddress("0xrouter"),
      valueIn: 0,
      valueOut: 0,
      fee: 0.005,
      method: "",
    };

    const nativeByHash = new Map<TxHash, ParsedNativeTx>();
    nativeByHash.set("0xswapfee" as TxHash, nativeTx);

    const processedFeeHashes = new Set<TxHash>();
    const result = transformTokenRows(rows, config, nativeByHash, processedFeeHashes);

    expect(result.rows[0]?.Fee).toBe("0.005");
    expect(result.rows[0]?.FeeCurrency).toBe("MNT");
  });

  it("creates Trade for incoming token with ETH payment (NFT mint)", () => {
    const rows = [
      {
        "Transaction Hash": "0xnftmint",
        "DateTime (UTC)": "2024-12-04 12:00:00",
        From: "0x0000000000000000000000000000000000000000",
        To: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        TokenValue: "1",
        TokenSymbol: "$HEY",
        TokenName: "Hey!",
        ContractAddress: "0xnftcontract",
      },
    ];

    const nativeTx: ParsedNativeTx = {
      txHash: "0xnftmint" as TxHash,
      dateTime: "2024-12-04 12:00:00",
      from: toAddress("0xd8da6bf26964af9d7eed9e03e53415d37aa96045"),
      to: toAddress("0xnftcontract"),
      valueIn: 0,
      valueOut: 0.002777,
      fee: 0.0001,
      method: "mint",
    };

    const nativeByHash = new Map<TxHash, ParsedNativeTx>();
    nativeByHash.set("0xnftmint" as TxHash, nativeTx);
    const processedFeeHashes = new Set<TxHash>();
    const result = transformTokenRows(rows, config, nativeByHash, processedFeeHashes);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      Type: "Trade",
      BuyAmount: "1",
      BuyCurrency: "$HEY",
      SellAmount: "0.002777",
      SellCurrency: "MNT",
      Fee: "0.0001",
      FeeCurrency: "MNT",
    });
    expect(result.rows[0]?.Comment).toContain("NFT mint (trade)");
  });

  it("creates Trade for incoming token with ETH payment (NFT purchase)", () => {
    const rows = [
      {
        "Transaction Hash": "0xnftbuy",
        "DateTime (UTC)": "2024-12-04 12:00:00",
        From: "0xseller",
        To: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        TokenValue: "1",
        TokenSymbol: "RAINBOW",
        TokenName: "Rainbow NFT",
        ContractAddress: "0xrainbow",
      },
    ];

    const nativeTx: ParsedNativeTx = {
      txHash: "0xnftbuy" as TxHash,
      dateTime: "2024-12-04 12:00:00",
      from: toAddress("0xd8da6bf26964af9d7eed9e03e53415d37aa96045"),
      to: toAddress("0x00000000000000adc04c56bf30ac9d3c0aaf14dc"),
      valueIn: 0,
      valueOut: 0.00139,
      fee: 0.00002,
      method: "transfer",
    };

    const nativeByHash = new Map<TxHash, ParsedNativeTx>();
    nativeByHash.set("0xnftbuy" as TxHash, nativeTx);
    const processedFeeHashes = new Set<TxHash>();
    const result = transformTokenRows(rows, config, nativeByHash, processedFeeHashes);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      Type: "Trade",
      BuyAmount: "1",
      BuyCurrency: "RAINBOW",
      SellAmount: "0.00139",
      SellCurrency: "MNT",
    });
    expect(result.rows[0]?.Comment).toContain("NFT purchase (trade)");
  });

  it("keeps Airdrop for mint without ETH payment even with native TX", () => {
    const rows = [
      {
        "Transaction Hash": "0xfreeairdrop",
        "DateTime (UTC)": "2024-12-04 12:00:00",
        From: "0x0000000000000000000000000000000000000000",
        To: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        TokenValue: "1",
        TokenSymbol: "FREE",
        TokenName: "Free NFT",
        ContractAddress: "0xfree",
      },
    ];

    const nativeTx: ParsedNativeTx = {
      txHash: "0xfreeairdrop" as TxHash,
      dateTime: "2024-12-04 12:00:00",
      from: toAddress("0xd8da6bf26964af9d7eed9e03e53415d37aa96045"),
      to: toAddress("0xfree"),
      valueIn: 0,
      valueOut: 0,
      fee: 0.0001,
      method: "claim",
    };

    const nativeByHash = new Map<TxHash, ParsedNativeTx>();
    nativeByHash.set("0xfreeairdrop" as TxHash, nativeTx);
    const processedFeeHashes = new Set<TxHash>();
    const result = transformTokenRows(rows, config, nativeByHash, processedFeeHashes);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      Type: "Airdrop",
      BuyAmount: "1",
      BuyCurrency: "FREE",
      SellAmount: "",
      SellCurrency: "",
    });
  });
});

describe("parseTokenRows", () => {
  it("parses multiple rows", () => {
    const rows = [
      {
        "Transaction Hash": "0xabc",
        "DateTime (UTC)": "2024-12-04",
        From: "0xfrom1",
        To: "0xto1",
        TokenValue: "10",
        TokenSymbol: "TOKEN1",
        TokenName: "Token 1",
        ContractAddress: "0xcontract1",
      },
      {
        "Transaction Hash": "0xdef",
        "DateTime (UTC)": "2024-12-05",
        From: "0xfrom2",
        To: "0xto2",
        TokenValue: "20",
        TokenSymbol: "TOKEN2",
        TokenName: "Token 2",
        ContractAddress: "0xcontract2",
      },
    ];

    const parsed = parseTokenRows(rows);
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
        TokenValue: "10",
        TokenSymbol: "TOKEN",
        TokenName: "",
        ContractAddress: "",
      },
      {
        "Transaction Hash": "",
        "DateTime (UTC)": "2024-12-04",
        From: "0xfrom2",
        To: "0xto2",
        TokenValue: "5",
        TokenSymbol: "TOKEN2",
        TokenName: "",
        ContractAddress: "",
      },
    ];

    const parsed = parseTokenRows(rows);
    expect(parsed).toHaveLength(1);
  });

  it("filters out rows with zero value", () => {
    const rows = [
      {
        "Transaction Hash": "0xabc",
        "DateTime (UTC)": "2024-12-04",
        From: "0xfrom",
        To: "0xto",
        TokenValue: "10",
        TokenSymbol: "TOKEN",
        TokenName: "",
        ContractAddress: "",
      },
      {
        "Transaction Hash": "0xdef",
        "DateTime (UTC)": "2024-12-04",
        From: "0xfrom2",
        To: "0xto2",
        TokenValue: "0",
        TokenSymbol: "TOKEN2",
        TokenName: "",
        ContractAddress: "",
      },
    ];

    const parsed = parseTokenRows(rows);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.txHash).toBe("0xabc");
  });
});

describe("groupByTxHash", () => {
  it("groups transfers by transaction hash", () => {
    const transfers: ParsedTokenTransfer[] = [
      {
        txHash: "0xabc" as TxHash,
        dateTime: "2024-12-04",
        from: toAddress("0xfrom1"),
        to: toAddress("0xto1"),
        value: 10,
        symbol: "TOKEN1",
        tokenName: "",
        contractAddress: toAddress("0xcontract1"),
      },
      {
        txHash: "0xabc" as TxHash, // Same hash
        dateTime: "2024-12-04",
        from: toAddress("0xfrom2"),
        to: toAddress("0xto2"),
        value: 20,
        symbol: "TOKEN2",
        tokenName: "",
        contractAddress: toAddress("0xcontract2"),
      },
      {
        txHash: "0xdef" as TxHash, // Different hash
        dateTime: "2024-12-05",
        from: toAddress("0xfrom3"),
        to: toAddress("0xto3"),
        value: 30,
        symbol: "TOKEN3",
        tokenName: "",
        contractAddress: toAddress("0xcontract3"),
      },
    ];

    const grouped = groupByTxHash(transfers);

    expect(grouped.size).toBe(2);
    expect(grouped.get("0xabc" as TxHash)).toHaveLength(2);
    expect(grouped.get("0xdef" as TxHash)).toHaveLength(1);
  });
});

describe("classifyTransfers", () => {
  it("classifies outgoing and incoming transfers", () => {
    const transfers: ParsedTokenTransfer[] = [
      {
        txHash: "0xabc" as TxHash,
        dateTime: "2024-12-04",
        from: USER_ADDRESS,
        to: toAddress("0xrouter"),
        value: 100,
        symbol: "USDC",
        tokenName: "",
        contractAddress: toAddress("0xusdc"),
      },
      {
        txHash: "0xabc" as TxHash,
        dateTime: "2024-12-04",
        from: toAddress("0xrouter"),
        to: USER_ADDRESS,
        value: 0.05,
        symbol: "WETH",
        tokenName: "",
        contractAddress: toAddress("0xweth"),
      },
    ];

    const classified = classifyTransfers(transfers, USER_ADDRESS);

    expect(classified.outgoing).toHaveLength(1);
    expect(classified.incoming).toHaveLength(1);
    expect(classified.outgoing[0]?.symbol).toBe("USDC");
    expect(classified.incoming[0]?.symbol).toBe("WETH");
  });

  it("excludes self-transfers from outgoing", () => {
    const transfers: ParsedTokenTransfer[] = [
      {
        txHash: "0xabc" as TxHash,
        dateTime: "2024-12-04",
        from: USER_ADDRESS,
        to: USER_ADDRESS, // Self-transfer
        value: 100,
        symbol: "TOKEN",
        tokenName: "",
        contractAddress: toAddress("0xtoken"),
      },
    ];

    const classified = classifyTransfers(transfers, USER_ADDRESS);

    expect(classified.outgoing).toHaveLength(0);
    expect(classified.incoming).toHaveLength(0);
  });
});
