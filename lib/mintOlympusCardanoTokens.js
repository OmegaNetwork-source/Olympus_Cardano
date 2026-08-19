/**
 * Cardano Olympus mint + balance helpers — browser-safe (no Mesh SDK).
 * Mint tx is built on the API server; wallet only signs via CIP-30.
 */
import {
  CARDANO_OLYMPUS_TOKENS,
  CARDANO_MINT_MIN_ADA_HINT,
  saveCardanoDeployRecord,
  formatCardanoAssetAmount,
  cardanoAssetUnit,
} from "./olympusCardanoAssets.js";
import { lovelaceToAda } from "./cip30.js";
import { getApiRoot } from "../api.js";
import { minswapWallet } from "./minswapAggregator.js";
import { assertCardanoOlympusMintAllowed } from "./cardanoMintGate.js";

/** UTF-8 string → hex (asset name encoding). */
export function stringToHex(str) {
  const s = String(str || "");
  let out = "";
  for (let i = 0; i < s.length; i++) {
    out += s.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Read pOmega / mUSDC balances via Minswap wallet API (no Mesh).
 * @param {string} _walletKey unused (call-site compat)
 * @param {string} policyId
 * @param {string} [addressBech32]
 */
export async function readOlympusCardanoBalances(_walletKey, policyId, addressBech32) {
  if (!addressBech32) {
    return { ada: "0", lovelace: 0n, assets: [], rawAssets: [] };
  }
  const wallet = await minswapWallet({ address: addressBech32, amountInDecimal: false });
  let lovelace = 0n;
  try {
    const raw = String(wallet?.ada || "0");
    if (raw.includes(".")) lovelace = BigInt(Math.round(Number(raw) * 1_000_000));
    else lovelace = BigInt(raw || "0");
  } catch {
    lovelace = 0n;
  }

  const pid = String(policyId || "").toLowerCase();
  const rawAssets = [];
  for (const entry of wallet?.balance || []) {
    const unit = String(entry?.asset?.token_id || "").toLowerCase();
    if (!unit || unit === "lovelace") continue;
    rawAssets.push({ unit, quantity: String(entry.amount || "0") });
  }

  const assets = [];
  for (const tok of Object.values(CARDANO_OLYMPUS_TOKENS)) {
    const nameHex = stringToHex(tok.assetName);
    const unit = cardanoAssetUnit(pid, nameHex);
    const hit = rawAssets.find((a) => a.unit === unit);
    const units = hit?.quantity || "0";
    assets.push({
      key: tok.key,
      ticker: tok.ticker,
      units,
      display: formatCardanoAssetAmount(units, tok.decimals),
      unit,
    });
  }

  return {
    ada: lovelaceToAda(lovelace),
    lovelace,
    assets,
    rawAssets,
  };
}

/**
 * Mint full supply via server-built CBOR + CIP-30 sign/submit.
 */
export async function mintOlympusCardanoTokens(opts) {
  const walletKey = opts?.walletKey;
  const networkId = Number(opts?.networkId);
  const addressBech32 = opts?.addressBech32 || "";
  const api = opts?.api;
  if (!walletKey || !api) throw new Error("Connect Lace / Eternl first");
  if (!addressBech32) throw new Error("Missing wallet address");
  assertCardanoOlympusMintAllowed(addressBech32);
  if (networkId === 0) throw new Error("Mainnet only — switch Lace off preprod/testnet");

  let changeAddress = addressBech32;
  try {
    const hexOrAddr = await api.getChangeAddress?.();
    if (typeof hexOrAddr === "string" && hexOrAddr.startsWith("addr")) changeAddress = hexOrAddr;
  } catch {
    /* keep bech32 */
  }
  void changeAddress;

  const buildRes = await fetch(`${getApiRoot()}/cardano/mint-olympus`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      address: addressBech32,
      networkId,
    }),
  });
  const built = await buildRes.json().catch(() => ({}));
  if (!buildRes.ok) {
    throw new Error(built?.error || built?.message || `Mint build failed (${buildRes.status})`);
  }
  const cbor = built?.cbor;
  const policyId = built?.policyId;
  if (!cbor || !policyId) throw new Error("Server did not return mint transaction");

  const witnessSet = await api.signTx(String(cbor).replace(/^0x/i, ""), true);
  const submitRes = await fetch(`${getApiRoot()}/cardano/submit-witnessed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cbor,
      witness_set: witnessSet,
      networkId,
    }),
  });
  const submitted = await submitRes.json().catch(() => ({}));
  if (!submitRes.ok) {
    const detail = submitted?.error || submitted?.message || `Submit failed (${submitRes.status})`;
    throw new Error(detail === "Submit failed" ? "Submit failed — wallet signed, but Cardano rejected the tx. Retry after refresh." : detail);
  }
  const txId = submitted?.tx_id || submitted?.txId;
  if (!txId) throw new Error("No transaction id after mint submit");

  const record = {
    policyId,
    txHash: txId,
    networkId,
    addressBech32,
    mintedAt: new Date().toISOString(),
    pOmegaUnits: built?.pOmegaUnits || CARDANO_OLYMPUS_TOKENS.pOmega.mintUnits,
    mUsdcUnits: built?.mUsdcUnits || CARDANO_OLYMPUS_TOKENS.mUSDC.mintUnits,
  };
  saveCardanoDeployRecord(record);

  const explorerTx =
    networkId === 0
      ? `https://preprod.cardanoscan.io/transaction/${txId}`
      : `https://cardanoscan.io/transaction/${txId}`;

  return {
    policyId,
    txHash: txId,
    pOmegaUnits: record.pOmegaUnits,
    mUsdcUnits: record.mUsdcUnits,
    explorerTx,
  };
}
