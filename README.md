# Olympus on Cardano

Olympus integrates Cardano as a first-class chain for trading, prediction markets (Predict), and native asset infrastructure. This directory documents how Cardano works inside the Olympus platform.

**Live:** [olympus.omeganetwork.co/cardano](https://olympus.omeganetwork.co/cardano)

---

## Overview

Olympus brings three core Cardano integrations to mainnet:

| Integration | What it does | Status |
|---|---|---|
| **CIP-0170 Identity** | KERI-backed metadata attestation anchored on mainnet via Lace/Eternl | In development |
| **Oracles** | Price feeds powering live market/Predict UI for Cardano pairs | In development |
| **USDCx Stablecoins** | Policy-verified accept/settle path for predict/swap flows | In development |

Additionally, Olympus already supports:

- **pOmega & mUSDC** native assets minted on Cardano mainnet
- **Predict (EZ Peeze)** — escrow-based pOmega prediction bets via Lace (CIP-30)
- **Minswap** DEX aggregation for Cardano token swaps
- **CIP-30 wallet connect** — Lace, Eternl, Nami, Typhon, and others

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Browser (Lace/Eternl)              │
│  CIP-30 connect → sign stake/mint/attest txs         │
└──────────────────────┬───────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────┐
│                 Olympus API (Express)                 │
│  /api/cardano/ezpeze-build-stake                     │
│  /api/cardano/submit-witnessed                       │
│  /api/cardano/pomega-balance (Koios)                 │
│  /api/cardano/olympus-deploy                         │
│  /api/minswap/* (aggregator proxy)                   │
│  /api/ezpeze/bet (Cardano chain branch)              │
│  /api/ezpeze/config?chainId=900401                   │
└──────────────────────┬───────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────┐
│               Cardano Mainnet (via Koios)            │
│  Native assets (pOmega / mUSDC under one policy)     │
│  Escrow wallet (Mesh SDK + KoiosProvider)            │
│  Tx verification (tx_utxos / address_assets)         │
└──────────────────────────────────────────────────────┘
```

---

## Deployed Assets (Mainnet)

| Asset | Policy ID | Asset Name (hex) | Fingerprint |
|---|---|---|---|
| **pOmega** | `e9ff6e554a9932a8b9c0b94bb4a3241b8b55d572773ff94864746cb8` | `704f6d656761` | `asset1e9sd9ksq4wqck2d86tksnqqmvyet33w4shw32e` |
| **mUSDC** | `e9ff6e554a9932a8b9c0b94bb4a3241b8b55d572773ff94864746cb8` | `6d55534443` | `asset1wh6mf2et7l2gg3fx4va7d7a3jscq6zunf0rc7n` |

- **Decimals:** 6 (same as Solana/Aptos/EVM deployments)
- **Supply:** 100B pOmega / 10M mUSDC (whole tokens)
- **Explorer:** [cardanoscan.io/tokenPolicy/e9ff6e…](https://cardanoscan.io/tokenPolicy/e9ff6e554a9932a8b9c0b94bb4a3241b8b55d572773ff94864746cb8)
- **Mint tx:** [`4037dfd7d089285df9839f46d97ba88f42c5e901ce1653b6896711d75ba2da4d`](https://cardanoscan.io/transaction/4037dfd7d089285df9839f46d97ba88f42c5e901ce1653b6896711d75ba2da4d)

---

## How Predict Works (Cardano Escrow)

Same pattern as Solana/TON: custodial escrow with on-chain verification.

1. **User connects Lace** (CIP-30) → Olympus reads payment address
2. **User clicks UP/DOWN** → browser calls `POST /api/cardano/ezpeze-build-stake` with amount
3. **Server builds unsigned tx** (Mesh SDK): pOmega + min ADA → escrow address
4. **User approves in Lace** → CIP-30 `signTx` returns witness set
5. **Browser submits** via `POST /api/cardano/submit-witnessed` (merges witnesses + submits to Koios)
6. **Browser registers bet** → `POST /api/ezpeze/bet` with `chainId=900401` + tx hash
7. **Server verifies** via Koios `tx_utxos`: confirms pOmega arrived at escrow from user
8. **Resolution tick** — if user wins, server pays 1.5× pOmega from escrow key to winner

### Escrow Configuration

```bash
CARDANO_EZ_ESCROW_ADDRESS=addr1...         # receives pOmega stakes
CARDANO_EZ_ESCROW_PRIVATE_KEY=xprv1...     # signs winner payouts (or 5820 hex / 64-byte hex)
# OR
CARDANO_EZ_ESCROW_MNEMONIC="word1 ... word24"
```

Generate a dedicated escrow wallet:
```bash
node scripts/brew-cardano-ez-escrow.mjs
```

---

## How Minting Works

Native assets are minted under a one-signature policy (`ForgeScript.withOneSignature`). Mint is **gated** — only the allowlisted address can build mint transactions.

- **CLI mint:** `node scripts/deploy-cardano-olympus-tokens.mjs`
- **UI mint:** `/ops/cardano-native-mint` (not linked from public nav)
- **Server guard:** `assertCardanoOlympusMintAllowed(address)` rejects non-allowlisted wallets

After mint, the deploy record is saved to `deployments/pomega-cardano.json`.

---

## How Minswap Integration Works

Olympus proxies the Minswap Aggregator API for Cardano token swaps:

- `/api/minswap/wallet` — read balances
- `/api/minswap/estimate` — get swap quote
- `/api/minswap/build-tx` — build unsigned swap tx
- `/api/minswap/finalize-and-submit-tx` — attach CIP-30 witness + submit

The Trade tab on Cardano routes through the `OlympusCardanoMinswapPanel` component with charts from Minswap Analytics.

---

## CIP-30 Wallet Connection

Supported wallets: **Lace**, Eternl, Nami, Typhon, Flint, Gero, NuFi, VESPR.

```javascript
import { connectCardanoCip30Wallet, listCardanoCip30Wallets } from "./lib/cardano/cip30.js";

const wallets = listCardanoCip30Wallets();      // available injected wallets
const session = await connectCardanoCip30Wallet("lace");
// session.api        — CIP-30 API (signTx, submitTx, getBalance, etc.)
// session.addressBech32  — connected payment address
// session.networkId  — 0 (testnet) or 1 (mainnet)
```

---

## File Map

### Core Libraries (`lib/cardano/`)

| File | Purpose |
|---|---|
| `cip30.js` | CIP-30 wallet connect, CBOR balance parser, address helpers |
| `cardanoNetwork.js` | Network metadata, explorer URLs, docs links |
| `cardanoPomegaConfig.js` | Policy/unit resolution, escrow address, decimals, amount conversion |
| `cardanoEzPezeServer.js` | Build stake tx + payout winners (Mesh SDK, server-only) |
| `cardanoEzPezeStakeClient.js` | Browser: build/sign/submit stake via CIP-30 + read balance |
| `cardanoEzPezeVerify.js` | Verify pOmega transfer to escrow via Koios `tx_utxos` |
| `cardanoMintServer.js` | Build mint tx + merge CIP-30 witnesses (CSL) |
| `cardanoMintGate.js` | Allowlist check for mint access |
| `mintOlympusCardanoTokens.js` | Browser mint helper + balance reads via Minswap |
| `olympusCardanoAssets.js` | Token metadata, supply constants, formatting |
| `minswapAggregator.js` | Minswap aggregator API client (swap/wallet/cancel) |
| `minswapAnalytics.js` | Minswap analytics API (candles, pool metrics, TVL) |

### Components

| File | Purpose |
|---|---|
| `components/cardano/OlympusCardanoGatedMintPage.jsx` | Private mint console UI |
| `components/OlympusCardanoMinswapPanel.jsx` | Minswap swap UI (Trade tab) |
| `components/OlympusCardanoMinswapChart.jsx` | Candlestick chart for Cardano pairs |
| `components/OlympusCardanoMinswapStats.jsx` | Pool stats + activity list |

### Scripts

| File | Purpose |
|---|---|
| `scripts/deploy-cardano-olympus-tokens.mjs` | Headless CLI mint (mnemonic-based) |
| `scripts/brew-cardano-ez-escrow.mjs` | Generate dedicated escrow wallet + key |

### Config / Deploy Records

| File | Purpose |
|---|---|
| `deployments/pomega-cardano.json` | On-chain mint record (policy, units, tx hash) |
| `.env.example` | All `CARDANO_*` env vars documented |

---

## API Endpoints (Cardano-specific)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/cardano/ezpeze-build-stake` | Build unsigned pOmega stake tx |
| POST | `/api/cardano/submit-witnessed` | Attach CIP-30 witness + submit to Koios |
| GET | `/api/cardano/pomega-balance?address=&unit=` | pOmega balance via Koios (6dp human) |
| GET | `/api/cardano/olympus-deploy` | Read mint deploy record |
| POST | `/api/cardano/mint-olympus` | Build mint tx (gated) |
| GET | `/api/ezpeze/config?chainId=900401` | Predict config (escrow, units, payouts) |
| POST | `/api/ezpeze/bet` | Register bet (Cardano branch when chainId=900401) |
| GET/POST | `/api/minswap/*` | Minswap aggregator proxy |

---

## Environment Variables

```bash
# Predict escrow (required for live bets + payouts)
CARDANO_EZ_ESCROW_ADDRESS=addr1...
CARDANO_EZ_ESCROW_PRIVATE_KEY=xprv1...   # or CARDANO_EZ_ESCROW_MNEMONIC
CARDANO_EZ_STAKE_MIN_LOVELACE=1500000    # ADA locked per stake output
CARDANO_EZ_STAKE_WALLET_MIN_LOVELACE=5000000  # min ADA for betting wallet

# Asset config (defaults from deployments/pomega-cardano.json)
CARDANO_POMEGA_POLICY_ID=e9ff6e554a9932a8b9c0b94bb4a3241b8b55d572773ff94864746cb8
CARDANO_POMEGA_UNIT=e9ff6e554a9932a8b9c0b94bb4a3241b8b55d572773ff94864746cb8704f6d656761
CARDANO_MUSDC_UNIT=e9ff6e554a9932a8b9c0b94bb4a3241b8b55d572773ff94864746cb86d55534443
CARDANO_POMEGA_DECIMALS=6
```

---

## Roadmap (Catalyst Grant M1)

| Integration | Deliverable | Proof |
|---|---|---|
| CIP-0170 Identity | KERI-signed attestation anchored on mainnet | ≥1 real-user mainnet tx |
| Oracles | Feeds power live Predict UI | ≥1 fee-paying flow, ≥2 runs |
| USDCx Stablecoins | Accept/settle path in predict/swap | ≥1 real-user mainnet tx |

---

## Links

- **App:** https://olympus.omeganetwork.co/cardano
- **Explorer (policy):** https://cardanoscan.io/tokenPolicy/e9ff6e554a9932a8b9c0b94bb4a3241b8b55d572773ff94864746cb8
- **Discord:** https://discord.gg/omeganetwork
- **Main repo:** https://github.com/OmegaNetwork-source/olympus
