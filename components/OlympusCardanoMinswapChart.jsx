import React, { useEffect, useMemo, useRef, useState } from "react";
import { fmtMinswapUsd, minswapPoolLabel } from "../lib/cardano/minswapAnalytics.js";

const INTERVALS = [
  { key: "15m", label: "15m" },
  { key: "1h", label: "1H" },
  { key: "4h", label: "4H" },
  { key: "1d", label: "1D" },
];

/**
 * Minswap OHLCV chart for Cardano (DexScreener chart stand-in).
 */
export default function OlympusCardanoMinswapChart({
  theme = "dark",
  loading = false,
  candles = [],
  pool = null,
  focusTicker = "",
  candleSource = "none",
  interval = "1h",
  onIntervalChange,
  emptyMessage = "No Minswap chart for this pair yet.",
}) {
  const isDark = theme === "dark";
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [hover, setHover] = useState(null);

  const rows = useMemo(() => {
    const list = Array.isArray(candles) ? candles.slice() : [];
    list.sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
    return list.filter(
      (c) =>
        Number.isFinite(Number(c.open)) &&
        Number.isFinite(Number(c.high)) &&
        Number.isFinite(Number(c.low)) &&
        Number.isFinite(Number(c.close)),
    );
  }, [candles]);

  const last = rows.length ? rows[rows.length - 1] : null;
  const first = rows.length ? rows[0] : null;
  const changePct =
    last && first && Number(first.open) > 0
      ? ((Number(last.close) - Number(first.open)) / Number(first.open)) * 100
      : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !rows.length) return undefined;

    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(120, wrap.clientWidth);
      const h = Math.max(180, wrap.clientHeight);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const padL = 8;
      const padR = 56;
      const padT = 12;
      const padB = 28;
      const plotW = w - padL - padR;
      const plotH = h - padT - padB;
      if (plotW < 40 || plotH < 40) return;

      let min = Infinity;
      let max = -Infinity;
      let maxVol = 0;
      for (const c of rows) {
        min = Math.min(min, Number(c.low));
        max = Math.max(max, Number(c.high));
        maxVol = Math.max(maxVol, Number(c.volume) || 0);
      }
      if (!(max > min)) {
        min *= 0.99;
        max *= 1.01;
      }
      const span = max - min || 1;
      const n = rows.length;
      const slot = plotW / n;
      const bodyW = Math.max(1.5, Math.min(10, slot * 0.62));

      // grid
      ctx.strokeStyle = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = padT + (plotH * i) / 4;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + plotW, y);
        ctx.stroke();
        const price = max - (span * i) / 4;
        ctx.fillStyle = isDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.4)";
        ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(fmtPrice(price), padL + plotW + 6, y + 3);
      }

      const volH = plotH * 0.18;
      for (let i = 0; i < n; i++) {
        const c = rows[i];
        const x = padL + slot * i + slot / 2;
        const o = Number(c.open);
        const cl = Number(c.close);
        const hi = Number(c.high);
        const lo = Number(c.low);
        const up = cl >= o;
        const color = up ? (isDark ? "#4ade80" : "#16a34a") : isDark ? "#f87171" : "#dc2626";
        const yHi = padT + ((max - hi) / span) * plotH;
        const yLo = padT + ((max - lo) / span) * plotH;
        const yO = padT + ((max - o) / span) * plotH;
        const yC = padT + ((max - cl) / span) * plotH;

        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(x, yHi);
        ctx.lineTo(x, yLo);
        ctx.stroke();

        const top = Math.min(yO, yC);
        const bh = Math.max(1, Math.abs(yC - yO));
        ctx.fillStyle = color;
        ctx.fillRect(x - bodyW / 2, top, bodyW, bh);

        if (maxVol > 0 && Number(c.volume) > 0) {
          const vh = (Number(c.volume) / maxVol) * volH;
          ctx.fillStyle = up
            ? isDark
              ? "rgba(74,222,128,0.22)"
              : "rgba(22,163,74,0.2)"
            : isDark
              ? "rgba(248,113,113,0.22)"
              : "rgba(220,38,38,0.2)";
          ctx.fillRect(x - bodyW / 2, padT + plotH - vh, bodyW, vh);
        }
      }

      if (hover != null && hover >= 0 && hover < n) {
        const c = rows[hover];
        const x = padL + slot * hover + slot / 2;
        ctx.strokeStyle = isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.2)";
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + plotH);
        ctx.stroke();
        ctx.setLineDash([]);
        const yC = padT + ((max - Number(c.close)) / span) * plotH;
        ctx.beginPath();
        ctx.arc(x, yC, 3, 0, Math.PI * 2);
        ctx.fillStyle = isDark ? "#fff" : "#111";
        ctx.fill();
      }
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [rows, isDark, hover]);

  const onMove = (e) => {
    if (!rows.length || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const padL = 8;
    const padR = 56;
    const plotW = rect.width - padL - padR;
    const idx = Math.floor(((x - padL) / plotW) * rows.length);
    if (idx >= 0 && idx < rows.length) setHover(idx);
    else setHover(null);
  };

  if (loading) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.45)",
          fontSize: 12,
        }}
      >
        Loading Minswap chart…
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div
        style={{
          height: "100%",
          minHeight: 260,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          textAlign: "center",
          color: isDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.5)",
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        {emptyMessage}
      </div>
    );
  }

  const tip = hover != null ? rows[hover] : last;
  const label = minswapPoolLabel(pool);
  const sourceNote = candleSource === "pool" ? "Pool" : candleSource === "asset" ? "Asset" : "";

  return (
    <div style={{ position: "relative", height: "100%", width: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "8px 10px 4px",
          flexShrink: 0,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 750, color: isDark ? "#fff" : "#111" }}>
              {focusTicker || label}
            </span>
            <span style={{ fontSize: 11, color: isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)" }}>
              Minswap {sourceNote} · {label}
            </span>
          </div>
          {tip ? (
            <div style={{ fontSize: 11, color: isDark ? "rgba(255,255,255,0.65)" : "rgba(0,0,0,0.55)", marginTop: 2 }}>
              O {fmtPrice(tip.open)} · H {fmtPrice(tip.high)} · L {fmtPrice(tip.low)} · C {fmtPrice(tip.close)}
              {Number.isFinite(Number(tip.volume)) ? ` · Vol ${fmtMinswapUsd(tip.volume)}` : ""}
              {changePct != null && hover == null ? (
                <span style={{ marginLeft: 8, color: changePct >= 0 ? "#22c55e" : "#ef4444" }}>
                  {changePct >= 0 ? "+" : ""}
                  {changePct.toFixed(2)}%
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          {INTERVALS.map((iv) => (
            <button
              key={iv.key}
              type="button"
              onClick={() => onIntervalChange?.(iv.key)}
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)"}`,
                background: interval === iv.key ? (isDark ? "rgba(110,168,255,0.2)" : "rgba(37,99,235,0.1)") : "transparent",
                color: isDark ? "#fff" : "#111",
                fontSize: 10,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {iv.label}
            </button>
          ))}
        </div>
      </div>
      <div ref={wrapRef} style={{ flex: 1, minHeight: 0, position: "relative" }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      </div>
    </div>
  );
}

function fmtPrice(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  if (v >= 1000) return v.toFixed(2);
  if (v >= 1) return v.toFixed(4);
  if (v >= 0.01) return v.toFixed(6);
  return v.toPrecision(4);
}
