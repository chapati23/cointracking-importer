import { getFieldByKey, normalizeNumber } from "../field-mapping.js";
import type {
  CoinTrackingRow,
  ConvertConfig,
  CsvRow,
  ParsedNativeTx,
  ParsedTokenTransfer,
  TxHash,
} from "../types.js";
import { isZeroAddress, toAddress, toTxHash, ZERO_ADDRESS } from "../types.js";

// ---------- Parsing ----------

export function parseTokenRow(row: CsvRow): ParsedTokenTransfer {
  return {
    txHash: toTxHash(getFieldByKey(row, "txHash")),
    dateTime: getFieldByKey(row, "dateTime"),
    from: toAddress(getFieldByKey(row, "from")),
    to: toAddress(getFieldByKey(row, "to")),
    value: normalizeNumber(getFieldByKey(row, "tokenValue")),
    symbol: getFieldByKey(row, "tokenSymbol") || "UNKNOWN",
    tokenName: getFieldByKey(row, "tokenName"),
    contractAddress: toAddress(getFieldByKey(row, "contractAddress")),
  };
}

export function parseTokenRows(rows: CsvRow[]): ParsedTokenTransfer[] {
  return rows.map(parseTokenRow).filter((tx) => tx.txHash !== "" && tx.value > 0);
}

// ---------- Grouping by Transaction ----------

export function groupByTxHash(
  transfers: ParsedTokenTransfer[]
): Map<TxHash, ParsedTokenTransfer[]> {
  const map = new Map<TxHash, ParsedTokenTransfer[]>();
  for (const transfer of transfers) {
    const existing = map.get(transfer.txHash) ?? [];
    existing.push(transfer);
    map.set(transfer.txHash, existing);
  }
  return map;
}

// ---------- Transfer Classification ----------

interface ClassifiedTransfers {
  outgoing: ParsedTokenTransfer[];
  incoming: ParsedTokenTransfer[];
}

export function classifyTransfers(
  transfers: ParsedTokenTransfer[],
  userAddress: string
): ClassifiedTransfers {
  const addr = toAddress(userAddress);

  const outgoing = transfers.filter(
    (t) => t.from === addr && t.to !== addr && !isZeroAddress(t.from)
  );
  const incoming = transfers.filter((t) => t.to === addr && t.from !== addr);

  return { outgoing, incoming };
}

// ---------- Swap Detection ----------

function isSimpleSwap(classified: ClassifiedTransfers): boolean {
  return classified.outgoing.length === 1 && classified.incoming.length === 1;
}

function createSwapRow(
  outgoing: ParsedTokenTransfer,
  incoming: ParsedTokenTransfer,
  fee: number,
  config: ConvertConfig,
  processedFeeHashes: Set<TxHash>
): CoinTrackingRow {
  const applyFee = fee > 0 && !processedFeeHashes.has(outgoing.txHash);
  if (applyFee) {
    processedFeeHashes.add(outgoing.txHash);
  }

  return {
    Type: "Trade",
    BuyAmount: String(incoming.value),
    BuyCurrency: incoming.symbol,
    SellAmount: String(outgoing.value),
    SellCurrency: outgoing.symbol,
    Fee: applyFee ? String(fee) : "",
    FeeCurrency: applyFee ? config.nativeSymbol : "",
    Exchange: config.exchange,
    TradeGroup: "",
    Comment: `Swap ${outgoing.txHash}`,
    Date: outgoing.dateTime,
  };
}

// ---------- Single Transfer Handling ----------

function createDepositRow(
  transfer: ParsedTokenTransfer,
  fee: number,
  config: ConvertConfig,
  processedFeeHashes: Set<TxHash>
): CoinTrackingRow {
  const applyFee = fee > 0 && !processedFeeHashes.has(transfer.txHash);
  if (applyFee) {
    processedFeeHashes.add(transfer.txHash);
  }

  // Check if it's from zero address (mint/airdrop)
  const isMint = isZeroAddress(transfer.from) || transfer.from === ZERO_ADDRESS;
  const type = isMint ? "Airdrop" : "Deposit";

  return {
    Type: type,
    BuyAmount: String(transfer.value),
    BuyCurrency: transfer.symbol,
    SellAmount: "",
    SellCurrency: "",
    Fee: applyFee ? String(fee) : "",
    FeeCurrency: applyFee ? config.nativeSymbol : "",
    Exchange: config.exchange,
    TradeGroup: "",
    Comment: `Token in ${transfer.txHash}`,
    Date: transfer.dateTime,
  };
}

function createWithdrawalRow(
  transfer: ParsedTokenTransfer,
  fee: number,
  config: ConvertConfig,
  processedFeeHashes: Set<TxHash>
): CoinTrackingRow {
  const applyFee = fee > 0 && !processedFeeHashes.has(transfer.txHash);
  if (applyFee) {
    processedFeeHashes.add(transfer.txHash);
  }

  // Check if it's to zero address (burn)
  const isBurn = isZeroAddress(transfer.to);
  const comment = isBurn ? `Token burn ${transfer.txHash}` : `Token out ${transfer.txHash}`;

  return {
    Type: "Withdrawal",
    BuyAmount: "",
    BuyCurrency: "",
    SellAmount: String(transfer.value),
    SellCurrency: transfer.symbol,
    Fee: applyFee ? String(fee) : "",
    FeeCurrency: applyFee ? config.nativeSymbol : "",
    Exchange: config.exchange,
    TradeGroup: "",
    Comment: comment,
    Date: transfer.dateTime,
  };
}

// ---------- Main Transform Function ----------

export function transformTokenRows(
  rows: CsvRow[],
  config: ConvertConfig,
  nativeByHash: Map<TxHash, ParsedNativeTx>,
  processedFeeHashes: Set<TxHash>
): { rows: CoinTrackingRow[]; processedHashes: Set<TxHash> } {
  const transfers = parseTokenRows(rows);
  const grouped = groupByTxHash(transfers);
  const result: CoinTrackingRow[] = [];
  const processedHashes = new Set<TxHash>();

  for (const [txHash, txTransfers] of grouped) {
    processedHashes.add(txHash);

    const classified = classifyTransfers(txTransfers, config.address);
    const nativeTx = nativeByHash.get(txHash);
    const fee = nativeTx?.fee ?? 0;

    // Simple 1:1 swap
    if (isSimpleSwap(classified)) {
      const outgoing = classified.outgoing[0];
      const incoming = classified.incoming[0];
      if (outgoing && incoming) {
        const swapRow = createSwapRow(outgoing, incoming, fee, config, processedFeeHashes);
        result.push(swapRow);
      }
      continue;
    }

    // Multi-token swap: treat as single trade (first out → last in)
    const firstOutgoing = classified.outgoing[0];
    const lastIncoming = classified.incoming[classified.incoming.length - 1];
    if (firstOutgoing && lastIncoming) {
      // Use first outgoing and last incoming for the trade
      const swapRow = createSwapRow(firstOutgoing, lastIncoming, fee, config, processedFeeHashes);
      result.push(swapRow);
      continue;
    }

    // Individual deposits
    for (const transfer of classified.incoming) {
      result.push(createDepositRow(transfer, fee, config, processedFeeHashes));
    }

    // Individual withdrawals
    for (const transfer of classified.outgoing) {
      result.push(createWithdrawalRow(transfer, fee, config, processedFeeHashes));
    }
  }

  return { rows: result, processedHashes };
}
