/**
 * Minswap Aggregator client — estimate / build / submit via Olympus API proxy.
 * Analytics API (api-mainnet-prod.minswap.org) is read-only; swaps use agg-api.
 */
import { getApiRoot } from "../api.js";

export const MINSWAP_ADA_TOKEN_ID = "lovelace";

/** Cardano USD stable used as USDC stand-in on Minswap (Mehen USDM). */
export const MINSWAP_USDM_TOKEN_ID =
  "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad0014df105553444d";

export const MINSWAP_MIN_TOKEN_ID =
  "29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c64d494e";

/** Seed catalog for the swap picker (ADA + liquid verified majors). */
export const MINSWAP_SEED_TOKENS = [
  {
    tokenId: MINSWAP_ADA_TOKEN_ID,
    ticker: "ADA",
    displayName: "Cardano",
    decimals: 6,
    logoURI: "https://asset-logos.minswap.org/lovelace",
  },
  {
    tokenId: MINSWAP_USDM_TOKEN_ID,
    ticker: "USDM",
    displayName: "USDM (Cardano USD)",
    decimals: 6,
    logoURI: `https://asset-logos.minswap.org/${MINSWAP_USDM_TOKEN_ID}`,
  },
  {
    tokenId: MINSWAP_MIN_TOKEN_ID,
    ticker: "MIN",
    displayName: "Minswap",
    decimals: 6,
    logoURI: `https://asset-logos.minswap.org/${MINSWAP_MIN_TOKEN_ID}`,
  },
  {
    tokenId: "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b",
    ticker: "SNEK",
    displayName: "Snek",
    decimals: 0,
    logoURI: "https://asset-logos.minswap.org/279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b",
  },
  {
    tokenId: "fe7c786ab321f41c654ef6c1af7b3250a613c24e4213e0425a7ae45655534441",
    ticker: "USDA",
    displayName: "Anzens USDA",
    decimals: 6,
    logoURI: "https://asset-logos.minswap.org/fe7c786ab321f41c654ef6c1af7b3250a613c24e4213e0425a7ae45655534441",
  },
];

function api(path) {
  return `${getApiRoot()}/minswap${path}`;
}

async function readJson(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.error ||
      data?.message ||
      data?.msg ||
      (typeof data === "string" ? data : null) ||
      `Minswap HTTP ${res.status}`;
    throw new Error(String(msg));
  }
  return data;
}

/** @param {{ amount: string, tokenIn: string, tokenOut: string, slippage: number, amountInDecimal?: boolean, allowMultiHops?: boolean }} opts */
export async function minswapEstimate(opts) {
  const body = {
    amount: String(opts.amount),
    token_in: String(opts.tokenIn),
    token_out: String(opts.tokenOut),
    slippage: Number(opts.slippage),
    amount_in_decimal: opts.amountInDecimal === true,
    allow_multi_hops: opts.allowMultiHops !== false,
  };
  const res = await fetch(api("/estimate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJson(res);
}

/**
 * @param {{
 *   sender: string,
 *   minAmountOut: string,
 *   amount: string,
 *   tokenIn: string,
 *   tokenOut: string,
 *   slippage: number,
 *   amountInDecimal?: boolean,
 *   allowMultiHops?: boolean,
 * }} opts
 */
export async function minswapBuildTx(opts) {
  const body = {
    sender: String(opts.sender),
    min_amount_out: String(opts.minAmountOut),
    amount_in_decimal: opts.amountInDecimal === true,
    estimate: {
      amount: String(opts.amount),
      token_in: String(opts.tokenIn),
      token_out: String(opts.tokenOut),
      slippage: Number(opts.slippage),
      allow_multi_hops: opts.allowMultiHops !== false,
    },
  };
  const res = await fetch(api("/build-tx"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJson(res);
}

/** @param {{ cbor: string, witnessSet: string }} opts */
export async function minswapFinalizeAndSubmit(opts) {
  const res = await fetch(api("/finalize-and-submit-tx"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cbor: String(opts.cbor),
      witness_set: String(opts.witnessSet),
    }),
  });
  return readJson(res);
}

/** @param {{ query?: string, onlyVerified?: boolean }} opts */
export async function minswapSearchTokens(opts = {}) {
  const res = await fetch(api("/tokens"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: String(opts.query || ""),
      only_verified: opts.onlyVerified !== false,
    }),
  });
  return readJson(res);
}

export async function minswapAdaPriceUsd() {
  const res = await fetch(api("/ada-price?currency=usd"));
  return readJson(res);
}

/** @param {{ address: string, amountInDecimal?: boolean }} opts */
export async function minswapWallet(opts) {
  const q = new URLSearchParams({
    address: String(opts.address || ""),
  });
  if (opts.amountInDecimal === true) q.set("amount_in_decimal", "true");
  const res = await fetch(api(`/wallet?${q.toString()}`));
  return readJson(res);
}

