import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./types.js";

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
const OVERRIDES_FILE = path.join(DATA_DIR, "symbol-overrides.json");

export interface SymbolOverrides {
  // Chain name → Cointracking native symbol
  nativeSymbols: Record<string, string>;
  // Token symbol (from CSV) → Cointracking symbol
  tokenSymbols: Record<string, string>;
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

// ---------- Symbol Resolution ----------

/**
 * Look up the native symbol for a chain.
 * Priority: user overrides > built-in defaults
 */
function lookupNativeSymbol(chain: string): string | undefined {
  const overrides = readSymbolOverrides();
  return overrides.nativeSymbols[chain] ?? COINTRACKING_NATIVE_SYMBOLS[chain];
}

/**
 * Resolve the Cointracking-compatible native symbol for a chain.
 * Priority: user overrides > built-in defaults > original symbol
 */
export function resolveNativeSymbol(chain: string, originalSymbol: string): string {
  return lookupNativeSymbol(chain) ?? originalSymbol;
}

/**
 * Get the default native symbol suggestion for a chain.
 * Returns the Cointracking symbol if known, otherwise undefined.
 */
export function getDefaultNativeSymbol(chain: string): string | undefined {
  return lookupNativeSymbol(chain);
}
