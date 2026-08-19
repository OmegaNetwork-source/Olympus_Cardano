/**
 * Minswap Analytics API (api-mainnet-prod) — DexScreener stand-in for Cardano.
 * Distinct from the Aggregator API used for swaps.
 */
import { getApiRoot } from "../api.js";
import { MINSWAP_ADA_TOKEN_ID } from "./minswapAggregator.js";

const ANALYTICS = () => `${getApiRoot()}/minswap-analytics`;

async function readJson(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error || data?.message || `Minswap analytics HTTP ${res.status}`;
    throw new Error(String(msg));
  }
  return data;
}

/** Analytics asset id: ADA → "lovelace"; else policyId+assetNameHex. */
export function minswapAnalyticsAssetId(tokenId) {
  const id = String(tokenId || "").trim();
  if (!id || id === "lovelace" || id === MINSWAP_ADA_TOKEN_ID) return "lovelace";
  return id;
}

export function minswapLpAssetId(lp) {
  if (!lp) return "";
  if (typeof lp === "string") return lp;
  return `${lp.currency_symbol || ""}${lp.token_name || ""}`;
}

export function minswapAssetUnitFromMeta(asset) {
  if (!asset) return "";
  const cs = asset.currency_symbol ?? "";
  const tn = asset.token_name ?? "";
  if (!cs && !tn) return "lovelace";
  return `${cs}${tn}`;
}

/** GET /v1/assets/:id/metrics */
export async function minswapAssetMetrics(assetId, currency = "usd") {
  const id = encodeURIComponent(minswapAnalyticsAssetId(assetId));
  const q = new URLSearchParams({ currency });
  const res = await fetch(`${ANALYTICS()}/assets/${id}/metrics?${q}`);
  return readJson(res);
}

/** GET /v1/assets/:id/price/candlestick */
export async function minswapAssetCandles(assetId, { interval = "1h", limit = 168, currency = "usd", startTime, endTime } = {}) {
  const id = encodeURIComponent(minswapAnalyticsAssetId(assetId));
  const q = new URLSearchParams({ interval, limit: String(limit), currency });
  if (startTime != null) q.set("start_time", String(startTime));
  if (endTime != null) q.set("end_time", String(endTime));
  const res = await fetch(`${ANALYTICS()}/assets/${id}/price/candlestick?${q}`);
  return readJson(res);
}

