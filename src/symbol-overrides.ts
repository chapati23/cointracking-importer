import fs from "node:fs";
import path from "node:path";

// ---------- Built-in Cointracking Native Symbols ----------
// These are the official symbols Cointracking uses for EVM chain native tokens.
// Some have numbered suffixes (like MNT3) to disambiguate from other tokens.
// Source: https://cointracking.info/imports and user-verified values.

export const COINTRACKING_NATIVE_SYMBOLS: Record<string, string> = {
  // Major EVM chains (from Cointracking imports page)
  Ethereum: "ETH",
  Arbitrum: "AETH",
  Avalanche: "AVAX",
  Base: "BASE",
  "Binance Smart Chain": "BNB",
  BSC: "BNB",
  Blast: "BLAST",
  Cronos: "CRO",
  Fantom: "FTM",
  Gnosis: "XDAI",
  Linea: "LINEA",
  Metis: "METIS",
  Moonbeam: "GLMR",
  Optimism: "OP",
  Polygon: "POL",
  zkSync: "ZKSYNC",

  // Chains not natively supported by Cointracking (user-verified symbols)
  Mantle: "MNT3",
};

// ---------- User Override Configuration ----------

const DATA_DIR = "data";
const OVERRIDES_FILE = path.join(DATA_DIR, "symbol-overrides.json");

export interface SymbolOverrides {
  // Chain name → Cointracking native symbol
  nativeSymbols: Record<string, string>;
  // Token symbol (from CSV) → Cointracking symbol
  tokenSymbols: Record<string, string>;
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function readSymbolOverrides(): SymbolOverrides {
  if (!fs.existsSync(OVERRIDES_FILE)) {
    return { nativeSymbols: {}, tokenSymbols: {} };
  }

  try {
    const content = fs.readFileSync(OVERRIDES_FILE, "utf8");
    const parsed = JSON.parse(content) as unknown;

    if (typeof parsed !== "object" || parsed === null) {
      return { nativeSymbols: {}, tokenSymbols: {} };
    }

    const config = parsed as Record<string, unknown>;
    return {
      nativeSymbols:
        typeof config["nativeSymbols"] === "object" && config["nativeSymbols"] !== null
          ? (config["nativeSymbols"] as Record<string, string>)
          : {},
      tokenSymbols:
        typeof config["tokenSymbols"] === "object" && config["tokenSymbols"] !== null
          ? (config["tokenSymbols"] as Record<string, string>)
          : {},
    };
  } catch {
    console.warn("Warning: Could not parse data/symbol-overrides.json");
    return { nativeSymbols: {}, tokenSymbols: {} };
  }
}

export function writeSymbolOverrides(overrides: SymbolOverrides): void {
  ensureDataDir();
  fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(overrides, null, 2), "utf8");
}

// ---------- Symbol Resolution ----------

/**
 * Resolve the Cointracking-compatible native symbol for a chain.
 * Priority: user overrides > built-in defaults > original symbol
 */
export function resolveNativeSymbol(chain: string, originalSymbol: string): string {
  const overrides = readSymbolOverrides();

  // 1. Check user overrides first
  if (overrides.nativeSymbols[chain]) {
    return overrides.nativeSymbols[chain];
  }

  // 2. Check built-in defaults
  if (COINTRACKING_NATIVE_SYMBOLS[chain]) {
    return COINTRACKING_NATIVE_SYMBOLS[chain];
  }

  // 3. Fall back to original symbol
  return originalSymbol;
}

/**
 * Resolve a token symbol to its Cointracking-compatible version.
 * Useful for tokens that have different symbols in Cointracking.
 */
export function resolveTokenSymbol(originalSymbol: string): string {
  const overrides = readSymbolOverrides();

  // Check user overrides
  if (overrides.tokenSymbols[originalSymbol]) {
    return overrides.tokenSymbols[originalSymbol];
  }

  // Return original if no override
  return originalSymbol;
}

/**
 * Get the default native symbol suggestion for a chain.
 * Returns the Cointracking symbol if known, otherwise undefined.
 */
export function getDefaultNativeSymbol(chain: string): string | undefined {
  const overrides = readSymbolOverrides();

  // Check user overrides first
  if (overrides.nativeSymbols[chain]) {
    return overrides.nativeSymbols[chain];
  }

  // Check built-in defaults
  return COINTRACKING_NATIVE_SYMBOLS[chain];
}
