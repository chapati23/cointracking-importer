import { getFieldByKey, normalizeNumber } from "../field-mapping.js";
import type {
    CoinTrackingRow,
    ConvertConfig,
    CsvRow,
    ParsedInternalTx,
    ParsedNativeTx,
    TxHash,
} from "../types.js";
import { toAddress, toTxHash } from "../types.js";

// ---------- Parsing ----------

export function parseInternalRow(row: CsvRow): ParsedInternalTx {
  return {
    txHash: toTxHash(getFieldByKey(row, "txHash")),
    dateTime: getFieldByKey(row, "dateTime"),
    from: toAddress(getFieldByKey(row, "from")),
    to: toAddress(getFieldByKey(row, "to")),
    valueIn: normalizeNumber(getFieldByKey(row, "valueIn")),
    valueOut: normalizeNumber(getFieldByKey(row, "valueOut")),
    contractAddress: toAddress(getFieldByKey(row, "contractAddress")),
  };
}

export function parseInternalRows(rows: CsvRow[]): ParsedInternalTx[] {
  return rows.map(parseInternalRow).filter((tx) => tx.txHash !== "");
}

// ---------- Deduplication Logic ----------

/**
 * Check if an internal tx is already covered by a native tx.
 * This happens when the value and direction match.
 */
function isDuplicate(
  internalTx: ParsedInternalTx,
  nativeByHash: Map<TxHash, ParsedNativeTx>,
  config: ConvertConfig
): boolean {
  const nativeTx = nativeByHash.get(internalTx.txHash);
  if (!nativeTx) return false;

  // Check if the native tx covers this internal tx
  // (same value in/out and same direction)
  const isIncoming = internalTx.to === config.address;
  const isOutgoing = internalTx.from === config.address;

  if (isIncoming && nativeTx.valueIn > 0 && nativeTx.valueIn === internalTx.valueIn) {
    return true;
  }

  if (isOutgoing && nativeTx.valueOut > 0 && nativeTx.valueOut === internalTx.valueOut) {
    return true;
  }

  return false;
}

// ---------- Transformation ----------

export function transformInternalTx(
  tx: ParsedInternalTx,
  config: ConvertConfig,
  processedFeeHashes: Set<TxHash>,
  nativeByHash: Map<TxHash, ParsedNativeTx>
): CoinTrackingRow | null {
  // Skip if no value movement
  if (tx.valueIn === 0 && tx.valueOut === 0) {
    return null;
  }

  // Skip if already covered by native tx
  if (isDuplicate(tx, nativeByHash, config)) {
    return null;
  }

  // Get fee from native tx if available
  const nativeTx = nativeByHash.get(tx.txHash);
  const fee = nativeTx?.fee ?? 0;
  const applyFee = fee > 0 && !processedFeeHashes.has(tx.txHash);
  if (applyFee) {
    processedFeeHashes.add(tx.txHash);
  }

  const feeStr = applyFee ? String(fee) : "";
  const feeCurrency = applyFee ? config.nativeSymbol : "";

  // Incoming internal transfer (deposit)
  if (tx.valueIn > 0 && tx.to === config.address && tx.from !== config.address) {
    return {
      Type: "Deposit",
      BuyAmount: String(tx.valueIn),
      BuyCurrency: config.nativeSymbol,
      SellAmount: "",
      SellCurrency: "",
      Fee: feeStr,
      FeeCurrency: feeCurrency,
      Exchange: config.exchange,
      TradeGroup: "",
      Comment: `Internal in ${tx.txHash}`,
      Date: tx.dateTime,
    };
  }

  // Outgoing internal transfer (withdrawal)
  if (tx.valueOut > 0 && tx.from === config.address) {
    return {
      Type: "Withdrawal",
      BuyAmount: "",
      BuyCurrency: "",
      SellAmount: String(tx.valueOut),
      SellCurrency: config.nativeSymbol,
      Fee: feeStr,
      FeeCurrency: feeCurrency,
      Exchange: config.exchange,
      TradeGroup: "",
      Comment: `Internal out ${tx.txHash}`,
      Date: tx.dateTime,
    };
  }

  return null;
}

export function transformInternalRows(
  rows: CsvRow[],
  config: ConvertConfig,
  nativeByHash: Map<TxHash, ParsedNativeTx>,
  processedFeeHashes: Set<TxHash>
): CoinTrackingRow[] {
  const txs = parseInternalRows(rows);

  return txs
    .map((tx) => transformInternalTx(tx, config, processedFeeHashes, nativeByHash))
    .filter((row): row is CoinTrackingRow => row !== null);
}
