import { getFieldByKey, normalizeNumber } from "../field-mapping.js";
import type { CoinTrackingRow, ConvertConfig, CsvRow, ParsedNativeTx, TxHash } from "../types.js";
import { toAddress, toTxHash } from "../types.js";

// ---------- Parsing ----------

export function parseNativeRow(row: CsvRow): ParsedNativeTx {
  return {
    txHash: toTxHash(getFieldByKey(row, "txHash")),
    dateTime: getFieldByKey(row, "dateTime"),
    from: toAddress(getFieldByKey(row, "from")),
    to: toAddress(getFieldByKey(row, "to")),
    valueIn: normalizeNumber(getFieldByKey(row, "valueIn")),
    valueOut: normalizeNumber(getFieldByKey(row, "valueOut")),
    fee: normalizeNumber(getFieldByKey(row, "fee")),
    method: getFieldByKey(row, "method"),
  };
}

export function parseNativeRows(rows: CsvRow[]): ParsedNativeTx[] {
  return rows.map(parseNativeRow).filter((tx) => tx.txHash !== "");
}

// ---------- Index by Hash ----------

export function indexNativeByHash(txs: ParsedNativeTx[]): Map<TxHash, ParsedNativeTx> {
  const map = new Map<TxHash, ParsedNativeTx>();
  for (const tx of txs) {
    if (tx.txHash) {
      map.set(tx.txHash, tx);
    }
  }
  return map;
}

// ---------- Transformation ----------

export function shouldSkipNativeTx(tx: ParsedNativeTx): boolean {
  // Skip if no value movement AND no fee (truly empty transaction)
  return tx.valueIn === 0 && tx.valueOut === 0 && tx.fee === 0;
}

export function transformNativeTx(
  tx: ParsedNativeTx,
  config: ConvertConfig,
  processedFeeHashes: Set<TxHash>
): CoinTrackingRow | null {
  if (shouldSkipNativeTx(tx)) {
    return null;
  }

  // Determine if fee should be applied (only once per tx hash)
  const applyFee = tx.fee > 0 && !processedFeeHashes.has(tx.txHash);
  if (applyFee) {
    processedFeeHashes.add(tx.txHash);
  }

  const feeStr = applyFee ? String(tx.fee) : "";
  const feeCurrency = applyFee ? config.nativeSymbol : "";

  // Bridge deposit (self-transfer: from === to === address, e.g. L1→L2 OP Stack deposit)
  if (tx.valueIn > 0 && tx.from === config.address && tx.to === config.address) {
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
      Comment: `Bridge deposit ${tx.txHash}`,
      Date: tx.dateTime,
    };
  }

  // Incoming native transfer (deposit)
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
      Comment: `Native in ${tx.txHash}`,
      Date: tx.dateTime,
    };
  }

  // Outgoing native transfer (withdrawal)
  if (tx.valueOut > 0 && tx.from === config.address) {
    const comment = tx.method ? `${tx.method} ${tx.txHash}` : `Native out ${tx.txHash}`;
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
      Comment: comment,
      Date: tx.dateTime,
    };
  }

  // Fee-only transaction (no value movement but has gas cost)
  // For "Other Fee" type, CoinTracking expects the fee in Sell columns, not Fee columns
  if (tx.valueIn === 0 && tx.valueOut === 0 && tx.fee > 0) {
    const comment = tx.method ? `${tx.method} ${tx.txHash}` : `Fee ${tx.txHash}`;
    return {
      Type: "Other Fee",
      BuyAmount: "",
      BuyCurrency: "",
      SellAmount: String(tx.fee),
      SellCurrency: config.nativeSymbol,
      Fee: "",
      FeeCurrency: "",
      Exchange: config.exchange,
      TradeGroup: "",
      Comment: comment,
      Date: tx.dateTime,
    };
  }

  return null;
}

export function transformNativeRows(
  rows: CsvRow[],
  config: ConvertConfig,
  processedFeeHashes: Set<TxHash>,
  skipHashes: Set<TxHash> = new Set()
): CoinTrackingRow[] {
  const txs = parseNativeRows(rows);

  return txs
    .filter((tx) => !skipHashes.has(tx.txHash))
    .map((tx) => transformNativeTx(tx, config, processedFeeHashes))
    .filter((row): row is CoinTrackingRow => row !== null);
}
