import { getFieldByKey, normalizeNumber } from "../field-mapping.js";
import type {
  CoinTrackingRow,
  CoinTrackingType,
  ConvertConfig,
  CsvRow,
  ParsedNativeTx,
  TxHash,
} from "../types.js";
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

// ---------- Row Builders ----------

function makeRow(
  type: CoinTrackingType,
  buy: { amount: string; currency: string },
  sell: { amount: string; currency: string },
  fee: { amount: string; currency: string },
  exchange: string,
  comment: string,
  date: string
): CoinTrackingRow {
  return {
    Type: type,
    BuyAmount: buy.amount,
    BuyCurrency: buy.currency,
    SellAmount: sell.amount,
    SellCurrency: sell.currency,
    Fee: fee.amount,
    FeeCurrency: fee.currency,
    Exchange: exchange,
    TradeGroup: "",
    Comment: comment,
    Date: date,
  };
}

function makeDeposit(
  amount: string,
  currency: string,
  fee: { amount: string; currency: string },
  exchange: string,
  comment: string,
  date: string
): CoinTrackingRow {
  return makeRow(
    "Deposit",
    { amount, currency },
    { amount: "", currency: "" },
    fee,
    exchange,
    comment,
    date
  );
}

function makeWithdrawal(
  amount: string,
  currency: string,
  fee: { amount: string; currency: string },
  exchange: string,
  comment: string,
  date: string
): CoinTrackingRow {
  return makeRow(
    "Withdrawal",
    { amount: "", currency: "" },
    { amount, currency },
    fee,
    exchange,
    comment,
    date
  );
}

// ---------- Transformation ----------

export function shouldSkipNativeTx(tx: ParsedNativeTx): boolean {
  return tx.valueIn === 0 && tx.valueOut === 0 && tx.fee === 0;
}

function classifyNativeTx(
  tx: ParsedNativeTx,
  address: string
): "bridge-deposit" | "deposit" | "withdrawal" | "fee-only" | "unknown" {
  const isSelf = tx.from === address && tx.to === address;
  const isIncoming = tx.to === address && tx.from !== address;
  const isOutgoing = tx.from === address;

  if (tx.valueIn > 0 && isSelf) return "bridge-deposit";
  if (tx.valueIn > 0 && isIncoming) return "deposit";
  if (tx.valueOut > 0 && isOutgoing) return "withdrawal";
  if (tx.valueIn === 0 && tx.valueOut === 0 && tx.fee > 0) return "fee-only";
  return "unknown";
}

export function transformNativeTx(
  tx: ParsedNativeTx,
  config: ConvertConfig,
  processedFeeHashes: Set<TxHash>
): CoinTrackingRow | null {
  if (shouldSkipNativeTx(tx)) return null;

  const applyFee = tx.fee > 0 && !processedFeeHashes.has(tx.txHash);
  if (applyFee) processedFeeHashes.add(tx.txHash);

  const fee = {
    amount: applyFee ? String(tx.fee) : "",
    currency: applyFee ? config.nativeSymbol : "",
  };
  const kind = classifyNativeTx(tx, config.address);

  switch (kind) {
    case "bridge-deposit":
      return makeDeposit(
        String(tx.valueIn),
        config.nativeSymbol,
        fee,
        config.exchange,
        `Bridge deposit ${tx.txHash}`,
        tx.dateTime
      );

    case "deposit":
      return makeDeposit(
        String(tx.valueIn),
        config.nativeSymbol,
        fee,
        config.exchange,
        `Native in ${tx.txHash}`,
        tx.dateTime
      );

    case "withdrawal": {
      const comment = tx.method ? `${tx.method} ${tx.txHash}` : `Native out ${tx.txHash}`;
      return makeWithdrawal(
        String(tx.valueOut),
        config.nativeSymbol,
        fee,
        config.exchange,
        comment,
        tx.dateTime
      );
    }

    case "fee-only": {
      // For "Other Fee" type, CoinTracking expects the fee in Sell columns, not Fee columns
      const comment = tx.method ? `${tx.method} ${tx.txHash}` : `Fee ${tx.txHash}`;
      return makeRow(
        "Other Fee",
        { amount: "", currency: "" },
        { amount: String(tx.fee), currency: config.nativeSymbol },
        { amount: "", currency: "" },
        config.exchange,
        comment,
        tx.dateTime
      );
    }

    default:
      return null;
  }
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
