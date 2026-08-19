/**
 * Browser: build+sign+submit Cardano Predict stake (pOmega → escrow) via CIP-30.
 */
import { getApiRoot } from "../api.js";
import { POOmega_CARDANO_UNIT, POOmega_CARDANO_DECIMALS } from "../pomegaConfig.js";

function rawToHuman(rawIn, decimals) {
  const raw = typeof rawIn === "bigint" ? rawIn : BigInt(String(rawIn || "0"));
  const d = Math.min(18, Math.max(0, Number(decimals) || 0));
  const base = 10n ** BigInt(d);
  const whole = raw / base;
  const frac = raw % base;
  const fracStr = frac.toString().padStart(d, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}

/** Stake pOmega into the Cardano EZ Peeze escrow. */
export async function sendCardanoEzPezeStake(opts) {
  const api = opts?.api;
  const addressBech32 = String(opts?.addressBech32 || "").trim();
  const networkId = Number(opts?.networkId ?? 1);
  const amountHuman = opts?.amountHuman;
  if (!api?.signTx) throw new Error("Connect Lace first");
  if (!addressBech32.startsWith("addr")) throw new Error("Missing Cardano address");
  if (networkId === 0) throw new Error("Mainnet only for Cardano Predict");

  const buildRes = await fetch(`${getApiRoot()}/cardano/ezpeze-build-stake`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      address: addressBech32,
      networkId,
      amount: amountHuman,
    }),
  });
  const built = await buildRes.json().catch(() => ({}));
  if (!buildRes.ok) {
    const rawErr = built?.error || built?.message || `Stake build failed (${buildRes.status})`;
    if (/utxo fully depleted|not enough ada|insufficient/i.test(String(rawErr))) {
      throw new Error(
        "Not enough ADA in this Lace wallet for a token stake. " +
          "Fund ~5 ADA on the betting account (fees + min-ADA lock), then retry.",
      );
    }
    throw new Error(rawErr);
  }
  const cbor = built?.cbor;
  if (!cbor) throw new Error("Server did not return stake transaction");

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
    throw new Error(submitted?.error || submitted?.message || `Stake submit failed (${submitRes.status})`);
  }
  const txId = submitted?.tx_id || submitted?.txId;
  if (!txId) throw new Error("No transaction id after stake submit");
  return { txHash: String(txId), rawAmount: built?.rawAmount, unit: built?.unit };
}

/**
 * Read pOmega balance (human) for Predict UI.
 * Prefers Olympus Koios proxy (indexes new native assets); Minswap is fallback only.
 */
export async function readCardanoPomegaBalanceHuman(addressBech32, pomegaUnit, decimals = POOmega_CARDANO_DECIMALS) {
  if (!addressBech32) return "0";
  const unit = String(pomegaUnit || POOmega_CARDANO_UNIT || "").toLowerCase();
  const dec = Number.isFinite(Number(decimals)) ? Number(decimals) : POOmega_CARDANO_DECIMALS;

  try {
    const q = new URLSearchParams({ address: addressBech32 });
    if (unit) q.set("unit", unit);
    const res = await fetch(`${getApiRoot()}/cardano/pomega-balance?${q.toString()}`);
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.human != null) return String(data.human);
    if (res.ok && data?.raw != null) return rawToHuman(data.raw, data.decimals ?? dec);
  } catch {
    /* fall through */
  }

  try {
    const { minswapWallet } = await import("./minswapAggregator.js");
    const wallet = await minswapWallet({ address: addressBech32, amountInDecimal: false });
    for (const entry of wallet?.balance || []) {
      const id = String(entry?.asset?.token_id || "").toLowerCase();
      if (id !== unit) continue;
      return rawToHuman(entry.amount || "0", dec);
    }
  } catch {
    /* ignore */
  }
  return "0";
}

const PENDING_STAKE_KEY = "omega-cardano-ez-pending-stake-v1";

/** Persist a submitted stake so we can register the bet after Koios catches up (no double-spend). */
export function saveCardanoPendingStake(rec) {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(
      PENDING_STAKE_KEY,
      JSON.stringify({
        txHash: String(rec?.txHash || "").toLowerCase().replace(/^0x/, ""),
        amount: Number(rec?.amount),
        address: String(rec?.addressBech32 || rec?.address || ""),
        savedAt: Date.now(),
      }),
    );
  } catch {
    /* ignore */
  }
}

export function clearCardanoPendingStake() {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.removeItem(PENDING_STAKE_KEY);
  } catch {
    /* ignore */
  }
}

/** @returns {{ txHash: string, amount: number, address: string, savedAt: number } | null} */
export function loadCardanoPendingStake(addressBech32) {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const raw = sessionStorage.getItem(PENDING_STAKE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    const addr = String(addressBech32 || "").toLowerCase();
    if (!j?.txHash || !addr || String(j.address || "").toLowerCase() !== addr) return null;
    if (Date.now() - Number(j.savedAt || 0) > 2 * 60 * 60 * 1000) {
      clearCardanoPendingStake();
      return null;
    }
    return j;
  } catch {
    return null;
  }
}

