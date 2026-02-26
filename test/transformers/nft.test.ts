import { describe, expect, it } from "vitest";
import {
  formatNftCurrency,
  parseNftRow,
  parseNftRows,
  transformNftRows,
  transformNftTransfer,
} from "../../src/transformers/nft.js";
import {
  toAddress,
  ZERO_ADDRESS,
  type ParsedNativeTx,
  type ParsedNftTransfer,
  type TxHash,
} from "../../src/types.js";

const USER_ADDRESS = toAddress("0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
const OTHER_ADDRESS = toAddress("0x1111111111111111111111111111111111111111");
const CONTRACT_ADDRESS = toAddress("0x2222222222222222222222222222222222222222");

describe("parseNftRow", () => {
  describe("ERC-721", () => {
    it("parses ERC-721 NFT row correctly", () => {
      const row = {
        "Transaction Hash": "0xabc123",
        "DateTime (UTC)": "2024-12-04 11:52:56",
        From: "0x1111111111111111111111111111111111111111",
        To: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        TokenId: "1234",
        TokenSymbol: "BAYC",
        TokenName: "Bored Ape Yacht Club",
        ContractAddress: "0x2222222222222222222222222222222222222222",
      };

      const parsed = parseNftRow(row, false);
      expect(parsed.txHash).toBe("0xabc123");
      expect(parsed.dateTime).toBe("2024-12-04 11:52:56");
      expect(parsed.from).toBe("0x1111111111111111111111111111111111111111");
      expect(parsed.to).toBe("0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
      expect(parsed.tokenId).toBe("1234");
      expect(parsed.tokenSymbol).toBe("BAYC");
      expect(parsed.tokenName).toBe("Bored Ape Yacht Club");
      expect(parsed.quantity).toBe(1);
    });

    it("always sets quantity to 1 for ERC-721", () => {
      const row = {
        "Transaction Hash": "0xabc123",
        "DateTime (UTC)": "2024-12-04",
        From: "0xfrom",
        To: "0xto",
        TokenId: "999",
        TokenValue: "5", // Should be ignored for ERC-721
      };

      const parsed = parseNftRow(row, false);
      expect(parsed.quantity).toBe(1);
    });

    it("uses default symbol when missing", () => {
      const row = {
        "Transaction Hash": "0xabc123",
        "DateTime (UTC)": "2024-12-04",
        From: "0xfrom",
        To: "0xto",
        TokenId: "1",
        TokenSymbol: "",
      };

      const parsed = parseNftRow(row, false);
      expect(parsed.tokenSymbol).toBe("NFT");
    });
  });

  describe("ERC-1155", () => {
    it("parses ERC-1155 NFT row correctly with quantity", () => {
      const row = {
        "Transaction Hash": "0xabc123",
        "DateTime (UTC)": "2024-12-04 11:52:56",
        From: "0x1111111111111111111111111111111111111111",
        To: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        TokenId: "5678",
        TokenSymbol: "ITEM",
        TokenValue: "10",
        ContractAddress: "0x2222222222222222222222222222222222222222",
      };

      const parsed = parseNftRow(row, true);
      expect(parsed.tokenId).toBe("5678");
      expect(parsed.tokenSymbol).toBe("ITEM");
      expect(parsed.quantity).toBe(10);
    });

    it("handles decimal quantities", () => {
      const row = {
        "Transaction Hash": "0xabc123",
        "DateTime (UTC)": "2024-12-04",
        From: "0xfrom",
        To: "0xto",
        TokenId: "1",
        TokenValue: "2.5",
      };

      const parsed = parseNftRow(row, true);
      expect(parsed.quantity).toBe(2.5);
    });

    it("handles missing TokenValue as 0", () => {
      const row = {
        "Transaction Hash": "0xabc123",
        "DateTime (UTC)": "2024-12-04",
        From: "0xfrom",
        To: "0xto",
        TokenId: "1",
      };

      const parsed = parseNftRow(row, true);
      expect(parsed.quantity).toBe(0);
    });
  });

  it("normalizes addresses to lowercase", () => {
    const row = {
      "Transaction Hash": "0xABC123",
      "DateTime (UTC)": "2024-12-04",
      From: "0xFROM",
      To: "0xTO",
      TokenId: "1",
      ContractAddress: "0xCONTRACT",
    };

    const parsed = parseNftRow(row, false);
    expect(parsed.txHash).toBe("0xabc123");
    expect(parsed.from).toBe("0xfrom");
    expect(parsed.to).toBe("0xto");
    expect(parsed.contractAddress).toBe("0xcontract");
  });
});

describe("parseNftRows", () => {
  it("parses multiple rows", () => {
    const rows = [
      {
        "Transaction Hash": "0xabc",
        "DateTime (UTC)": "2024-12-04",
        From: "0xfrom1",
        To: "0xto1",
        TokenId: "1",
      },
      {
        "Transaction Hash": "0xdef",
        "DateTime (UTC)": "2024-12-05",
        From: "0xfrom2",
        To: "0xto2",
        TokenId: "2",
      },
    ];

    const parsed = parseNftRows(rows, false);
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
        TokenId: "1",
      },
      {
        "Transaction Hash": "",
        "DateTime (UTC)": "2024-12-04",
        From: "0xfrom2",
        To: "0xto2",
        TokenId: "2",
      },
    ];

    const parsed = parseNftRows(rows, false);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.txHash).toBe("0xabc");
  });
});