/** POST /v1/pools/metrics */
export async function minswapPoolsMetrics(body = {}) {
  const res = await fetch(`${ANALYTICS()}/pools/metrics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      term: body.term ?? "",
      limit: body.limit ?? 20,
      only_verified: body.onlyVerified !== false,
      sort_field: body.sortField || "liquidity",
      sort_direction: body.sortDirection || "desc",
      currency: body.currency || "usd",
      protocols: body.protocols,
      search_after: body.searchAfter,
    }),
  });
  return readJson(res);
}

/** GET /v1/pools/:id/metrics */
export async function minswapPoolMetrics(poolId, currency = "usd") {
  const id = encodeURIComponent(String(poolId || ""));
  const q = new URLSearchParams({ currency });
  const res = await fetch(`${ANALYTICS()}/pools/${id}/metrics?${q}`);
  return readJson(res);
}

/** GET /v1/pools/:id/price/candlestick */
export async function minswapPoolCandles(poolId, { interval = "1h", limit = 168, startTime, endTime } = {}) {
  const id = encodeURIComponent(String(poolId || ""));
  const q = new URLSearchParams({ interval, limit: String(limit) });
  if (startTime != null) q.set("start_time", String(startTime));
  if (endTime != null) q.set("end_time", String(endTime));
  const res = await fetch(`${ANALYTICS()}/pools/${id}/price/candlestick?${q}`);
  return readJson(res);
}

/** GET /v1/pools/:id/volume/timeseries */
export async function minswapPoolVolumeTimeseries(poolId, period = "1d", currency = "usd") {
  const id = encodeURIComponent(String(poolId || ""));
  const q = new URLSearchParams({ period, currency });
  const res = await fetch(`${ANALYTICS()}/pools/${id}/volume/timeseries?${q}`);
  return readJson(res);
}

function tickersMatch(asset, ticker) {
  const t = String(ticker || "").toLowerCase();
  if (!t) return false;
  const meta = asset?.metadata || {};
  return (
    String(meta.ticker || "").toLowerCase() === t ||
    String(meta.name || "").toLowerCase() === t
  );
}

function poolHasAssets(pool, tokenA, tokenB) {
  const a = minswapAssetUnitFromMeta(pool?.asset_a);
  const b = minswapAssetUnitFromMeta(pool?.asset_b);
  const set = new Set([a.toLowerCase(), b.toLowerCase()]);
  return set.has(String(tokenA || "").toLowerCase()) && set.has(String(tokenB || "").toLowerCase());
}

/**
 * Pick best Minswap pool for a token pair (liquidity desc).
 * @returns {Promise<object|null>} pool_metrics row
 */
export async function fetchBestMinswapPoolForPair(tokenInId, tokenOutId, tickers = {}) {
  const a = minswapAnalyticsAssetId(tokenInId);
  const b = minswapAnalyticsAssetId(tokenOutId);
  if (!a || !b || a === b) return null;

  const term =
    [tickers.out, tickers.in, tickers.outTicker, tickers.inTicker]
      .map((x) => String(x || "").trim())
      .find(Boolean) || "";

  const data = await minswapPoolsMetrics({
    term,
    limit: 40,
    onlyVerified: true,
    sortField: "liquidity",
    sortDirection: "desc",
    currency: "usd",
  });

  const pools = Array.isArray(data?.pool_metrics) ? data.pool_metrics : [];
  const exact = pools.filter((p) => poolHasAssets(p, a, b));
  exact.sort(
    (x, y) =>
      Number(y.liquidity_currency || y.liquidity || 0) - Number(x.liquidity_currency || x.liquidity || 0),
  );

  if (exact.length) return exact[0];

  // Soft match by ticker when unit ids differ (e.g. chart USDC vs on-chain USDM)
  const soft = pools.find((p) => {
    const tin = tickers.inTicker || tickers.in;
    const tout = tickers.outTicker || tickers.out;
    const hitIn = tickersMatch(p.asset_a, tin) || tickersMatch(p.asset_b, tin);
    const hitOut = tickersMatch(p.asset_a, tout) || tickersMatch(p.asset_b, tout);
    return hitIn && hitOut;
  });
  return soft || null;
}

/**
 * Bundle for Olympus Cardano analytics panel (chart + stats).
 * Focus asset = non-ADA side when possible (DexScreener-style token view).
 */
export async function fetchCardanoMinswapAnalyticsBundle({
  payTokenId,
  recvTokenId,
  payTicker,
  recvTicker,
  interval = "1h",
  candleLimit = 168,
} = {}) {
  const payId = minswapAnalyticsAssetId(payTokenId);
  const recvId = minswapAnalyticsAssetId(recvTokenId);
  const focusId = payId === "lovelace" ? recvId : recvId === "lovelace" ? payId : recvId;
  const focusTicker = payId === "lovelace" ? recvTicker : recvId === "lovelace" ? payTicker : recvTicker;

  const [pool, focusMetrics] = await Promise.all([
    fetchBestMinswapPoolForPair(payId, recvId, {
      in: payTicker,
      out: recvTicker,
      inTicker: payTicker,
      outTicker: recvTicker,
    }).catch(() => null),
    focusId ? minswapAssetMetrics(focusId, "usd").catch(() => null) : Promise.resolve(null),
  ]);

  const poolId = pool ? minswapLpAssetId(pool.lp_asset) : "";
  let candles = [];
  let candleSource = "none";
  if (poolId) {
    try {
      candles = await minswapPoolCandles(poolId, { interval, limit: candleLimit });
      candleSource = "pool";
    } catch {
      candles = [];
    }
  }
  if ((!Array.isArray(candles) || !candles.length) && focusId) {
    try {
      candles = await minswapAssetCandles(focusId, { interval, limit: candleLimit, currency: "usd" });
      candleSource = "asset";
    } catch {
      candles = [];
    }
  }

  let volumeSeries = [];
  if (poolId) {
    try {
      volumeSeries = await minswapPoolVolumeTimeseries(poolId, "1d", "usd");
    } catch {
      volumeSeries = [];
    }
  }

  return {
    pool,
    poolId,
    focusId,
    focusTicker: focusTicker || focusMetrics?.asset?.metadata?.ticker || "",
    focusMetrics,
    candles: Array.isArray(candles) ? candles : [],
    candleSource,
    volumeSeries: Array.isArray(volumeSeries) ? volumeSeries : [],
    payId,
    recvId,
  };
}

export function fmtMinswapUsd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(2)}K`;
  if (Math.abs(v) >= 1) return `$${v.toFixed(v >= 100 ? 2 : 4)}`;
  return `$${v.toPrecision(4)}`;
}

export function fmtMinswapPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

export function minswapPoolLabel(pool) {
  if (!pool) return "Minswap";
  const a = pool.asset_a?.metadata?.ticker || (minswapAssetUnitFromMeta(pool.asset_a) === "lovelace" ? "ADA" : "?");
  const b = pool.asset_b?.metadata?.ticker || "?";
  return `${a}/${b}`;
}
