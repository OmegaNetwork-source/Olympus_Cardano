import React from "react";
import {
  fmtMinswapPct,
  fmtMinswapUsd,
  minswapAssetUnitFromMeta,
  minswapPoolLabel,
} from "../lib/cardano/minswapAnalytics.js";

/**
 * Left-panel token / pool stats from Minswap analytics (DexScreenerTokenStats stand-in).
 */
export default function OlympusCardanoMinswapStats({
  theme = "dark",
  t,
  loading = false,
  bundle = null,
}) {
  const glass = t?.glass || {
    border: theme === "dark" ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.1)",
    text: theme === "dark" ? "#fff" : "#111",
    textSecondary: theme === "dark" ? "rgba(255,255,255,0.65)" : "rgba(0,0,0,0.55)",
    textTertiary: theme === "dark" ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.4)",
    green: "#22c55e",
    red: "#ef4444",
  };
  const isDark = theme === "dark";

  if (loading && !bundle) {
    return (
      <div style={{ padding: 12, fontSize: 12, color: glass.textTertiary }}>Loading Minswap stats…</div>
    );
  }

  const m = bundle?.focusMetrics;
  const pool = bundle?.pool;
  const asset = m?.asset;
  const meta = asset?.metadata || {};
  const ticker = bundle?.focusTicker || meta.ticker || "Token";
  const logo = meta.logo;

  if (!m && !pool) {
    return (
      <div style={{ padding: 12, fontSize: 12, color: glass.textTertiary, lineHeight: 1.45 }}>
        Connect a Cardano pair to load Minswap analytics.
      </div>
    );
  }

  const chg = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return glass.textTertiary;
    return n >= 0 ? glass.green : glass.red;
  };

  const pending = pool?.pending_order_info;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 10, overflow: "auto", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {logo ? (
          <img src={logo} alt="" width={36} height={36} style={{ borderRadius: "50%" }} />
        ) : (
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: 11,
              color: glass.text,
            }}
          >
            {String(ticker).slice(0, 2)}
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 750, color: glass.text }}>{ticker}</div>
          <div style={{ fontSize: 11, color: glass.textTertiary }}>
            {meta.name || asset?.project_name || "Minswap"} ·{" "}
            {asset?.is_verified ? "Verified" : "Unverified"}
          </div>
        </div>
      </div>

      {m ? (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 12,
            border: `1px solid ${glass.border}`,
            background: isDark ? "rgba(0,0,0,0.2)" : "rgba(255,255,255,0.6)",
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 750, color: glass.text }}>{fmtMinswapUsd(m.price)}</div>
          <div style={{ display: "flex", gap: 10, marginTop: 6, fontSize: 11, flexWrap: "wrap" }}>
            <span style={{ color: chg(m.price_change_1h) }}>1H {fmtMinswapPct(m.price_change_1h)}</span>
            <span style={{ color: chg(m.price_change_24h) }}>24H {fmtMinswapPct(m.price_change_24h)}</span>
            <span style={{ color: chg(m.price_change_7d) }}>7D {fmtMinswapPct(m.price_change_7d)}</span>
          </div>
        </div>
      ) : null}

      <StatGrid
        glass={glass}
        rows={[
          ["Liquidity", fmtMinswapUsd(m?.liquidity)],
          ["Vol 24H", fmtMinswapUsd(m?.volume_24h)],
          ["Vol 7D", fmtMinswapUsd(m?.volume_7d)],
          ["Mcap", fmtMinswapUsd(m?.market_cap)],
          ["FDV", fmtMinswapUsd(m?.fully_diluted)],
          ["Vol 1H", fmtMinswapUsd(m?.volume_1h)],
        ]}
      />

      {pool ? (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 12,
            border: `1px solid ${glass.border}`,
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 700, color: glass.textTertiary, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Top pool · {minswapPoolLabel(pool)}
          </div>
          <div style={{ fontSize: 12, color: glass.textSecondary, marginTop: 6, lineHeight: 1.45 }}>
            {pool.type}
            <br />
            Liq {fmtMinswapUsd(pool.liquidity_currency || pool.liquidity)} · Vol 24H{" "}
            {fmtMinswapUsd(pool.volume_24h)}
            {typeof pool.trading_fee_apr === "number" ? (
              <>
                <br />
                Fee APR {pool.trading_fee_apr.toFixed(2)}%
              </>
            ) : null}
            {pending ? (
              <>
                <br />
                Pending orders {pending.total ?? "—"} (limit {pending.limit ?? "—"})
              </>
            ) : null}
          </div>
          <div style={{ fontSize: 10, color: glass.textTertiary, marginTop: 8, wordBreak: "break-all" }}>
            {minswapAssetUnitFromMeta(pool.asset_a)} / {minswapAssetUnitFromMeta(pool.asset_b)}
          </div>
        </div>
      ) : null}

      {meta.description ? (
        <div style={{ fontSize: 11, color: glass.textSecondary, lineHeight: 1.45 }}>{meta.description}</div>
      ) : null}

      <div style={{ fontSize: 10, color: glass.textTertiary }}>
        Data via Minswap analytics · not DexScreener
      </div>
    </div>
  );
}

/** Simple volume activity list from Minswap pool volume timeseries. */
export function CardanoMinswapActivityList({ theme = "dark", t, bundle = null, loading = false }) {
  const glass = t?.glass || {
    text: theme === "dark" ? "#fff" : "#111",
    textSecondary: theme === "dark" ? "rgba(255,255,255,0.65)" : "rgba(0,0,0,0.55)",
    textTertiary: theme === "dark" ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.4)",
    border: theme === "dark" ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.1)",
  };
  if (loading && !bundle) {
    return <div style={{ padding: 12, fontSize: 12, color: glass.textTertiary }}>Loading activity…</div>;
  }
  const series = Array.isArray(bundle?.volumeSeries) ? bundle.volumeSeries.slice().reverse() : [];
  if (!series.length) {
    return (
      <div style={{ padding: 12, fontSize: 12, color: glass.textTertiary, lineHeight: 1.45 }}>
        No recent Minswap pool volume for this pair.
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 8, overflow: "auto" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: glass.textTertiary, textTransform: "uppercase", letterSpacing: "0.04em", padding: "0 4px" }}>
        Pool volume · Minswap
      </div>
      {series.slice(0, 48).map((pt) => (
        <div
          key={pt.timestamp}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 8,
            padding: "8px 10px",
            borderRadius: 8,
            border: `1px solid ${glass.border}`,
            fontSize: 11,
          }}
        >
          <span style={{ color: glass.textSecondary }}>
            {pt.timestamp ? new Date(pt.timestamp).toLocaleString() : "—"}
          </span>
          <span style={{ color: glass.text, fontWeight: 700 }}>{fmtMinswapUsd(pt.value)}</span>
        </div>
      ))}
    </div>
  );
}

function StatGrid({ glass, rows }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 8,
      }}
    >
      {rows.map(([label, value]) => (
        <div
          key={label}
          style={{
            padding: "8px 10px",
            borderRadius: 10,
            border: `1px solid ${glass.border}`,
          }}
        >
          <div style={{ fontSize: 9, color: glass.textTertiary, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            {label}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: glass.text, marginTop: 2 }}>{value}</div>
        </div>
      ))}
    </div>
  );
}