describe("formatNftCurrency", () => {
  it("formats NFT currency correctly", () => {
    const transfer: ParsedNftTransfer = {
      txHash: "0xabc" as TxHash,
      dateTime: "2024-12-04",
      from: OTHER_ADDRESS,
      to: USER_ADDRESS,
      tokenId: "1234",
      tokenSymbol: "BAYC",
      tokenName: "Bored Ape",
      contractAddress: CONTRACT_ADDRESS,
      quantity: 1,
    };

    expect(formatNftCurrency(transfer)).toBe("NFT:BAYC#1234");
  });

  it("uses default symbol when missing", () => {
    const transfer: ParsedNftTransfer = {
      txHash: "0xabc" as TxHash,
      dateTime: "2024-12-04",
      from: OTHER_ADDRESS,
      to: USER_ADDRESS,
      tokenId: "5678",
      tokenSymbol: "",
      tokenName: "",
      contractAddress: CONTRACT_ADDRESS,
      quantity: 1,
    };

    expect(formatNftCurrency(transfer)).toBe("NFT:NFT#5678");
  });

  it("handles special characters in token ID", () => {
    const transfer: ParsedNftTransfer = {
      txHash: "0xabc" as TxHash,
      dateTime: "2024-12-04",
      from: OTHER_ADDRESS,
      to: USER_ADDRESS,
      tokenId: "12345678901234567890",
      tokenSymbol: "LONG",
      tokenName: "",
      contractAddress: CONTRACT_ADDRESS,
      quantity: 1,
    };

    expect(formatNftCurrency(transfer)).toBe("NFT:LONG#12345678901234567890");
  });
});

