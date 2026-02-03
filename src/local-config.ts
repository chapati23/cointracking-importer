import fs from "node:fs";
import path from "node:path";

// ---------- Type Definitions ----------

export interface SavedAddress {
  name: string;
  address: string;
}

export interface LocalConfig {
  addresses: SavedAddress[];
}

// ---------- Paths ----------

const DATA_DIR = "data";
const CONFIG_FILE = path.join(DATA_DIR, "addresses.json");

// ---------- Read/Write Config ----------

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function readLocalConfig(): LocalConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    return { addresses: [] };
  }

  try {
    const content = fs.readFileSync(CONFIG_FILE, "utf8");
    const parsed = JSON.parse(content) as unknown;

    // Basic validation
    if (typeof parsed !== "object" || parsed === null) {
      return { addresses: [] };
    }

    const config = parsed as Record<string, unknown>;
    if (!Array.isArray(config["addresses"])) {
      return { addresses: [] };
    }

    return config as unknown as LocalConfig;
  } catch {
    console.warn("Warning: Could not parse data/addresses.json, starting fresh");
    return { addresses: [] };
  }
}

export function writeLocalConfig(config: LocalConfig): void {
  ensureDataDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
}

// ---------- Address Management ----------

export function getSavedAddresses(): SavedAddress[] {
  return readLocalConfig().addresses;
}

export function saveAddress(entry: SavedAddress): void {
  const config = readLocalConfig();

  // Check if address already exists (update label if so)
  const normalizedAddress = entry.address.toLowerCase();
  const existingIndex = config.addresses.findIndex(
    (a) => a.address.toLowerCase() === normalizedAddress
  );

  if (existingIndex >= 0) {
    config.addresses[existingIndex] = {
      ...config.addresses[existingIndex],
      ...entry,
      address: normalizedAddress,
    };
  } else {
    config.addresses.push({
      ...entry,
      address: normalizedAddress,
    });
  }

  writeLocalConfig(config);
}

export function removeAddress(address: string): boolean {
  const config = readLocalConfig();
  const normalizedAddress = address.toLowerCase();
  const initialLength = config.addresses.length;

  config.addresses = config.addresses.filter((a) => a.address.toLowerCase() !== normalizedAddress);

  if (config.addresses.length < initialLength) {
    writeLocalConfig(config);
    return true;
  }

  return false;
}

// ---------- Display Helpers ----------

export function formatAddressChoice(entry: SavedAddress): string {
  const shortAddr = `${entry.address.slice(0, 6)}...${entry.address.slice(-4)}`;
  return `${entry.name} (${shortAddr})`;
}

export function hasLocalConfig(): boolean {
  return fs.existsSync(CONFIG_FILE);
}