/** @param {{ ownerAddress: string, amountInDecimal?: boolean }} opts */
export async function minswapPendingOrders(opts) {
  const q = new URLSearchParams({
    owner_address: String(opts.ownerAddress || ""),
  });
  if (opts.amountInDecimal === true) q.set("amount_in_decimal", "true");
  const res = await fetch(api(`/pending-orders?${q.toString()}`));
  return readJson(res);
}

/**
 * @param {{ sender: string, orders: { tx_in: string, protocol: string }[] }} opts
 */
export async function minswapCancelTx(opts) {
  const res = await fetch(api("/cancel-tx"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: String(opts.sender),
      orders: Array.isArray(opts.orders) ? opts.orders : [],
    }),
  });
  return readJson(res);
}

/**
 * CIP-30: signTx returns a witness set hex.
 * Tries Minswap finalize first (aggregator txs), then Olympus /cardano/submit-witnessed.
 *
 * @param {{
 *   walletKey?: string,
 *   api?: object,
 *   unsignedCbor: string,
 * }} opts
 * @returns {Promise<{ txId: string, via: "minswap" | "cardano-api" }>}
 */
export async function minswapSignAndSubmit(opts) {
  const unsignedCbor = String(opts.unsignedCbor || "").replace(/^0x/i, "");
  if (!unsignedCbor) throw new Error("Missing unsigned transaction");

  const cip30 = opts.api;
  if (!cip30?.signTx) {
    throw new Error("Wallet does not support CIP-30 signTx");
  }

  const witnessSet = await cip30.signTx(unsignedCbor, true);

  try {
    const fin = await minswapFinalizeAndSubmit({ cbor: unsignedCbor, witnessSet });
    const txId = fin?.tx_id || fin?.txId || fin?.hash;
    if (txId) return { txId: String(txId), via: "minswap" };
  } catch (e) {
    console.warn("[cardano] Minswap finalize failed, trying Olympus submit", e?.message || e);
  }

  const submitRes = await fetch(`${getApiRoot()}/cardano/submit-witnessed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cbor: unsignedCbor, witness_set: witnessSet }),
  });
  const data = await submitRes.json().catch(() => ({}));
  if (!submitRes.ok) {
    throw new Error(data?.error || data?.message || `Submit failed (${submitRes.status})`);
  }
  const txId = data?.tx_id || data?.txId || data?.hash;
  if (!txId) throw new Error("No transaction id returned after submit");
  return { txId: String(txId), via: "cardano-api" };
}

export function humanizeMinswapErr(msg) {
  const m = String(msg || "");
  if (/user rejected|refused|canceled|cancelled|denied/i.test(m)) {
    return "You closed or rejected the wallet prompt.";
  }
  if (/insufficient|not enough|UTxO|utxo/i.test(m)) {
    return "Not enough ADA/tokens (or fragmented UTxOs). Try a smaller amount or consolidate.";
  }
  if (/no.?route|not.?found|unable to find/i.test(m)) {
    return "No Minswap route for this pair/amount. Try ADA ↔ USDM or a larger size.";
  }
  if (/429|rate.?limit/i.test(m)) {
    return "Minswap rate limit — wait a moment and try again.";
  }
  return m.length > 220 ? `${m.slice(0, 220)}…` : m;
}

export function formatCardanoTokenAmount(units, decimals = 6) {
  let n;
  try {
    n = typeof units === "bigint" ? units : BigInt(String(units || "0"));
  } catch {
    return "0";
  }
  const neg = n < 0n;
  if (neg) n = -n;
  const base = 10n ** BigInt(Math.max(0, Number(decimals) || 0));
  const whole = n / base;
  const frac = n % base;
  const fracStr = frac.toString().padStart(Number(decimals) || 0, "0").replace(/0+$/, "");
  const body = fracStr ? `${whole}.${fracStr}` : `${whole}`;
  return neg ? `-${body}` : body;
}

export function decimalToAtomicString(humanStr, decimals) {
  const s = String(humanStr || "").replace(/,/g, "").trim();
  if (!s || s === ".") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = Math.max(0, Math.min(18, Number(decimals) || 0));
  const [intPart, fracPart = ""] = s.split(".");
  const frac = (fracPart + "0".repeat(d)).slice(0, d);
  const raw = `${intPart.replace(/^0+(?=\d)/, "") || "0"}${frac}`.replace(/^0+(?=\d)/, "") || "0";
  try {
    const bi = BigInt(raw);
    if (bi <= 0n) return null;
    return bi.toString();
  } catch {
    return null;
  }
}