describe("transformNftTransfer", () => {
  const config = {
    address: USER_ADDRESS,
    nativeSymbol: "MNT",
    exchange: "Mantle",
  };

  describe("receiving NFTs", () => {
    it("creates Deposit for incoming NFT", () => {
      const transfer: ParsedNftTransfer = {
        txHash: "0xabc123" as TxHash,
        dateTime: "2024-12-04 11:52:56",
        from: OTHER_ADDRESS,
        to: USER_ADDRESS,
        tokenId: "1234",
        tokenSymbol: "BAYC",
        tokenName: "Bored Ape",
        contractAddress: CONTRACT_ADDRESS,
        quantity: 1,
      };

      const processedFeeHashes = new Set<TxHash>();
      const nativeByHash = new Map<TxHash, ParsedNativeTx>();

      const result = transformNftTransfer(transfer, config, processedFeeHashes, nativeByHash);

      expect(result).not.toBeNull();
      expect(result?.Type).toBe("Deposit");
      expect(result?.BuyAmount).toBe("1");
      expect(result?.BuyCurrency).toBe("NFT:BAYC#1234");
      expect(result?.Comment).toContain("NFT in");
    });

    it("creates Airdrop for NFT from zero address (mint)", () => {
      const transfer: ParsedNftTransfer = {
        txHash: "0xabc123" as TxHash,
        dateTime: "2024-12-04 11:52:56",
        from: ZERO_ADDRESS,
        to: USER_ADDRESS,
        tokenId: "1234",
        tokenSymbol: "BAYC",
        tokenName: "Bored Ape",
        contractAddress: CONTRACT_ADDRESS,
        quantity: 1,
      };

      const processedFeeHashes = new Set<TxHash>();
      const nativeByHash = new Map<TxHash, ParsedNativeTx>();

      const result = transformNftTransfer(transfer, config, processedFeeHashes, nativeByHash);

      expect(result).not.toBeNull();
      expect(result?.Type).toBe("Airdrop");
      expect(result?.BuyAmount).toBe("1");
      expect(result?.BuyCurrency).toBe("NFT:BAYC#1234");
      expect(result?.Comment).toContain("NFT mint");
    });
  });

  describe("NFT trade pairing (ETH payment)", () => {
    it("creates Trade for mint with ETH payment", () => {
      const transfer: ParsedNftTransfer = {
        txHash: "0xabc123" as TxHash,
        dateTime: "2024-12-04 11:52:56",
        from: ZERO_ADDRESS,
        to: USER_ADDRESS,
        tokenId: "1234",
        tokenSymbol: "BAYC",
        tokenName: "Bored Ape",
        contractAddress: CONTRACT_ADDRESS,
        quantity: 1,
      };

      const nativeTx: ParsedNativeTx = {
        txHash: "0xabc123" as TxHash,
        dateTime: "2024-12-04 11:52:56",
        from: USER_ADDRESS,
        to: CONTRACT_ADDRESS,
        valueIn: 0,
        valueOut: 0.002777,
        fee: 0.0001,
        method: "mint",
      };

      const processedFeeHashes = new Set<TxHash>();
      const nativeByHash = new Map<TxHash, ParsedNativeTx>();
      nativeByHash.set("0xabc123" as TxHash, nativeTx);

      const result = transformNftTransfer(transfer, config, processedFeeHashes, nativeByHash);

      expect(result).not.toBeNull();
      expect(result?.Type).toBe("Trade");
      expect(result?.BuyAmount).toBe("1");
      expect(result?.BuyCurrency).toBe("NFT:BAYC#1234");
      expect(result?.SellAmount).toBe("0.002777");
      expect(result?.SellCurrency).toBe("MNT");
      expect(result?.Fee).toBe("0.0001");
      expect(result?.FeeCurrency).toBe("MNT");
      expect(result?.Comment).toContain("NFT mint (trade)");
    });

    it("creates Trade for NFT purchase with ETH payment (non-mint)", () => {
      const transfer: ParsedNftTransfer = {
        txHash: "0xdef456" as TxHash,
        dateTime: "2024-12-04 11:52:56",
        from: OTHER_ADDRESS,
        to: USER_ADDRESS,
        tokenId: "5678",
        tokenSymbol: "BAYC",
        tokenName: "Bored Ape",
        contractAddress: CONTRACT_ADDRESS,
        quantity: 1,
      };

      const nativeTx: ParsedNativeTx = {
        txHash: "0xdef456" as TxHash,
        dateTime: "2024-12-04 11:52:56",
        from: USER_ADDRESS,
        to: OTHER_ADDRESS,
        valueIn: 0,
        valueOut: 0.5,
        fee: 0.0002,
        method: "transfer",
      };

      const processedFeeHashes = new Set<TxHash>();
      const nativeByHash = new Map<TxHash, ParsedNativeTx>();
      nativeByHash.set("0xdef456" as TxHash, nativeTx);

      const result = transformNftTransfer(transfer, config, processedFeeHashes, nativeByHash);

      expect(result).not.toBeNull();
      expect(result?.Type).toBe("Trade");
      expect(result?.SellAmount).toBe("0.5");
      expect(result?.Comment).toContain("NFT purchase (trade)");
    });

    it("keeps Airdrop for mint without ETH payment", () => {
      const transfer: ParsedNftTransfer = {
        txHash: "0xabc123" as TxHash,
        dateTime: "2024-12-04 11:52:56",
        from: ZERO_ADDRESS,
        to: USER_ADDRESS,
        tokenId: "1234",
        tokenSymbol: "BAYC",
        tokenName: "Bored Ape",
        contractAddress: CONTRACT_ADDRESS,
        quantity: 1,
      };

      const nativeTx: ParsedNativeTx = {
        txHash: "0xabc123" as TxHash,
        dateTime: "2024-12-04 11:52:56",
        from: USER_ADDRESS,
        to: CONTRACT_ADDRESS,
        valueIn: 0,
        valueOut: 0,
        fee: 0.0001,
        method: "mint",
      };

      const processedFeeHashes = new Set<TxHash>();
      const nativeByHash = new Map<TxHash, ParsedNativeTx>();
      nativeByHash.set("0xabc123" as TxHash, nativeTx);

      const result = transformNftTransfer(transfer, config, processedFeeHashes, nativeByHash);

      expect(result).not.toBeNull();
      expect(result?.Type).toBe("Airdrop");
    });
  });

  describe("sending NFTs", () => {
    it("creates Withdrawal for outgoing NFT", () => {
      const transfer: ParsedNftTransfer = {
        txHash: "0xabc123" as TxHash,
        dateTime: "2024-12-04 11:52:56",
        from: USER_ADDRESS,
        to: OTHER_ADDRESS,
        tokenId: "1234",
        tokenSymbol: "BAYC",
        tokenName: "Bored Ape",
        contractAddress: CONTRACT_ADDRESS,
        quantity: 1,
      };

      const processedFeeHashes = new Set<TxHash>();
      const nativeByHash = new Map<TxHash, ParsedNativeTx>();

      const result = transformNftTransfer(transfer, config, processedFeeHashes, nativeByHash);

      expect(result).not.toBeNull();
      expect(result?.Type).toBe("Withdrawal");
      expect(result?.SellAmount).toBe("1");
      expect(result?.SellCurrency).toBe("NFT:BAYC#1234");
      expect(result?.Comment).toContain("NFT out");
    });

    it("creates Lost for NFT to zero address (burn)", () => {
      const transfer: ParsedNftTransfer = {
        txHash: "0xabc123" as TxHash,
        dateTime: "2024-12-04 11:52:56",
        from: USER_ADDRESS,
        to: ZERO_ADDRESS,
        tokenId: "1234",
        tokenSymbol: "BAYC",
        tokenName: "Bored Ape",
        contractAddress: CONTRACT_ADDRESS,
        quantity: 1,
      };

      const processedFeeHashes = new Set<TxHash>();
      const nativeByHash = new Map<TxHash, ParsedNativeTx>();

      const result = transformNftTransfer(transfer, config, processedFeeHashes, nativeByHash);

      expect(result).not.toBeNull();
      expect(result?.Type).toBe("Lost");
      expect(result?.SellAmount).toBe("1");
      expect(result?.SellCurrency).toBe("NFT:BAYC#1234");
      expect(result?.Comment).toContain("NFT burn");
    });
  });

  describe("irrelevant transfers", () => {
    it("returns null for transfer not involving user", () => {
      const transfer: ParsedNftTransfer = {
        txHash: "0xabc123" as TxHash,
        dateTime: "2024-12-04 11:52:56",
        from: OTHER_ADDRESS,
        to: toAddress("0x3333333333333333333333333333333333333333"),
        tokenId: "1234",
        tokenSymbol: "BAYC",
        tokenName: "Bored Ape",
        contractAddress: CONTRACT_ADDRESS,
        quantity: 1,
      };

      const processedFeeHashes = new Set<TxHash>();
      const nativeByHash = new Map<TxHash, ParsedNativeTx>();

      const result = transformNftTransfer(transfer, config, processedFeeHashes, nativeByHash);
      expect(result).toBeNull();
    });
  });

  describe("fee handling", () => {
    it("applies fee from native transaction", () => {
      const transfer: ParsedNftTransfer = {
        txHash: "0xabc123" as TxHash,
        dateTime: "2024-12-04 11:52:56",
        from: OTHER_ADDRESS,
        to: USER_ADDRESS,
        tokenId: "1234",
        tokenSymbol: "BAYC",
        tokenName: "Bored Ape",
        contractAddress: CONTRACT_ADDRESS,
        quantity: 1,
      };

      const nativeTx: ParsedNativeTx = {
        txHash: "0xabc123" as TxHash,
        dateTime: "2024-12-04 11:52:56",
        from: OTHER_ADDRESS,
        to: USER_ADDRESS,
        valueIn: 0,
        valueOut: 0,
        fee: 0.005,
        method: "",
      };

      const processedFeeHashes = new Set<TxHash>();
      const nativeByHash = new Map<TxHash, ParsedNativeTx>();
      nativeByHash.set("0xabc123" as TxHash, nativeTx);

      const result = transformNftTransfer(transfer, config, processedFeeHashes, nativeByHash);

      expect(result).not.toBeNull();
      expect(result?.Fee).toBe("0.005");
      expect(result?.FeeCurrency).toBe("MNT");
      expect(processedFeeHashes.has("0xabc123" as TxHash)).toBe(true);
    });

    it("does not apply fee if already processed", () => {
      const transfer: ParsedNftTransfer = {
        txHash: "0xabc123" as TxHash,
        dateTime: "2024-12-04 11:52:56",
        from: OTHER_ADDRESS,
        to: USER_ADDRESS,
        tokenId: "1234",
        tokenSymbol: "BAYC",
        tokenName: "Bored Ape",
        contractAddress: CONTRACT_ADDRESS,
        quantity: 1,
      };

      const nativeTx: ParsedNativeTx = {
        txHash: "0xabc123" as TxHash,
        dateTime: "2024-12-04 11:52:56",
        from: OTHER_ADDRESS,
        to: USER_ADDRESS,
        valueIn: 0,
        valueOut: 0,
        fee: 0.005,
        method: "",
      };

      const processedFeeHashes = new Set<TxHash>(["0xabc123" as TxHash]);
      const nativeByHash = new Map<TxHash, ParsedNativeTx>();
      nativeByHash.set("0xabc123" as TxHash, nativeTx);

      const result = transformNftTransfer(transfer, config, processedFeeHashes, nativeByHash);

      expect(result).not.toBeNull();
      expect(result?.Fee).toBe("");
      expect(result?.FeeCurrency).toBe("");
    });
  });

  describe("ERC-1155 quantities", () => {
    it("handles ERC-1155 quantity correctly", () => {
      const transfer: ParsedNftTransfer = {
        txHash: "0xabc123" as TxHash,
        dateTime: "2024-12-04 11:52:56",
        from: OTHER_ADDRESS,
        to: USER_ADDRESS,
        tokenId: "1234",
        tokenSymbol: "ITEM",
        tokenName: "Game Item",
        contractAddress: CONTRACT_ADDRESS,
        quantity: 10,
      };

      const processedFeeHashes = new Set<TxHash>();
      const nativeByHash = new Map<TxHash, ParsedNativeTx>();

      const result = transformNftTransfer(transfer, config, processedFeeHashes, nativeByHash);

      expect(result).not.toBeNull();
      expect(result?.BuyAmount).toBe("10");
    });
  });
});

