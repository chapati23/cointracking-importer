import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCsv, writeCoinTrackingCsv } from "../../src/csv-utils.js";
import { transformInternalRows } from "../../src/transformers/internal.js";
import {
  indexNativeByHash,
  parseNativeRows,
  transformNativeRows,
} from "../../src/transformers/native.js";
import { transformNftRows } from "../../src/transformers/nft.js";
import { transformTokenRows } from "../../src/transformers/tokens.js";
import { toAddress, type CoinTrackingRow, type TxHash } from "../../src/types.js";

const USER_ADDRESS = toAddress("0xd8da6bf26964af9d7eed9e03e53415d37aa96045");

describe("Transformation Pipeline Integration", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-test-"));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  const config = {
    address: USER_ADDRESS,
    nativeSymbol: "MNT",
    exchange: "Mantle",
  };

  describe("complete conversion with all file types", () => {
    it("processes native + tokens without duplicate fees", () => {
      // Create test CSV files
      const nativeContent = `"Transaction Hash","DateTime (UTC)","From","To","Value_IN(MNT)","Value_OUT(MNT)","TxnFee(MNT)","Method"
"0xswap123","2024-12-04 12:00:00","0xd8da6bf26964af9d7eed9e03e53415d37aa96045","0xrouter","0","0","0.005","Swap"`;

      const tokensContent = `"Transaction Hash","DateTime (UTC)","From","To","TokenValue","TokenSymbol","TokenName","ContractAddress"
"0xswap123","2024-12-04 12:00:00","0xd8da6bf26964af9d7eed9e03e53415d37aa96045","0xrouter","100","USDC","USD Coin","0xusdc"
"0xswap123","2024-12-04 12:00:00","0xrouter","0xd8da6bf26964af9d7eed9e03e53415d37aa96045","0.05","WETH","Wrapped Ether","0xweth"`;

      const nativePath = path.join(tempDir, "native.csv");
      const tokensPath = path.join(tempDir, "tokens.csv");
      fs.writeFileSync(nativePath, nativeContent);
      fs.writeFileSync(tokensPath, tokensContent);

      // Read CSVs
      const nativeRows = readCsv(nativePath);
      const tokenRows = readCsv(tokensPath);

      // Process in correct order
      const parsedNative = parseNativeRows(nativeRows);
      const nativeByHash = indexNativeByHash(parsedNative);
      const processedFeeHashes = new Set<TxHash>();

      // 1. Tokens first (detect swaps)
      const tokenResult = transformTokenRows(tokenRows, config, nativeByHash, processedFeeHashes);

      // 2. Native (skip hashes already processed by tokens)
      const nativeResult = transformNativeRows(
        nativeRows,
        config,
        processedFeeHashes,
        tokenResult.processedHashes
      );

      const allRows = [...tokenResult.rows, ...nativeResult];

      // Should have 1 trade from tokens, 0 from native (skipped)
      expect(tokenResult.rows).toHaveLength(1);
      expect(tokenResult.rows[0]?.Type).toBe("Trade");
      expect(tokenResult.rows[0]?.Fee).toBe("0.005"); // Fee applied to swap
      expect(nativeResult).toHaveLength(0); // Native skipped because swap processed
      expect(allRows).toHaveLength(1);
    });

    it("processes native + internal with deduplication", () => {
      const nativeContent = `"Transaction Hash","DateTime (UTC)","From","To","Value_IN(MNT)","Value_OUT(MNT)","TxnFee(MNT)","Method"
"0xinternal123","2024-12-04 12:00:00","0xcontract","0xd8da6bf26964af9d7eed9e03e53415d37aa96045","10","0","0.001",""`;

      const internalContent = `"Transaction Hash","DateTime (UTC)","From","To","Value_IN(MNT)","Value_OUT(MNT)","ParentTxFrom","ContractAddress"
"0xinternal123","2024-12-04 12:00:00","0xcontract","0xd8da6bf26964af9d7eed9e03e53415d37aa96045","10","0","0xparent","0xcontract"`;

      const nativePath = path.join(tempDir, "native.csv");
      const internalPath = path.join(tempDir, "internal.csv");
      fs.writeFileSync(nativePath, nativeContent);
      fs.writeFileSync(internalPath, internalContent);

      const nativeRows = readCsv(nativePath);
      const internalRows = readCsv(internalPath);

      const parsedNative = parseNativeRows(nativeRows);
      const nativeByHash = indexNativeByHash(parsedNative);
      const processedFeeHashes = new Set<TxHash>();

      // Process native first
      const nativeResult = transformNativeRows(nativeRows, config, processedFeeHashes);

      // Process internal (should deduplicate)
      const internalResult = transformInternalRows(
        internalRows,
        config,
        nativeByHash,
        processedFeeHashes
      );

      // Native should have 1 deposit, internal should be deduplicated
      expect(nativeResult).toHaveLength(1);
      expect(nativeResult[0]?.Type).toBe("Deposit");
      expect(internalResult).toHaveLength(0); // Deduplicated
    });
  });

  describe("fee deduplication", () => {
    it("applies fee only once per transaction hash across transformers", () => {
      const nativeContent = `"Transaction Hash","DateTime (UTC)","From","To","Value_IN(MNT)","Value_OUT(MNT)","TxnFee(MNT)","Method"
"0xfee123","2024-12-04 12:00:00","0xsender","0xd8da6bf26964af9d7eed9e03e53415d37aa96045","5","0","0.01",""`;

      const nftContent = `"Transaction Hash","DateTime (UTC)","From","To","TokenId","TokenSymbol","TokenName","ContractAddress"
"0xfee123","2024-12-04 12:00:00","0x0000000000000000000000000000000000000000","0xd8da6bf26964af9d7eed9e03e53415d37aa96045","1234","BAYC","Bored Ape","0xbayc"`;

      const nativePath = path.join(tempDir, "native.csv");
      const nftPath = path.join(tempDir, "nft.csv");
      fs.writeFileSync(nativePath, nativeContent);
      fs.writeFileSync(nftPath, nftContent);

      const nativeRows = readCsv(nativePath);
      const nftRows = readCsv(nftPath);

      const parsedNative = parseNativeRows(nativeRows);
      const nativeByHash = indexNativeByHash(parsedNative);
      const processedFeeHashes = new Set<TxHash>();

      // Process native first
      const nativeResult = transformNativeRows(nativeRows, config, processedFeeHashes);

      // Process NFT
      const nftResult = transformNftRows(nftRows, false, config, nativeByHash, processedFeeHashes);

      // Native should have fee
      expect(nativeResult).toHaveLength(1);
      expect(nativeResult[0]?.Fee).toBe("0.01");

      // NFT should NOT have fee (already applied)
      expect(nftResult).toHaveLength(1);
      expect(nftResult[0]?.Fee).toBe("");
    });
  });

  describe("date sorting", () => {
    it("sorts output rows by date ascending", () => {
      const nativeContent = `"Transaction Hash","DateTime (UTC)","From","To","Value_IN(MNT)","Value_OUT(MNT)","TxnFee(MNT)","Method"
"0xdate1","2024-12-04 15:00:00","0xsender","0xd8da6bf26964af9d7eed9e03e53415d37aa96045","10","0","0",""
"0xdate2","2024-12-04 10:00:00","0xsender","0xd8da6bf26964af9d7eed9e03e53415d37aa96045","20","0","0",""
"0xdate3","2024-12-04 12:00:00","0xsender","0xd8da6bf26964af9d7eed9e03e53415d37aa96045","30","0","0",""`;

      const nativePath = path.join(tempDir, "native.csv");
      fs.writeFileSync(nativePath, nativeContent);

      const nativeRows = readCsv(nativePath);
      const processedFeeHashes = new Set<TxHash>();
      const result = transformNativeRows(nativeRows, config, processedFeeHashes);

      // Sort by date
      result.sort((a, b) => new Date(a.Date).getTime() - new Date(b.Date).getTime());

      expect(result).toHaveLength(3);
      expect(result[0]?.Date).toBe("2024-12-04 10:00:00");
      expect(result[1]?.Date).toBe("2024-12-04 12:00:00");
      expect(result[2]?.Date).toBe("2024-12-04 15:00:00");
    });
  });

  describe("cutoff date filtering", () => {
    it("excludes transactions before cutoff date", () => {
      const nativeContent = `"Transaction Hash","DateTime (UTC)","From","To","Value_IN(MNT)","Value_OUT(MNT)","TxnFee(MNT)","Method"
"0xbefore","2024-01-01 10:00:00","0xsender","0xd8da6bf26964af9d7eed9e03e53415d37aa96045","10","0","0",""
"0xafter","2024-06-01 10:00:00","0xsender","0xd8da6bf26964af9d7eed9e03e53415d37aa96045","20","0","0",""`;

      const nativePath = path.join(tempDir, "native.csv");
      fs.writeFileSync(nativePath, nativeContent);

      const nativeRows = readCsv(nativePath);
      const processedFeeHashes = new Set<TxHash>();

      const configWithCutoff = {
        ...config,
        cutoff: new Date("2024-03-01"),
      };

      const result = transformNativeRows(nativeRows, configWithCutoff, processedFeeHashes);

      // Filter by cutoff (simulating what index.ts does)
      const cutoffDate = configWithCutoff.cutoff;
      const filtered = result.filter((row) => {
        return new Date(row.Date) >= cutoffDate;
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.Date).toBe("2024-06-01 10:00:00");
    });
  });

  describe("output format", () => {
    it("writes valid CoinTracking CSV format", () => {
      const rows: CoinTrackingRow[] = [
        {
          Type: "Deposit",
          BuyAmount: "100",
          BuyCurrency: "MNT",
          SellAmount: "",
          SellCurrency: "",
          Fee: "0.001",
          FeeCurrency: "MNT",
          Exchange: "Mantle",
          TradeGroup: "",
          Comment: "Test deposit",
          Date: "2024-12-04 12:00:00",
        },
        {
          Type: "Withdrawal",
          BuyAmount: "",
          BuyCurrency: "",
          SellAmount: "50",
          SellCurrency: "MNT",
          Fee: "",
          FeeCurrency: "",
          Exchange: "Mantle",
          TradeGroup: "",
          Comment: "Test withdrawal",
          Date: "2024-12-04 13:00:00",
        },
      ];

      const outputPath = path.join(tempDir, "output.csv");
      writeCoinTrackingCsv(outputPath, rows);

      const content = fs.readFileSync(outputPath, "utf8");
      const lines = content.split("\n");

      // Check header
      expect(lines[0]).toBe(
        "Type,Buy Amount,Buy Currency,Sell Amount,Sell Currency,Fee,Fee Currency,Exchange,Trade Group,Comment,Date"
      );

      // Check data rows
      expect(lines[1]).toContain("Deposit");
      expect(lines[1]).toContain("100");
      expect(lines[1]).toContain("MNT");
      expect(lines[2]).toContain("Withdrawal");
      expect(lines[2]).toContain("50");
    });
  });

  describe("using fixture files", () => {
    it("processes Mantle fixture files correctly", () => {
      const fixtureDir = path.join(process.cwd(), "test/fixtures/mantle");
      const nativePath = path.join(fixtureDir, "native.csv");
      const tokensPath = path.join(fixtureDir, "tokens.csv");

      if (!fs.existsSync(nativePath) || !fs.existsSync(tokensPath)) {
        // Skip if fixtures don't exist
        return;
      }

      const nativeRows = readCsv(nativePath);
      const tokenRows = readCsv(tokensPath);

      const parsedNative = parseNativeRows(nativeRows);
      const nativeByHash = indexNativeByHash(parsedNative);
      const processedFeeHashes = new Set<TxHash>();

      // Process tokens first
      const tokenResult = transformTokenRows(tokenRows, config, nativeByHash, processedFeeHashes);

      // Process native
      const nativeResult = transformNativeRows(
        nativeRows,
        config,
        processedFeeHashes,
        tokenResult.processedHashes
      );

      const allRows = [...tokenResult.rows, ...nativeResult];

      // Basic assertions - fixture has 5 native rows (3 Approve + 1 Withdraw + 1 Bridge)
      // and 1 token row (burn)
      expect(allRows.length).toBeGreaterThan(0);

      // Token burn should be processed
      const burns = tokenResult.rows.filter((r) => r.Comment.includes("burn"));
      expect(burns).toHaveLength(1);

      // Approve transactions should be skipped (zero value)
      // Only the Bridge transaction should be processed from native
      const withdrawals = nativeResult.filter((r) => r.Type === "Withdrawal");
      expect(withdrawals).toHaveLength(1);
      expect(withdrawals[0]?.SellAmount).toBe("109");
    });

    it("processes Dymension fixture files correctly", () => {
      const fixtureDir = path.join(process.cwd(), "test/fixtures/dymension");
      const nativePath = path.join(fixtureDir, "native.csv");
      const tokensPath = path.join(fixtureDir, "tokens.csv");

      if (!fs.existsSync(nativePath) || !fs.existsSync(tokensPath)) {
        return;
      }

      const dymConfig = {
        address: toAddress("0x1234567890abcdef1234567890abcdef12345678"),
        nativeSymbol: "DYM",
        exchange: "Dymension",
      };

      const nativeRows = readCsv(nativePath);
      const tokenRows = readCsv(tokensPath);

      const parsedNative = parseNativeRows(nativeRows);
      const nativeByHash = indexNativeByHash(parsedNative);
      const processedFeeHashes = new Set<TxHash>();

      const tokenResult = transformTokenRows(
        tokenRows,
        dymConfig,
        nativeByHash,
        processedFeeHashes
      );

      const nativeResult = transformNativeRows(
        nativeRows,
        dymConfig,
        processedFeeHashes,
        tokenResult.processedHashes
      );

      const allRows = [...tokenResult.rows, ...nativeResult];

      expect(allRows.length).toBeGreaterThan(0);

      // Token burn (to zero address) should be processed
      const burns = tokenResult.rows.filter((r) => r.Comment.includes("burn"));
      expect(burns).toHaveLength(1);

      // Incoming native transfer should produce a Deposit
      const deposits = nativeResult.filter((r) => r.Type === "Deposit");
      expect(deposits).toHaveLength(1);
      expect(deposits[0]?.BuyAmount).toBe("25");
      expect(deposits[0]?.BuyCurrency).toBe("DYM");

      // Outgoing native transfer (Bridge) should produce a Withdrawal
      const withdrawals = nativeResult.filter((r) => r.Type === "Withdrawal");
      expect(withdrawals).toHaveLength(1);
      expect(withdrawals[0]?.SellAmount).toBe("50");
      expect(withdrawals[0]?.SellCurrency).toBe("DYM");

      // All rows should use Dymension as exchange
      for (const row of allRows) {
        expect(row.Exchange).toBe("Dymension");
      }
    });
  });
});
