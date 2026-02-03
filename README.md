# cointracking-evm-importer

Convert EtherScan/MantleScan CSV exports to CoinTracking-compatible format.

## Features

- Supports native transactions, ERC-20 tokens, internal txs, and NFTs
- **Auto-detects CSV types** from headers - no need to specify file types manually
- **Flexible input modes**: import a single file, multiple files, or all CSVs from a folder
- Detects swaps automatically (1:1 token exchanges in the same tx)
- Handles burns, bridges, airdrops, and mints
- **Organized import storage** with input files, output, and metadata tracked together
- Works with any EtherScan-based explorer (Mantle, Ethereum, Polygon, etc.)
- Save frequently used addresses locally for quick selection

## Quick Start

```bash
# Install dependencies
npm install

# Interactive mode (recommended) - auto-detects CSV types
npm run start

# Or convert with explicit options
npm run convert -- \
  --address 0x... \
  --chain Mantle \
  --nativeSymbol MNT \
  --native path/to/native.csv \
  --tokens path/to/tokens.csv \
  --output output.csv
```

## Interactive Mode

When you run `npm run start`, you'll be guided through:

1. **Input mode selection**:
   - Single file - import one CSV file of any type
   - Multiple files - select multiple files one by one
   - Folder - import all CSVs from a folder

2. **Auto-detection**: CSV types are automatically detected from headers:
   - Native Transactions (has `Value_IN(*)` or `Value_OUT(*)`)
   - Token Transfers (has `TokenValue` + `TokenSymbol`)
   - Internal Transactions (has `ParentTxFrom`)
   - NFT Transfers ERC-721 (has `TokenId`, no `TokenValue`)
   - NFT Transfers ERC-1155 (has `TokenId` + `TokenValue`)

3. **Confirmation**: Review detected files before proceeding

4. **Import storage**: Saved to `data/imports/` with organized folder structure

## Commands

| Command                                            | Description                                                    |
| -------------------------------------------------- | -------------------------------------------------------------- |
| `npm run start`                                    | Interactive mode - prompts for all options with auto-detection |
| `npm run convert <dir>`                            | Convert CSVs in a directory (auto-detects file types)          |
| `npm run convert -- --native x.csv --tokens y.csv` | Convert with explicit file paths                               |
| `npm run ingest <files...>`                        | Organize raw CSVs into `data/raw/` structure                   |
| `npm run list`                                     | Show all processed imports and their status                    |

## Options

| Option           | Description                                                 |
| ---------------- | ----------------------------------------------------------- |
| `--address`      | Your wallet address (0x...)                                 |
| `--chain`        | Chain name for CoinTracking Exchange field                  |
| `--nativeSymbol` | Native token symbol (ETH, MNT, MATIC, etc.)                 |
| `--native`       | Path to native transactions CSV                             |
| `--tokens`       | Path to token transfers CSV                                 |
| `--internal`     | Path to internal transactions CSV                           |
| `--nft721`       | Path to ERC-721 NFT transfers CSV                           |
| `--nft1155`      | Path to ERC-1155 NFT transfers CSV                          |
| `--output`       | Output file path                                            |
| `--cutoff`       | Only include txs after this date (YYYY-MM-DD)               |
| `--dry-run`      | Preview without writing                                     |
| `--verbose`      | Show detailed output                                        |
| `--test`         | Save to `test-imports/` instead of `imports/` (for testing) |

## Workflow Example

```bash
# 1. Download CSVs from MantleScan
#    - Export > Download CSV for Transactions
#    - Export > Download CSV for Token Transfers

# 2. Convert to CoinTracking format
npm run convert -- \
  --address 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 \
  --chain Mantle \
  --nativeSymbol MNT \
  --native ~/Downloads/export-0xd8dA6....csv \
  --tokens ~/Downloads/export-address-token-0xd8dA6....csv \
  --output mantle-2024.csv

# 3. Import to CoinTracking
#    - Go to Enter Coins > CSV Import
#    - Drag and drop mantle-2024.csv
```

## Supported Chains

Any EtherScan-based explorer should work:

- Mantle (MantleScan)
- Ethereum (EtherScan)
- Polygon (PolygonScan)
- Arbitrum (Arbiscan)
- Optimism (Optimistic EtherScan)
- Base (BaseScan)
- BNB Chain (BscScan)

## Import Storage

After each successful import, files are organized in `data/imports/` (or `data/test-imports/` when using `--test`):

```text
data/imports/
  <chain>/
    <name>_<address-short>/          # e.g., vitalik_0x1234...5678/
      <date-range>/                  # e.g., 2024-01-15_2024-03-20/
        input/
          native.csv
          tokens.csv
          ...
        output/
          cointracking.csv
        manifest.json
```

### Folder Naming

| Element        | Format                      | Example                 |
| -------------- | --------------------------- | ----------------------- |
| Chain          | lowercase                   | `mantle`, `ethereum`    |
| Address folder | `<name>_<first6>...<last4>` | `vitalik_0x1234...5678` |
| Date range     | ISO dates                   | `2024-01-15_2024-03-20` |

If an address has a saved name, it appears in the folder name.

### manifest.json

Each import includes a `manifest.json` with metadata:

```json
{
  "importedAt": "2024-03-21T10:30:00Z",
  "chain": "mantle",
  "address": "0x1234567890abcdef1234567890abcdef12345678",
  "addressName": "vitalik",
  "dateRange": { "from": "2024-01-15", "to": "2024-03-20" },
  "files": {
    "native": { "originalPath": "/path/to/export.csv", "txCount": 45 },
    "tokens": { "originalPath": "/path/to/tokens.csv", "txCount": 128 }
  },
  "output": { "file": "output/cointracking.csv", "rowCount": 173 }
}
```

## Saved Addresses

Save frequently used wallet addresses locally for quick selection in interactive mode.
Addresses are stored in `data/addresses.json` (gitignored).

### Usage

When running `npm run start` without the `--address` flag, you'll be prompted to:

1. **Select from saved addresses** - Choose from your locally saved addresses
2. **Enter address manually** - Type a new address, with option to save it

Addresses work across all EVM chains, so they are stored separately from chain settings.

### Manual Setup

You can also create the file manually:

```bash
mkdir -p data
```

```json
// data/addresses.json
{
  "addresses": [
    { "name": "Main Wallet", "address": "0x..." },
    { "name": "Trading", "address": "0x..." }
  ]
}
```

| Field     | Required | Description                  |
| --------- | -------- | ---------------------------- |
| `name`    | Yes      | Display name for the address |
| `address` | Yes      | The wallet address (0x...)   |

## Development

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Type-check
npm run typecheck

# Lint (auto-fixes issues)
npm run lint
```

### Code Quality

This project uses [Trunk](https://trunk.io) for code quality automation:

**Pre-commit**: Auto-formats code with Prettier

**Pre-push**: Runs full quality gate before pushing:

- `trunk check --all` - ESLint, Prettier, Markdownlint, security scanners
- TypeScript type checking
- Full test suite with coverage

**CI (GitHub Actions)**: Same checks run on every PR and push to main

**Enabled linters**:

| Linter       | Purpose                           |
| ------------ | --------------------------------- |
| ESLint       | TypeScript/JavaScript linting     |
| Prettier     | Code formatting                   |
| Markdownlint | Markdown formatting               |
| Trufflehog   | Secret detection                  |
| OSV-Scanner  | Dependency vulnerability scanning |
| Codespell    | Typo detection                    |

## License

MIT
