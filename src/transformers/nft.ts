import { getFieldByKey, normalizeNumber } from "../field-mapping.js";
import type {
  CoinTrackingRow,
  ConvertConfig,
  CsvRow,
  ParsedNativeTx,
  ParsedNftTransfer,
  TxHash,
} from "../types.js";
import { isZeroAddress, toAddress, toTxHash } from "../types.js";

// ---------- Parsing ----------

export function parseNftRow(row: CsvRow, isErc1155: boolean): ParsedNftTransfer {
  return {
    txHash: toTxHash(getFieldByKey(row, "txHash")),
    dateTime: getFieldByKey(row, "dateTime"),
    from: toAddress(getFieldByKey(row, "from")),
    to: toAddress(getFieldByKey(row, "to")),
    tokenId: getFieldByKey(row, "tokenId"),
    tokenSymbol: getFieldByKey(row, "tokenSymbol") || "NFT",
    tokenName: getFieldByKey(row, "tokenName"),
    contractAddress: toAddress(getFieldByKey(row, "contractAddress")),
    quantity: isErc1155 ? normalizeNumber(getFieldByKey(row, "tokenValue")) : 1,
  };
}

export function parseNftRows(rows: CsvRow[], isErc1155: boolean): ParsedNftTransfer[] {
  return rows.map((row) => parseNftRow(row, isErc1155)).filter((tx) => tx.txHash !== "");
}

// ---------- NFT Currency Formatting ----------

/**
 * Format NFT as currency for CoinTracking.
 * Format: NFT:SYMBOL#TokenId
 */
export function formatNftCurrency(transfer: ParsedNftTransfer): string {
  const symbol = transfer.tokenSymbol || "NFT";
  return `NFT:${symbol}#${transfer.tokenId}`;
}

// ---------- Transformation ----------

// eslint-disable-next-line sonarjs/cognitive-complexity -- branching for send/receive/mint/burn cases
export function transformNftTransfer(
  transfer: ParsedNftTransfer,
  config: ConvertConfig,
  processedFeeHashes: Set<TxHash>,
  nativeByHash: Map<TxHash, ParsedNativeTx>
): CoinTrackingRow | null {
  const nativeTx = nativeByHash.get(transfer.txHash);
  const fee = nativeTx?.fee ?? 0;
  const applyFee = fee > 0 && !processedFeeHashes.has(transfer.txHash);
  if (applyFee) {
    processedFeeHashes.add(transfer.txHash);
  }

  const feeStr = applyFee ? String(fee) : "";
  const feeCurrency = applyFee ? config.nativeSymbol : "";
  const nftCurrency = formatNftCurrency(transfer);
  const quantity = String(transfer.quantity);

  // NFT received
  if (transfer.to === config.address && transfer.from !== config.address) {
    const isMint = isZeroAddress(transfer.from);

    // If ETH was sent in the same tx, this is a purchase/mint trade
    if (nativeTx && nativeTx.valueOut > 0) {
      return {
        Type: "Trade",
        BuyAmount: quantity,
        BuyCurrency: nftCurrency,
        SellAmount: String(nativeTx.valueOut),
        SellCurrency: config.nativeSymbol,
        Fee: feeStr,
        FeeCurrency: feeCurrency,
        Exchange: config.exchange,
        TradeGroup: "",
        Comment: isMint
          ? `NFT mint (trade) ${transfer.txHash}`
          : `NFT purchase (trade) ${transfer.txHash}`,
        Date: transfer.dateTime,
      };
    }

    // Free mint/airdrop or deposit (no ETH payment)
    return {
      Type: isMint ? "Airdrop" : "Deposit",
      BuyAmount: quantity,
      BuyCurrency: nftCurrency,
      SellAmount: "",
      SellCurrency: "",
      Fee: feeStr,
      FeeCurrency: feeCurrency,
      Exchange: config.exchange,
      TradeGroup: "",
      Comment: isMint ? `NFT mint ${transfer.txHash}` : `NFT in ${transfer.txHash}`,
      Date: transfer.dateTime,
    };
  }

  // NFT sent
  if (transfer.from === config.address && transfer.to !== config.address) {
    // To zero address = burn
    const isBurn = isZeroAddress(transfer.to);

    return {
      Type: isBurn ? "Lost" : "Withdrawal",
      BuyAmount: "",
      BuyCurrency: "",
      SellAmount: quantity,
      SellCurrency: nftCurrency,
      Fee: feeStr,
      FeeCurrency: feeCurrency,
      Exchange: config.exchange,
      TradeGroup: "",
      Comment: isBurn ? `NFT burn ${transfer.txHash}` : `NFT out ${transfer.txHash}`,
      Date: transfer.dateTime,
    };
  }

  return null;
}

export function transformNftRows(
  rows: CsvRow[],
  isErc1155: boolean,
  config: ConvertConfig,
  nativeByHash: Map<TxHash, ParsedNativeTx>,
  processedFeeHashes: Set<TxHash>
): CoinTrackingRow[] {
  const transfers = parseNftRows(rows, isErc1155);

  return transfers
    .map((transfer) => transformNftTransfer(transfer, config, processedFeeHashes, nativeByHash))
    .filter((row): row is CoinTrackingRow => row !== null);
}