describe("transformNftRows", () => {
  const config = {
    address: USER_ADDRESS,
    nativeSymbol: "MNT",
    exchange: "Mantle",
  };

  it("transforms multiple NFT transfers", () => {
    const rows = [
      {
        "Transaction Hash": "0xabc",
        "DateTime (UTC)": "2024-12-04",
        From: OTHER_ADDRESS,
        To: USER_ADDRESS,
        TokenId: "1",
        TokenSymbol: "BAYC",
      },
      {
        "Transaction Hash": "0xdef",
        "DateTime (UTC)": "2024-12-05",
        From: USER_ADDRESS,
        To: OTHER_ADDRESS,
        TokenId: "2",
        TokenSymbol: "PUNK",
      },
    ];

    const processedFeeHashes = new Set<TxHash>();
    const nativeByHash = new Map<TxHash, ParsedNativeTx>();

    const result = transformNftRows(rows, false, config, nativeByHash, processedFeeHashes);

    expect(result).toHaveLength(2);
    expect(result[0]?.Type).toBe("Deposit");
    expect(result[0]?.BuyCurrency).toBe("NFT:BAYC#1");
    expect(result[1]?.Type).toBe("Withdrawal");
    expect(result[1]?.SellCurrency).toBe("NFT:PUNK#2");
  });

  it("handles ERC-1155 correctly", () => {
    const rows = [
      {
        "Transaction Hash": "0xabc",
        "DateTime (UTC)": "2024-12-04",
        From: OTHER_ADDRESS,
        To: USER_ADDRESS,
        TokenId: "1",
        TokenSymbol: "ITEM",
        TokenValue: "5",
      },
    ];

    const processedFeeHashes = new Set<TxHash>();
    const nativeByHash = new Map<TxHash, ParsedNativeTx>();

    const result = transformNftRows(rows, true, config, nativeByHash, processedFeeHashes);

    expect(result).toHaveLength(1);
    expect(result[0]?.BuyAmount).toBe("5");
  });

  it("filters out irrelevant transfers", () => {
    const rows = [
      {
        "Transaction Hash": "0xabc",
        "DateTime (UTC)": "2024-12-04",
        From: OTHER_ADDRESS,
        To: USER_ADDRESS,
        TokenId: "1",
        TokenSymbol: "BAYC",
      },
      {
        "Transaction Hash": "0xdef",
        "DateTime (UTC)": "2024-12-05",
        From: OTHER_ADDRESS,
        To: toAddress("0x3333333333333333333333333333333333333333"),
        TokenId: "2",
        TokenSymbol: "OTHER",
      },
    ];

    const processedFeeHashes = new Set<TxHash>();
    const nativeByHash = new Map<TxHash, ParsedNativeTx>();

    const result = transformNftRows(rows, false, config, nativeByHash, processedFeeHashes);

    expect(result).toHaveLength(1);
    expect(result[0]?.BuyCurrency).toBe("NFT:BAYC#1");
  });

  it("sets exchange from config", () => {
    const rows = [
      {
        "Transaction Hash": "0xabc",
        "DateTime (UTC)": "2024-12-04",
        From: OTHER_ADDRESS,
        To: USER_ADDRESS,
        TokenId: "1",
        TokenSymbol: "BAYC",
      },
    ];

    const processedFeeHashes = new Set<TxHash>();
    const nativeByHash = new Map<TxHash, ParsedNativeTx>();

    const result = transformNftRows(rows, false, config, nativeByHash, processedFeeHashes);

    expect(result[0]?.Exchange).toBe("Mantle");
  });

  it("preserves dateTime in output", () => {
    const rows = [
      {
        "Transaction Hash": "0xabc",
        "DateTime (UTC)": "2024-12-04 15:30:00",
        From: OTHER_ADDRESS,
        To: USER_ADDRESS,
        TokenId: "1",
        TokenSymbol: "BAYC",
      },
    ];

    const processedFeeHashes = new Set<TxHash>();
    const nativeByHash = new Map<TxHash, ParsedNativeTx>();

    const result = transformNftRows(rows, false, config, nativeByHash, processedFeeHashes);

    expect(result[0]?.Date).toBe("2024-12-04 15:30:00");
  });
});
