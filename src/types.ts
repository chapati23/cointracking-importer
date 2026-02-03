// ---------- Branded Types ----------

declare const brand: unique symbol;
type Brand<T, TBrand extends string> = T & { [brand]: TBrand };

export type Address = Brand<string, "Address">;
export type TxHash = Brand<string, "TxHash">;

export function toAddress(s: string): Address {
  return s.toLowerCase() as Address;
}

export function toTxHash(s: string): TxHash {
  return s.toLowerCase() as TxHash;
}

// ---------- CoinTracking Output Types ----------

export const COINTRACKING_TYPES = [
  "Trade",
  "Deposit",
  "Withdrawal",
  "Income",
  "Mining",
  "Airdrop",
  "Staking",
  "Masternode",
  "Minting",
  "Dividends",
  "Lending Income",
  "Interest Income",
  "Reward / Bonus",
  "Bounty",
  "Gift / Tip",
  "Spend",
  "Donation",
  "Gift",
  "Stolen",
  "Lost",
  "Other Fee",
  "Other Income",
  "Other Expense",
] as const;

export type CoinTrackingType = (typeof COINTRACKING_TYPES)[number];

export interface CoinTrackingRow {
  Type: CoinTrackingType;
  BuyAmount: string;
  BuyCurrency: string;
  SellAmount: string;
  SellCurrency: string;
  Fee: string;
  FeeCurrency: string;
  Exchange: string;
  TradeGroup: string;
  Comment: string;
  Date: string;
}

export const COINTRACKING_HEADERS = [
  "Type",
  "Buy Amount",
  "Buy Currency",
  "Sell Amount",
  "Sell Currency",
  "Fee",
  "Fee Currency",
  "Exchange",
  "Trade Group",
  "Comment",
  "Date",
] as const;

// ---------- Input CSV Row Types ----------

export type CsvRow = Record<string, string>;

export type CsvType = "native" | "tokens" | "internal" | "nft721" | "nft1155" | "unknown";

// ---------- Parsed Transaction Types ----------

export interface ParsedNativeTx {
  txHash: TxHash;
  dateTime: string;
  from: Address;
  to: Address;
  valueIn: number;
  valueOut: number;
  fee: number;
  method: string;
}

export interface ParsedTokenTransfer {
  txHash: TxHash;
  dateTime: string;
  from: Address;
  to: Address;
  value: number;
  symbol: string;
  tokenName: string;
  contractAddress: Address;
}

export interface ParsedInternalTx {
  txHash: TxHash;
  dateTime: string;
  from: Address;
  to: Address;
  valueIn: number;
  valueOut: number;
  contractAddress: Address;
}

export interface ParsedNftTransfer {
  txHash: TxHash;
  dateTime: string;
  from: Address;
  to: Address;
  tokenId: string;
  tokenSymbol: string;
  tokenName: string;
  contractAddress: Address;
  quantity: number; // 1 for ERC-721, variable for ERC-1155
}

// ---------- Configuration Types ----------

export interface ConvertConfig {
  address: Address;
  nativeSymbol: string;
  exchange: string;
  cutoff?: Date;
  verbose?: boolean;
  dryRun?: boolean;
}

export interface ImportRecord {
  id: string;
  chain: string;
  address: string;
  nativeSymbol: string;
  processedAt: string;
  inputFiles: string[];
  outputFile: string;
  rowCount: number;
  dateRange: { from: string; to: string };
  importedToCoinTracking: boolean;
}

export interface HistoryData {
  imports: ImportRecord[];
}

// ---------- Input Mode Types ----------

export type InputMode = "single" | "multiple" | "folder";

export interface DetectedFile {
  path: string;
  type: CsvType;
  typeName: string;
}

// ---------- Import Storage Types ----------

export interface ImportManifest {
  importedAt: string;
  chain: string;
  address: string;
  addressName?: string;
  dateRange: {
    from: string;
    to: string;
  };
  files: Partial<
    Record<
      Exclude<CsvType, "unknown">,
      {
        originalPath: string;
        txCount: number;
      }
    >
  >;
  output: {
    file: string;
    rowCount: number;
  };
}

// ---------- Transformer Context ----------

export interface TransformContext {
  config: ConvertConfig;
  nativeByHash: Map<TxHash, ParsedNativeTx>;
  processedFeeHashes: Set<TxHash>;
}

// ---------- Helpers ----------

export const ZERO_ADDRESS = toAddress("0x0000000000000000000000000000000000000000");

export function isZeroAddress(addr: Address): boolean {
  return addr === ZERO_ADDRESS;
}
