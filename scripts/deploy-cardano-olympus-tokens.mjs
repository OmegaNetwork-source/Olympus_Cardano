/**
 * Headless mint of Olympus pOmega + mUSDC native assets on Cardano.
 *
 * Same supplies as EVM/Aptos/Solana: 100B pOmega + 10M mUSDC @ 6 decimals.
 * Uses MeshWallet (mnemonic) — no Lace/CIP-30 required.
 *
 * Mainnet is gated to the allowlisted payment address in lib/cardano/cardanoMintGate.js.
 * Prefer the private UI at /ops/cardano-native-mint (not linked from the public DEX).
 *
 * Usage:
 *   CARDANO_MNEMONIC="word1 word2 ... word24" \
 *   CARDANO_NETWORK=mainnet \
 *   node scripts/deploy-cardano-olympus-tokens.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import {
  MeshWallet,
  MeshTxBuilder,
  ForgeScript,
  resolveScriptHash,
  stringToHex,
  KoiosProvider,
} from "@meshsdk/core";
import {
  CARDANO_OLYMPUS_TOKENS,
  POMEGA_MINT_UNITS,
  MUSDC_MINT_UNITS,
  cardanoAssetUnit,
} from "../lib/cardano/olympusCardanoAssets.js";
import {
  assertCardanoOlympusMintAllowed,
  CARDANO_OLYMPUS_MINT_ALLOWLIST,
} from "../lib/cardano/cardanoMintGate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(ROOT, ".env") });

const NETWORKS = {
  preprod: { id: 0, koios: "preprod", label: "preprod", explorerTx: (h) => `https://preprod.cardanoscan.io/transaction/${h}`, explorerPolicy: (p) => `https://preprod.cardanoscan.io/tokenPolicy/${p}` },
  preview: { id: 0, koios: "preview", label: "preview", explorerTx: (h) => `https://preview.cardanoscan.io/transaction/${h}`, explorerPolicy: (p) => `https://preview.cardanoscan.io/tokenPolicy/${p}` },
  mainnet: { id: 1, koios: "api", label: "mainnet", explorerTx: (h) => `https://cardanoscan.io/transaction/${h}`, explorerPolicy: (p) => `https://cardanoscan.io/tokenPolicy/${p}` },
};

function loadMnemonic() {
  const file = process.env.CARDANO_MNEMONIC_FILE?.trim();
  if (file) {
    const raw = fs.readFileSync(path.resolve(ROOT, file), "utf8").trim();
    return raw.split(/\s+/).filter(Boolean);
  }
  const raw = process.env.CARDANO_MNEMONIC?.trim();
  if (raw) return raw.split(/\s+/).filter(Boolean);
  return null;
}

function assertMnemonic(words) {
  if (!words || (words.length !== 15 && words.length !== 24)) {
    throw new Error(
      "CARDANO_MNEMONIC must be 15 or 24 words. Set CARDANO_BREW=1 to generate a new wallet.",
    );
  }
}

async function waitForUtxos(provider, address, { attempts = 36, delayMs = 10_000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const utxos = await provider.fetchAddressUTxOs(address);
    if (utxos?.length) return utxos;
    console.log(`[cardano-mint] No UTxOs yet (${i + 1}/${attempts}) — waiting for ADA…`);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `No UTxOs for ${address}. Fund with ≥5 ADA (preprod faucet or mainnet transfer), then re-run.`,
  );
}

async function main() {
  const netKey = String(process.env.CARDANO_NETWORK || "preprod").toLowerCase();
  const net = NETWORKS[netKey];
  if (!net) throw new Error(`Unknown CARDANO_NETWORK=${netKey} (use preprod|preview|mainnet)`);

  let words = loadMnemonic();
  if (!words && process.env.CARDANO_BREW === "1") {
    words = MeshWallet.brew();
    const outDir = path.join(ROOT, ".secrets");
    fs.mkdirSync(outDir, { recursive: true });
    const mnemonicPath = path.join(outDir, `cardano-${net.label}-mnemonic.txt`);
    const addrWallet = new MeshWallet({
      networkId: net.id,
      key: { type: "mnemonic", words },
    });
    const address = await addrWallet.getChangeAddress();
    fs.writeFileSync(mnemonicPath, words.join(" ") + "\n", { mode: 0o600 });
    fs.writeFileSync(
      path.join(outDir, `cardano-${net.label}-address.txt`),
      address + "\n",
      { mode: 0o600 },
    );
    console.log(JSON.stringify({
      status: "brewed",
      network: net.label,
      address,
      mnemonicFile: path.relative(ROOT, mnemonicPath),
      next: net.label === "mainnet"
        ? "Send ≥5 ADA to address, then: CARDANO_MNEMONIC_FILE=.secrets/cardano-mainnet-mnemonic.txt CARDANO_NETWORK=mainnet node scripts/deploy-cardano-olympus-tokens.mjs"
        : "Fund via https://docs.cardano.org/cardano-testnets/tools/faucet (Preprod), then: CARDANO_MNEMONIC_FILE=.secrets/cardano-preprod-mnemonic.txt CARDANO_NETWORK=preprod node scripts/deploy-cardano-olympus-tokens.mjs",
    }, null, 2));
    return;
  }

  assertMnemonic(words);

  const provider = new KoiosProvider(net.koios);
  const wallet = new MeshWallet({
    networkId: net.id,
    fetcher: provider,
    submitter: provider,
    key: { type: "mnemonic", words },
  });

  const address = await wallet.getChangeAddress();
  console.log(`[cardano-mint] network=${net.label} address=${address}`);

  if (net.label === "mainnet") {
    try {
      assertCardanoOlympusMintAllowed(address);
    } catch (e) {
      throw new Error(
        `${e.message}. Mainnet mint must use allowlisted address ${CARDANO_OLYMPUS_MINT_ALLOWLIST[0]}`,
      );
    }
  } else if (process.env.CARDANO_ALLOW_TESTNET_ANY !== "1") {
    console.warn(
      `[cardano-mint] testnet mint is unrestricted for local testing; set CARDANO_ALLOW_TESTNET_ANY=0 is N/A — mainnet is gated to ${CARDANO_OLYMPUS_MINT_ALLOWLIST[0]}`,
    );
  }

  const utxos = await waitForUtxos(provider, address, {
    attempts: process.env.CARDANO_WAIT_UTXO === "0" ? 1 : 36,
    delayMs: 10_000,
  });
  console.log(`[cardano-mint] utxos=${utxos.length}`);

  const forgingScript = ForgeScript.withOneSignature(address);
  const policyId = resolveScriptHash(forgingScript);
  const pOmega = CARDANO_OLYMPUS_TOKENS.pOmega;
  const mUsdc = CARDANO_OLYMPUS_TOKENS.mUSDC;
  const pOmegaHex = stringToHex(pOmega.assetName);
  const mUsdcHex = stringToHex(mUsdc.assetName);

  const metadata = {
    [policyId]: {
      [pOmega.assetName]: {
        name: pOmega.assetName,
        ticker: pOmega.ticker,
        description: pOmega.description,
        decimals: pOmega.decimals,
      },
      [mUsdc.assetName]: {
        name: mUsdc.assetName,
        ticker: mUsdc.ticker,
        description: mUsdc.description,
        decimals: mUsdc.decimals,
      },
    },
  };

  const txBuilder = new MeshTxBuilder({
    fetcher: provider,
    submitter: provider,
    evaluator: provider,
  });

  console.log(`[cardano-mint] building mint policyId=${policyId}`);
  const unsignedTx = await txBuilder
    .mint(POMEGA_MINT_UNITS, policyId, pOmegaHex)
    .mintingScript(forgingScript)
    .mint(MUSDC_MINT_UNITS, policyId, mUsdcHex)
    .mintingScript(forgingScript)
    .metadataValue(721, metadata)
    .changeAddress(address)
    .selectUtxosFrom(utxos)
    .complete();

  const signedTx = await wallet.signTx(unsignedTx);
  if (process.env.DRY_RUN === "1") {
    console.log(JSON.stringify({
      status: "dry_run",
      network: net.label,
      address,
      policyId,
      pOmegaUnit: cardanoAssetUnit(policyId, pOmegaHex),
      mUsdcUnit: cardanoAssetUnit(policyId, mUsdcHex),
      pOmegaUnits: POMEGA_MINT_UNITS,
      mUsdcUnits: MUSDC_MINT_UNITS,
    }, null, 2));
    return;
  }

  const txHash = await wallet.submitTx(signedTx);
  console.log(`[cardano-mint] submitted tx=${txHash}`);

  const record = {
    network: `cardano-${net.label}`,
    networkId: net.id,
    policyId,
    address,
    owner: address,
    decimals: 6,
    pOmega: {
      assetName: pOmega.assetName,
      unit: cardanoAssetUnit(policyId, pOmegaHex),
      supplyWhole: "100000000000",
      mintUnits: POMEGA_MINT_UNITS,
    },
    mUSDC: {
      assetName: mUsdc.assetName,
      unit: cardanoAssetUnit(policyId, mUsdcHex),
      supplyWhole: "10000000",
      mintUnits: MUSDC_MINT_UNITS,
    },
    mintable: true,
    note: "One-signature policy (ForgeScript.withOneSignature). Do not remint; policy remains open while this key can sign.",
    deployedAt: new Date().toISOString(),
    txHash,
    explorerTx: net.explorerTx(txHash),
    explorerPolicy: net.explorerPolicy(policyId),
  };

  const outPath = path.join(ROOT, "deployments", "pomega-cardano.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(record, null, 2) + "\n");
  console.log(`[cardano-mint] wrote ${path.relative(ROOT, outPath)}`);
  console.log(JSON.stringify({ status: "minted", ...record }, null, 2));
}

main().catch((e) => {
  console.error("[cardano-mint] FAILED:", e?.message || e);
  process.exit(1);
});
