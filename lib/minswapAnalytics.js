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
export async function minswapAssetCandles(
  assetId,
  { interval = "1h", limit = 168, currency = "usd", startTime, endTime } = {},
) {
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

function poolHasAssets(pool, tokenA, tokenB) {
  const a = minswapAssetUnitFromMeta(pool?.asset_a).toLowerCase();
  const b = minswapAssetUnitFromMeta(pool?.asset_b).toLowerCase();
  const want = new Set([String(tokenA || "").toLowerCase(), String(tokenB || "").toLowerCase()]);
  return want.has(a) && want.has(b);
}

function poolLiquidityUsd(pool) {
  return Number(pool?.liquidity_currency || pool?.liquidity || 0) || 0;
}

/**
 * Pick best Minswap pool for a token pair (exact asset-id match only).
 * Soft ticker matching is intentionally avoided — it was picking unrelated
 * low-liquidity pools (e.g. SNEK/MIN) and desyncing chart vs USD price.
 * @returns {Promise<object|null>} pool_metrics row
 */
export async function fetchBestMinswapPoolForPair(tokenInId, tokenOutId, tickers = {}) {
  const a = minswapAnalyticsAssetId(tokenInId);
  const b = minswapAnalyticsAssetId(tokenOutId);
  if (!a || !b || a === b) return null;

  const term =
    [tickers.out, tickers.in, tickers.outTicker, tickers.inTicker]
      .map((x) => String(x || "").trim())
      .find((x) => x && !/^lovelace$/i.test(x) && !/^ada$/i.test(x)) || "";

  const attempts = [];
  if (term) attempts.push({ term, onlyVerified: true, limit: 50 });
  attempts.push({ term: "", onlyVerified: true, limit: 50 });
  // One unverified pass for brand-new tokens
  if (term) attempts.push({ term, onlyVerified: false, limit: 40 });

  for (const attempt of attempts) {
    try {
      const data = await minswapPoolsMetrics({
        term: attempt.term,
        limit: attempt.limit,
        onlyVerified: attempt.onlyVerified,
        sortField: "liquidity",
        sortDirection: "desc",
        currency: "usd",
      });
      const pools = Array.isArray(data?.pool_metrics) ? data.pool_metrics : [];
      const exact = pools.filter((p) => poolHasAssets(p, a, b));
      exact.sort((x, y) => poolLiquidityUsd(y) - poolLiquidityUsd(x));
      if (exact.length) return exact[0];
    } catch {
      /* try next */
    }
  }
  return null;
}

function candleSide(c) {
  return Number(c.close) >= Number(c.open) ? "buy" : "sell";
}

/** Infer buy/sell volume from OHLCV candles (Minswap has no public trades feed). */
export function minswapBuySellFromCandles(candles, windowMs = 24 * 60 * 60 * 1000) {
  const list = Array.isArray(candles) ? candles : [];
  const now = Date.now();
  // Minswap timestamps are sometimes ahead of wall clock in this environment; use max candle ts as "now".
  let maxTs = 0;
  for (const c of list) {
    const ts = Number(c.timestamp) || 0;
    if (ts > maxTs) maxTs = ts;
  }
  const end = Math.max(now, maxTs);
  const cutoff = end - windowMs;
  let buyVol = 0;
  let sellVol = 0;
  let buys = 0;
  let sells = 0;
  let high = -Infinity;
  let low = Infinity;
  for (const c of list) {
    const ts = Number(c.timestamp) || 0;
    if (ts < cutoff) continue;
    const vol = Number(c.volume) || 0;
    const hi = Number(c.high);
    const lo = Number(c.low);
    if (Number.isFinite(hi)) high = Math.max(high, hi);
    if (Number.isFinite(lo)) low = Math.min(low, lo);
    if (vol <= 0) continue;
    if (candleSide(c) === "buy") {
      buyVol += vol;
      buys += 1;
    } else {
      sellVol += vol;
      sells += 1;
    }
  }
  return {
    buyVol,
    sellVol,
    buys,
    sells,
    high24: Number.isFinite(high) && high !== -Infinity ? high : null,
    low24: Number.isFinite(low) && low !== Infinity ? low : null,
  };
}

/** All-time high/low from a long daily candle series. */
export function minswapAthAtlFromCandles(candles) {
  const list = Array.isArray(candles) ? candles : [];
  let ath = -Infinity;
  let atl = Infinity;
  let last = null;
  for (const c of list) {
    const hi = Number(c.high);
    const lo = Number(c.low);
    const cl = Number(c.close);
    if (Number.isFinite(hi)) ath = Math.max(ath, hi);
    if (Number.isFinite(lo)) atl = Math.min(atl, lo);
    if (Number.isFinite(cl)) last = cl;
  }
  if (!(ath > 0) || !(atl > 0) || last == null) {
    return { ath: null, atl: null, athChangePct: null, atlChangePct: null, last };
  }
  return {
    ath,
    atl,
    last,
    athChangePct: ((last - ath) / ath) * 100,
    atlChangePct: ((last - atl) / atl) * 100,
  };
}

/**
 * Build Activity rows with Buy/Sell labels from candles (newest first).
 * Volume on asset USD candles is already USD-denominated.
 */
export function minswapActivityFromCandles(candles, { limit = 48 } = {}) {
  const list = Array.isArray(candles) ? candles.slice() : [];
  list.sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
  const out = [];
  for (const c of list) {
    const vol = Number(c.volume) || 0;
    if (!(vol > 0)) continue;
    const side = candleSide(c);
    out.push({
      timestamp: Number(c.timestamp) || 0,
      side,
      valueUsd: vol,
      price: Number(c.close),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
    });
    if (out.length >= limit) break;
  }
  return out;
}

function fmtAge(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const ms = Date.now() - t;
  if (ms < 0) return null;
  const days = Math.floor(ms / 86400000);
  if (days >= 365) {
    const y = Math.floor(days / 365);
    const m = Math.floor((days % 365) / 30);
    return m > 0 ? `${y}y ${m}mo` : `${y}y`;
  }
  if (days >= 30) return `${Math.floor(days / 30)}mo`;
  if (days >= 1) return `${days}d`;
  const h = Math.floor(ms / 3600000);
  return h > 0 ? `${h}h` : "<1h";
}

/**
 * Bundle for Olympus Cardano analytics panel (chart + stats).
 * Focus asset = non-ADA side when possible (DexScreener-style token view).
 * Chart uses asset USD candles so price matches left-panel / Minswap USD quotes.
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
  const focusTicker =
    payId === "lovelace" ? recvTicker : recvId === "lovelace" ? payTicker : recvTicker;

  const [pool, focusMetrics] = await Promise.all([
    fetchBestMinswapPoolForPair(payId, recvId, {
      in: payTicker,
      out: recvTicker,
      inTicker: payTicker,
      outTicker: recvTicker,
    }).catch(() => null),
    focusId && focusId !== "lovelace"
      ? minswapAssetMetrics(focusId, "usd").catch(() => null)
      : Promise.resolve(null),
  ]);

  const poolId = pool ? minswapLpAssetId(pool.lp_asset) : "";

  // Prefer asset USD candles so chart price aligns with focusMetrics.price / Minswap token page.
  let candles = [];
  let candleSource = "none";
  if (focusId && focusId !== "lovelace") {
    try {
      candles = await minswapAssetCandles(focusId, {
        interval,
        limit: candleLimit,
        currency: "usd",
      });
      candleSource = "asset";
    } catch {
      candles = [];
    }
  }
  if ((!Array.isArray(candles) || !candles.length) && poolId) {
    try {
      candles = await minswapPoolCandles(poolId, { interval, limit: candleLimit });
      candleSource = "pool";
    } catch {
      candles = [];
    }
  }

  // Daily candles for ATH/ATL + denser activity when hourly volume is sparse
  let dailyCandles = [];
  if (focusId && focusId !== "lovelace") {
    try {
      dailyCandles = await minswapAssetCandles(focusId, {
        interval: "1d",
        limit: 400,
        currency: "usd",
      });
    } catch {
      dailyCandles = [];
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

  const activitySource =
    Array.isArray(candles) && candles.some((c) => Number(c.volume) > 0)
      ? candles
      : dailyCandles;
  const activity = minswapActivityFromCandles(activitySource, { limit: 48 });
  const buySell24h = minswapBuySellFromCandles(
    Array.isArray(candles) && candles.length ? candles : dailyCandles,
    24 * 60 * 60 * 1000,
  );
  const athAtl = minswapAthAtlFromCandles(dailyCandles.length ? dailyCandles : candles);

  const createdAt = focusMetrics?.created_at || null;

  return {
    pool,
    poolId,
    focusId,
    focusTicker: focusTicker || focusMetrics?.asset?.metadata?.ticker || "",
    focusMetrics,
    candles: Array.isArray(candles) ? candles : [],
    candleSource,
    volumeSeries: Array.isArray(volumeSeries) ? volumeSeries : [],
    activity,
    buySell24h,
    athAtl,
    tokenAge: fmtAge(createdAt),
    createdAt,
    payId,
    recvId,
    payTicker: payTicker || "",
    recvTicker: recvTicker || "",
  };
}

export function fmtMinswapUsd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "$0.00";
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(2)}K`;
  if (Math.abs(v) >= 1) return `$${v.toFixed(v >= 100 ? 2 : 4)}`;
  if (Math.abs(v) >= 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toPrecision(3)}`;
}

export function fmtMinswapPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

export function fmtMinswapCompact(n, { prefix = "", suffix = "" } = {}) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  let core;
  if (Math.abs(v) >= 1e9) core = `${(v / 1e9).toFixed(2)}B`;
  else if (Math.abs(v) >= 1e6) core = `${(v / 1e6).toFixed(2)}M`;
  else if (Math.abs(v) >= 1e3) core = `${(v / 1e3).toFixed(2)}K`;
  else if (Math.abs(v) >= 1) core = v.toFixed(v >= 100 ? 2 : 4);
  else core = v.toPrecision(3);
  return `${prefix}${core}${suffix}`;
}

export function minswapPoolLabel(pool) {
  if (!pool) return "Minswap";
  const a =
    pool.asset_a?.metadata?.ticker ||
    (minswapAssetUnitFromMeta(pool.asset_a) === "lovelace" ? "ADA" : "?");
  const b = pool.asset_b?.metadata?.ticker || "?";
  return `${a}/${b}`;
}

export function minswapCardanoscanTokenUrl(unit) {
  const id = String(unit || "").trim();
  if (!id || id === "lovelace") return "https://cardanoscan.io/token/lovelace";
  return `https://cardanoscan.io/token/${id}`;
}

export function minswapCardanoscanPolicyUrl(policyId) {
  const id = String(policyId || "").trim();
  if (!id) return null;
  return `https://cardanoscan.io/tokenPolicy/${id}`;
}
