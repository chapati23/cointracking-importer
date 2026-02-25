# Manual Scraping Workflow

When a blockchain explorer doesn't support CSV exports (common for Cosmos-based chains,
newer L2s, and RollApps), you can manually create CoinTracking-compatible CSVs by scraping
transaction data from the explorer UI.

## When to Use This

- Explorer has no CSV/export button (e.g., dym.fyi, explorers.guru)
- Explorer has no public API (or API endpoints are disabled)
- Chain uses Cosmos SDK transactions (staking, governance, IBC) not covered by EVM CSV format
- Small number of transactions where automation isn't worth building

## Step-by-Step Workflow

### 1. Identify All Explorers for the Chain

Check multiple explorers — they may show different data or have different capabilities.

| Chain      | Explorers to Check                                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Dymension  | [dym.fyi](https://dym.fyi), [explorers.guru](https://dymension.explorers.guru), [mintscan.io](https://www.mintscan.io/dymension) |
| Cosmos Hub | [mintscan.io](https://www.mintscan.io/cosmos), [atomscan.com](https://atomscan.com)                                              |
| Osmosis    | [mintscan.io](https://www.mintscan.io/osmosis), [celatone.osmosis.zone](https://celatone.osmosis.zone)                           |

For EVM-compatible Cosmos chains (Dymension, Evmos, Injective), also check if there's a
Blockscout or EtherScan-style explorer with CSV exports.

### 2. Gather Address Variants

Many Cosmos-EVM chains use both hex (0x...) and bech32 (prefix1...) addresses for the
same account. You may need both formats depending on the explorer.

Convert between them:

```bash
# Using the Dymension CLI
dymd debug addr 0xYOUR_ADDRESS

# Using a web tool
# https://bech32.williamchong.cloud/
```

### 3. Browse the Address Page

Navigate to the address page on the explorer and note:

- Total transaction count
- Available tabs (Transactions, Token Transfers, Staking, etc.)
- Whether pagination exists (transactions spread across multiple pages)
- Any "Download CSV" or "Export" buttons

### 4. Scrape Transaction Details

For each transaction, open the detail page and record:

| Field            | Required | Example                                           |
| ---------------- | -------- | ------------------------------------------------- |
| Transaction hash | Yes      | `0x6c389615...` or `9D6B442A...`                  |
| Timestamp (UTC)  | Yes      | `2024-02-08 06:29:00`                             |
| Type/Method      | Yes      | EVM Transfer, Stake, Swap, IBC Transfer, GOV Vote |
| From address     | Yes      | Full 0x or bech32 address                         |
| To address       | Yes      | Full address or validator name                    |
| Amount(s)        | Yes      | `1000.05 DYM`, `133.182576 USDC`                  |
| Fee              | Yes      | `0.00019758 DYM`                                  |
| Status           | Yes      | Success / Failed                                  |

For **swaps**, record both sides: what was sold and what was bought.

For **IBC transfers**, record the destination chain and address.

### 5. Map to CoinTracking Types

| Blockchain Action     | CoinTracking Type | Notes                                   |
| --------------------- | ----------------- | --------------------------------------- |
| Received native token | `Deposit`         | Incoming transfer                       |
| Sent native token     | `Withdrawal`      | Outgoing transfer                       |
| Swap (DEX trade)      | `Trade`           | Buy = received token, Sell = sent token |
| Stake / Delegate      | `Other Expense`   | Use TradeGroup: "Staking"               |
| Unstake / Undelegate  | `Other Income`    | Use TradeGroup: "Staking"               |
| Claim staking rewards | `Staking`         | Taxable income in most jurisdictions    |
| Governance vote       | _(skip)_          | No financial impact, only fee           |
| IBC transfer out      | `Withdrawal`      | Moving to another chain                 |
| IBC transfer in       | `Deposit`         | Receiving from another chain            |
| Bridge receive        | `Deposit`         | From RollApp or other chain             |
| Airdrop               | `Airdrop`         | Free tokens received                    |
| Failed transaction    | `Other Fee`       | Only the fee matters                    |

### 6. Generate the CSV

#### Option A: Write a Script (Recommended)

Create a TypeScript file that uses the project's `writeCoinTrackingCsv` utility:

```typescript
import { writeCoinTrackingCsv } from "../src/csv-utils.js";
import type { CoinTrackingRow } from "../src/types.js";

const rows: CoinTrackingRow[] = [
  {
    Type: "Deposit",
    BuyAmount: "1000.05",
    BuyCurrency: "DYM",
    SellAmount: "",
    SellCurrency: "",
    Fee: "0.00019758",
    FeeCurrency: "DYM",
    Exchange: "Dymension", // Chain name
    TradeGroup: "",
    Comment: "EVM Transfer | tx:0x6c3896...",
    Date: "2024-02-08 06:29:00", // UTC
  },
  // ... more rows
];

writeCoinTrackingCsv("data/imports/<chain>/<folder>/output/cointracking.csv", rows);
```

Run it:

```bash
npx tsx scripts/gen-<chain>-csv.ts
```

#### Option B: Write CSV Directly

The CoinTracking CSV format is simple enough to write by hand:

```csv
Type,Buy Amount,Buy Currency,Sell Amount,Sell Currency,Fee,Fee Currency,Exchange,Trade Group,Comment,Date
Deposit,1000.05,DYM,,,0.00019758,DYM,Dymension,,EVM Transfer,2024-02-08 06:29:00
Trade,49.376648118,DYM,1354.507037,NIM,0.0074453,DYM,Dymension,,Swap NIM->DYM,2024-05-18 20:55:01
```

### 7. Organize the Output

Place the generated CSV in the standard import directory structure:

```text
data/imports/
  <chain>/
    <address-short>/
      <date-range>/
        output/
          cointracking.csv
```

### 8. Verify and Import

```bash
# Quick sanity check — view the CSV
head -20 data/imports/<chain>/.../output/cointracking.csv

# Import to CoinTracking:
# 1. Go to https://cointracking.info → Enter Coins → CSV Import
# 2. Drag and drop the cointracking.csv file
# 3. Review the preview and confirm
```

## Tips

- **Tag uncertain amounts** with `VERIFY:` in the Comment field so you can search for them
  later in CoinTracking.
- **Cross-reference explorers**: One explorer may show amounts that another truncates.
  dym.fyi showed "1.358 NIM" on overview but "1,354.507037 NIM" in the swap detail.
- **Use one consistent timezone across all imports**: CoinTracking transfer matching is
  time-sensitive. Mixing UTC and local time in different imports can create false
  "Missing Transactions." Pick one timezone (for example, Europe/Berlin with DST) and
  keep all imported sources aligned.
- **Fees are always in the native token**: On Dymension, all fees are in DYM regardless
  of what tokens were transferred.
- **Staking delegation** is not a taxable event in most jurisdictions (you still own the
  tokens). Use `Other Expense` / `Other Income` with TradeGroup "Staking" to track movement
  without triggering tax calculations. Adjust based on your jurisdiction.
- **Skip governance votes** unless the fee is significant enough to track.
- **IBC transfers between your own wallets** on different chains are not taxable — they're
  just moving funds. Use `Withdrawal` on the sending chain and `Deposit` on the receiving
  chain.

## Stargaze Manual Import Playbook (Reusable)

This section captures chain-specific learnings from a full Stargaze reconstruction
(92 transactions, NFT-heavy activity, and CoinTracking reconciliation).

### Data Collection Strategy

1. **Primary source**: Mintscan transaction pages and logs by tx hash.
2. **Secondary source**: Stargaze wallet activity feed (useful for NFT action context:
   bought/sold/offers).
3. **Portfolio cross-check**: Stargaze Metabase wallet dashboard for current holdings sanity
   checks by collection.
4. **Goal**: Build a tx-hash-complete set first, then classify rows.

### Stargaze Classification Rules

Use tx message + event semantics, not only explorer labels.

| Pattern on chain                                       | CoinTracking type       | Notes                                              |
| ------------------------------------------------------ | ----------------------- | -------------------------------------------------- |
| `MsgTransfer` (IBC out) main asset                     | `Withdrawal`            | TradeGroup `Bridge` for bridge outs                |
| STARS amount exactly equal to tx fee (`auth_info.fee`) | `Other Fee`             | Do not keep as `Withdrawal`                        |
| NFT sale (`transfer_nft` out + coin in)                | `Trade`                 | Buy = proceeds token, Sell = NFT ticker            |
| NFT buy via `claim_buy_nft` or accepted collection bid | `Trade`                 | Buy = NFT ticker, Sell = paid token                |
| `set_ask`/listing setup security deposit               | `Other Fee` (pragmatic) | Avoid false missing-transfer flags in CoinTracking |
| Tiny unsolicited dust inflows (`0.000001`)             | `Airdrop (non taxable)` | Better than `Deposit` for missing-transfer report  |
| Free NFT distributions (no spend / no funds sent)      | `Airdrop (non taxable)` | For airdropped NFTs                                |

### Critical NFT Handling

- **Per-token ticker**: use one ticker per NFT instance, not one per collection.
- **8-char CoinTracking-safe format**: keep short deterministic tickers (for example `N-BK1H3`).
- **TradeGroup**: use collection name (for example `Bad Kids NFTs`, `Bit Kids NFTs`).
- **Net proceeds on sales**: use wallet-net received amount, not gross sale headline (creator
  and marketplace fees may be withheld upstream).

### Token Symbol Normalization (CoinTracking)

Normalize symbols before final CSV import:

- `STARS` -> `STARS3`
- `ATOM` -> `ATOM2`
- `TIA` -> `TIA3`

### Bridge and Fee Split Rules

- For bridge outs, represent:
  - one `Withdrawal` for bridged asset amount, and
  - one `Other Fee` for STARS gas (if present).
- This reduces false positives in CoinTracking's Missing Transactions report.

### Reconciliation Checklist Before Import

1. **Hash coverage**: verify expected tx count equals reconstructed set.
2. **Inventory check**: per NFT collection, net quantity should match current on-chain holdings.
3. **Native token balance check**: net STARS from CSV should match live wallet (within explained
   known deltas only).
4. **Missing report hardening**:
   - convert non-transfer withdrawals (`set_ask`, pure gas) to `Other Fee`,
   - avoid labeling dust as `Deposit` if it is effectively non-transfer noise.
5. **Timezone alignment**: ensure all related chain imports use the same timezone convention.

### Common Pitfalls

- Treating listing setup (`set_ask`) as transfer outflow.
- Treating gross NFT sale amount as wallet proceeds.
- Keeping fee-only rows as `Withdrawal`, which inflates missing-transfer alerts.
- Using raw bridge denoms (`IBC/...`) instead of final CoinTracking symbols.
- Mixing UTC with local-time imports, causing near-match transfers to miss by time window.

## Completed Manual Imports

| Chain     | Address                 | Date Range               | Rows | File                                                                          |
| --------- | ----------------------- | ------------------------ | ---- | ----------------------------------------------------------------------------- |
| Dymension | `0x12345678...12345678` | 2024-02-08 to 2024-05-18 | 6    | `data/imports/dymension/<address-short>/<date-range>/output/cointracking.csv` |
| Dymension | `0xabcdef12...abcdef12` | 2024-02-06 to 2024-05-18 | 14   | `data/imports/dymension/<address-short>/<date-range>/output/cointracking.csv` |
