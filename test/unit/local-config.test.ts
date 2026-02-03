import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatAddressChoice,
  getSavedAddresses,
  hasLocalConfig,
  readLocalConfig,
  removeAddress,
  saveAddress,
  writeLocalConfig,
  type LocalConfig,
  type SavedAddress,
} from "../../src/local-config.js";

describe("local-config", () => {
  const DATA_DIR = "data";
  const CONFIG_FILE = path.join(DATA_DIR, "addresses.json");
  let originalConfig: LocalConfig | null = null;

  beforeEach(() => {
    // Save original config if it exists
    if (fs.existsSync(CONFIG_FILE)) {
      const content = fs.readFileSync(CONFIG_FILE, "utf8");
      originalConfig = JSON.parse(content) as LocalConfig;
    } else {
      originalConfig = null;
    }
  });

  afterEach(() => {
    // Restore original config
    if (originalConfig !== null) {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(originalConfig, null, 2), "utf8");
    } else {
      // Remove test config file if it was created
      if (fs.existsSync(CONFIG_FILE)) {
        fs.unlinkSync(CONFIG_FILE);
      }
    }
  });

  describe("hasLocalConfig", () => {
    it("returns true when addresses.json exists", () => {
      // Ensure file exists
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(CONFIG_FILE, JSON.stringify({ addresses: [] }), "utf8");

      expect(hasLocalConfig()).toBe(true);
    });

    it("returns false when addresses.json is missing", () => {
      // Remove file if it exists
      if (fs.existsSync(CONFIG_FILE)) {
        fs.unlinkSync(CONFIG_FILE);
      }

      expect(hasLocalConfig()).toBe(false);
    });
  });

  describe("readLocalConfig", () => {
    it("returns empty addresses array when no config", () => {
      if (fs.existsSync(CONFIG_FILE)) {
        fs.unlinkSync(CONFIG_FILE);
      }

      const config = readLocalConfig();
      expect(config).toEqual({ addresses: [] });
    });

    it("returns saved addresses with correct format", () => {
      const testConfig: LocalConfig = {
        addresses: [
          { name: "My Wallet", address: "0x1234567890123456789012345678901234567890" },
          { name: "Other Wallet", address: "0xabcdef1234567890abcdef1234567890abcdef12" },
        ],
      };

      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(testConfig), "utf8");

      const config = readLocalConfig();
      expect(config.addresses).toHaveLength(2);
      expect(config.addresses[0]?.name).toBe("My Wallet");
      expect(config.addresses[1]?.address).toBe("0xabcdef1234567890abcdef1234567890abcdef12");
    });

    it("handles malformed JSON gracefully", () => {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(CONFIG_FILE, "{ invalid json", "utf8");

      // Should warn and return empty config
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const config = readLocalConfig();

      expect(config).toEqual({ addresses: [] });
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("handles config without addresses array", () => {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(CONFIG_FILE, JSON.stringify({ foo: "bar" }), "utf8");

      const config = readLocalConfig();
      expect(config).toEqual({ addresses: [] });
    });

    it("handles non-object config", () => {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(CONFIG_FILE, '"just a string"', "utf8");

      const config = readLocalConfig();
      expect(config).toEqual({ addresses: [] });
    });
  });

  describe("writeLocalConfig", () => {
    it("creates data directory if missing", () => {
      // Remove config file if it exists
      if (fs.existsSync(CONFIG_FILE)) {
        fs.unlinkSync(CONFIG_FILE);
      }

      const config: LocalConfig = { addresses: [] };
      writeLocalConfig(config);

      expect(fs.existsSync(DATA_DIR)).toBe(true);
    });

    it("writes valid JSON", () => {
      const config: LocalConfig = {
        addresses: [{ name: "Test", address: "0x123" }],
      };

      writeLocalConfig(config);

      const content = fs.readFileSync(CONFIG_FILE, "utf8");
      const parsed = JSON.parse(content) as LocalConfig;
      expect(parsed.addresses).toHaveLength(1);
      expect(parsed.addresses[0]?.name).toBe("Test");
    });
  });

  describe("getSavedAddresses", () => {
    it("returns empty array when no config", () => {
      if (fs.existsSync(CONFIG_FILE)) {
        fs.unlinkSync(CONFIG_FILE);
      }

      expect(getSavedAddresses()).toEqual([]);
    });

    it("returns addresses from config", () => {
      const testConfig: LocalConfig = {
        addresses: [{ name: "Wallet 1", address: "0xabc" }],
      };

      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(testConfig), "utf8");

      const addresses = getSavedAddresses();
      expect(addresses).toHaveLength(1);
      expect(addresses[0]?.name).toBe("Wallet 1");
    });
  });

  describe("saveAddress", () => {
    beforeEach(() => {
      // Start with empty config
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(CONFIG_FILE, JSON.stringify({ addresses: [] }), "utf8");
    });

    it("creates new entry", () => {
      saveAddress({ name: "New Wallet", address: "0x1234" });

      const config = readLocalConfig();
      expect(config.addresses).toHaveLength(1);
      expect(config.addresses[0]?.name).toBe("New Wallet");
      expect(config.addresses[0]?.address).toBe("0x1234");
    });

    it("updates existing entry (upsert behavior)", () => {
      saveAddress({ name: "Original Name", address: "0x1234" });
      saveAddress({ name: "Updated Name", address: "0x1234" });

      const config = readLocalConfig();
      expect(config.addresses).toHaveLength(1);
      expect(config.addresses[0]?.name).toBe("Updated Name");
    });

    it("normalizes address to lowercase", () => {
      saveAddress({ name: "Test", address: "0xABCDEF" });

      const config = readLocalConfig();
      expect(config.addresses[0]?.address).toBe("0xabcdef");
    });

    it("creates data directory if missing", () => {
      if (fs.existsSync(CONFIG_FILE)) {
        fs.unlinkSync(CONFIG_FILE);
      }

      saveAddress({ name: "Test", address: "0x123" });

      expect(fs.existsSync(DATA_DIR)).toBe(true);
      expect(fs.existsSync(CONFIG_FILE)).toBe(true);
    });

    it("updates by case-insensitive address match", () => {
      saveAddress({ name: "First", address: "0xABCDEF" });
      saveAddress({ name: "Second", address: "0xabcdef" });

      const config = readLocalConfig();
      expect(config.addresses).toHaveLength(1);
      expect(config.addresses[0]?.name).toBe("Second");
    });
  });

  describe("removeAddress", () => {
    beforeEach(() => {
      const testConfig: LocalConfig = {
        addresses: [
          { name: "Wallet 1", address: "0xabc" },
          { name: "Wallet 2", address: "0xdef" },
        ],
      };
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(testConfig), "utf8");
    });

    it("removes matching address", () => {
      const result = removeAddress("0xabc");

      expect(result).toBe(true);
      const config = readLocalConfig();
      expect(config.addresses).toHaveLength(1);
      expect(config.addresses[0]?.address).toBe("0xdef");
    });

    it("returns false for non-existent address", () => {
      const result = removeAddress("0xnotexist");

      expect(result).toBe(false);
      const config = readLocalConfig();
      expect(config.addresses).toHaveLength(2);
    });

    it("matches case-insensitively", () => {
      const result = removeAddress("0xABC");

      expect(result).toBe(true);
      const config = readLocalConfig();
      expect(config.addresses).toHaveLength(1);
    });
  });

  describe("formatAddressChoice", () => {
    it("returns formatted string for CLI display", () => {
      const entry: SavedAddress = {
        name: "My Wallet",
        address: "0x1234567890123456789012345678901234567890",
      };

      const formatted = formatAddressChoice(entry);

      expect(formatted).toBe("My Wallet (0x1234...7890)");
    });

    it("handles short addresses", () => {
      const entry: SavedAddress = {
        name: "Short",
        address: "0x12345678",
      };

      const formatted = formatAddressChoice(entry);

      // Should handle gracefully even if address is shorter than expected
      expect(formatted).toContain("Short");
      expect(formatted).toContain("0x1234");
    });
  });
});
