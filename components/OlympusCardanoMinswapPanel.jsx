/**
 * Minswap Aggregator swap panel for Cardano (Jupiter-equivalent).
 * Quote → build unsigned CBOR → CIP-30 / Mesh sign → submit.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  connectCardanoCip30Wallet,
  listCardanoCip30Wallets,
  shortCardanoAddress,
} from "../lib/cardano/cip30.js";
import { getCardanoNetworkMeta } from "../lib/cardano/cardanoNetwork.js";
import {
  MINSWAP_ADA_TOKEN_ID,
  MINSWAP_SEED_TOKENS,
  MINSWAP_USDM_TOKEN_ID,
  decimalToAtomicString,
  formatCardanoTokenAmount,
  humanizeMinswapErr,
  minswapAdaPriceUsd,
  minswapBuildTx,
  minswapCancelTx,
  minswapEstimate,
  minswapPendingOrders,
  minswapSearchTokens,
  minswapSignAndSubmit,
  minswapWallet,
} from "../lib/cardano/minswapAggregator.js";

function sanitizeDecimalInput(raw, maxDecimals = 12) {
  let s = String(raw).replace(/[^0-9.]/g, "");
  const firstDot = s.indexOf(".");
  if (firstDot !== -1) {
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, "");
    const [int, frac = ""] = s.split(".");
    if (frac.length > maxDecimals) s = `${int}.${frac.slice(0, maxDecimals)}`;
  }
  if (s === ".") return "";
  return s;
}

function formatWithCommas(n, maxFractionDigits = 8) {
  if (n == null || !Number.isFinite(Number(n))) return "0";
  const num = Number(n);
  const sign = num < 0 ? "-" : "";
  const abs = Math.abs(num);
  const s = abs.toFixed(maxFractionDigits).replace(/\.?0+$/, "").replace(/\.$/, "");
  const dot = s.indexOf(".");
  const intPart = dot === -1 ? s : s.slice(0, dot);
  const frac = dot === -1 ? "" : s.slice(dot + 1);
  const intNorm = intPart.replace(/^0+(?=\d)/, "") || "0";
  const intComma = intNorm.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return sign + (frac !== "" ? `${intComma}.${frac}` : intComma);
}

function normId(id) {
  return String(id || "").trim().toLowerCase();
}

function tokenRowFromAgg(t) {
  if (!t) return null;
  const tokenId = String(t.token_id || t.tokenId || "").trim();
  if (!tokenId) return null;
  const ticker = String(t.ticker || t.symbol || "?").slice(0, 18);
  return {
    tokenId,
    ticker,
    displayName: String(t.project_name || t.displayName || ticker),
    decimals: typeof t.decimals === "number" && Number.isFinite(t.decimals) ? t.decimals : 6,
    logoURI: typeof t.logo === "string" && t.logo ? t.logo : typeof t.logoURI === "string" ? t.logoURI : null,
  };
}

/**
 * @param {{
 *   theme?: string,
 *   t: object,
 *   session: object | null,
 *   onSessionChange?: (s: object | null) => void,
 *   defaultPayTokenId?: string,
 *   defaultRecvTokenId?: string,
 *   onSwapTokenInfoChange?: (info: { pay: object, recv: object } | null) => void,
 * }} props
 */
export default function OlympusCardanoMinswapPanel({
  theme = "dark",
  t,
  session,
  onSessionChange,
  defaultPayTokenId = MINSWAP_ADA_TOKEN_ID,
  defaultRecvTokenId = MINSWAP_USDM_TOKEN_ID,
  onSwapTokenInfoChange,
}) {
  const glass = t?.glass || {
    border: theme === "dark" ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.1)",
    text: theme === "dark" ? "#fff" : "#111",
    textSecondary: theme === "dark" ? "rgba(255,255,255,0.65)" : "rgba(0,0,0,0.55)",
    textTertiary: theme === "dark" ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.4)",
    green: "#22c55e",
    red: "#ef4444",
  };

  const [catalog, setCatalog] = useState(() =>
    MINSWAP_SEED_TOKENS.map((r) => ({ ...r, tokenId: r.tokenId })),
  );
  const [payId, setPayId] = useState(defaultPayTokenId);
  const [recvId, setRecvId] = useState(defaultRecvTokenId);
  const [payStr, setPayStr] = useState("");
  const [slippagePct, setSlippagePct] = useState(0.5);
  const [busy, setBusy] = useState(false);
  const [connectBusy, setConnectBusy] = useState(false);
  const [err, setErr] = useState("");
  const [successTx, setSuccessTx] = useState("");
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [balPay, setBalPay] = useState(null);
  const [balRecv, setBalRecv] = useState(null);
  const [adaUsd, setAdaUsd] = useState(null);
  const [pendingOrders, setPendingOrders] = useState([]);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [pickerSide, setPickerSide] = useState(null); // "pay" | "recv" | null
  const [pickerQ, setPickerQ] = useState("");
  const [pickerHits, setPickerHits] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const mounted = useRef(true);
  const appliedDefaults = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await minswapAdaPriceUsd();
        const price = data?.value?.price;
        if (!cancelled && mounted.current && typeof price === "number") setAdaUsd(price);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (appliedDefaults.current) return;
    appliedDefaults.current = true;
    setPayId(defaultPayTokenId || MINSWAP_ADA_TOKEN_ID);
    setRecvId(defaultRecvTokenId || MINSWAP_USDM_TOKEN_ID);
  }, [defaultPayTokenId, defaultRecvTokenId]);

  const rowById = useMemo(() => {
    const m = new Map();
    for (const r of catalog) m.set(normId(r.tokenId), r);
    return m;
  }, [catalog]);

  const payMeta = rowById.get(normId(payId)) || null;
  const recvMeta = rowById.get(normId(recvId)) || null;
  const payDecimals = payMeta?.decimals ?? 6;
  const recvDecimals = recvMeta?.decimals ?? 6;
  const payNum = parseFloat(String(payStr || "").replace(/,/g, "")) || 0;

  useEffect(() => {
    if (typeof onSwapTokenInfoChange !== "function") return;
    if (!payId || !recvId || normId(payId) === normId(recvId)) {
      onSwapTokenInfoChange(null);
      return;
    }
    onSwapTokenInfoChange({
      pay: {
        tokenId: payId,
        symbol: payMeta?.ticker || (payId === "lovelace" ? "ADA" : "?"),
        displayName: payMeta?.displayName || payMeta?.ticker || "",
        decimals: payDecimals,
        logoURI: payMeta?.logoURI || null,
      },
      recv: {
        tokenId: recvId,
        symbol: recvMeta?.ticker || (recvId === "lovelace" ? "ADA" : "?"),
        displayName: recvMeta?.displayName || recvMeta?.ticker || "",
        decimals: recvDecimals,
        logoURI: recvMeta?.logoURI || null,
      },
    });
  }, [
    onSwapTokenInfoChange,
    payId,
    recvId,
    payMeta?.ticker,
    payMeta?.displayName,
    payMeta?.logoURI,
    recvMeta?.ticker,
    recvMeta?.displayName,
    recvMeta?.logoURI,
    payDecimals,
    recvDecimals,
  ]);

  const network = useMemo(
    () => getCardanoNetworkMeta(session?.networkId ?? 1),
    [session?.networkId],
  );

  const ensureToken = useCallback((row) => {
    if (!row?.tokenId) return;
    setCatalog((prev) => {
      if (prev.some((x) => normId(x.tokenId) === normId(row.tokenId))) return prev;
      return [...prev, row];
    });
  }, []);

  const refreshWalletAndOrders = useCallback(async () => {
    if (!session?.addressBech32) {
      setBalPay(null);
      setBalRecv(null);
      setPendingOrders([]);
      return;
    }
    try {
      const [wallet, pending] = await Promise.all([
        minswapWallet({ address: session.addressBech32, amountInDecimal: true }),
        minswapPendingOrders({ ownerAddress: session.addressBech32, amountInDecimal: true }).catch(() => ({
          orders: [],
        })),
      ]);
      if (!mounted.current) return;

      const adaDec = Number(wallet?.ada);
      if (Number.isFinite(adaDec)) {
        onSessionChange?.((prev) =>
          prev
            ? {
                ...prev,
                ada: String(adaDec),
                lovelace: BigInt(Math.round(adaDec * 1_000_000)),
              }
            : null,
        );
      }

      const map = new Map();
      if (Number.isFinite(adaDec)) map.set(MINSWAP_ADA_TOKEN_ID, adaDec);
      for (const entry of wallet?.balance || []) {
        const id = String(entry?.asset?.token_id || "").toLowerCase();
        if (!id) continue;
        const amt = Number(entry.amount);
        if (Number.isFinite(amt)) map.set(id, amt);
        const row = tokenRowFromAgg(entry.asset);
        if (row) ensureToken(row);
      }
      setBalPay(map.has(normId(payId)) ? map.get(normId(payId)) : 0);
      setBalRecv(map.has(normId(recvId)) ? map.get(normId(recvId)) : 0);
      setPendingOrders(Array.isArray(pending?.orders) ? pending.orders : []);
    } catch (e) {
      console.warn("[minswap] wallet refresh", e);
      if (mounted.current) {
        setBalPay(null);
        setBalRecv(null);
      }
    }
  }, [session?.addressBech32, payId, recvId, ensureToken, onSessionChange]);

  useEffect(() => {
    void refreshWalletAndOrders();
  }, [refreshWalletAndOrders]);

  // Debounced estimate
  useEffect(() => {
    setSuccessTx("");
    if (!payId || !recvId || normId(payId) === normId(recvId) || payNum <= 0) {
      setQuote(null);
      setQuoteLoading(false);
      return undefined;
    }
    const atomic = decimalToAtomicString(payStr, payDecimals);
    if (!atomic) {
      setQuote(null);
      return undefined;
    }
    let cancelled = false;
    setQuoteLoading(true);
    const handle = window.setTimeout(() => {
      (async () => {
        try {
          const est = await minswapEstimate({
            amount: atomic,
            tokenIn: payId === "lovelace" ? "lovelace" : payId,
            tokenOut: recvId === "lovelace" ? "lovelace" : recvId,
            slippage: slippagePct,
            amountInDecimal: false,
            allowMultiHops: true,
          });
          if (cancelled || !mounted.current) return;
          // Merge token metadata from estimate response
          const tokens = est?.tokens || {};
          for (const v of Object.values(tokens)) {
            const row = tokenRowFromAgg(v);
            if (row) ensureToken(row);
          }
          setQuote(est);
          setErr("");
        } catch (e) {
          if (!cancelled && mounted.current) {
            setQuote(null);
            setErr(humanizeMinswapErr(e?.message || e));
          }
        } finally {
          if (!cancelled && mounted.current) setQuoteLoading(false);
        }
      })();
    }, 420);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [payId, recvId, payStr, payNum, payDecimals, slippagePct, ensureToken]);

  // Token search for picker
  useEffect(() => {
    if (!pickerSide) return undefined;
    let cancelled = false;
    setPickerLoading(true);
    const handle = window.setTimeout(() => {
      (async () => {
        try {
          const data = await minswapSearchTokens({ query: pickerQ, onlyVerified: true });
          if (cancelled || !mounted.current) return;
          const rows = (data?.tokens || []).map(tokenRowFromAgg).filter(Boolean);
          setPickerHits(rows);
        } catch {
          if (!cancelled && mounted.current) setPickerHits([]);
        } finally {
          if (!cancelled && mounted.current) setPickerLoading(false);
        }
      })();
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [pickerSide, pickerQ]);

  const onConnect = async () => {
    setConnectBusy(true);
    setErr("");
    try {
      const wallets = listCardanoCip30Wallets();
      const prefer =
        wallets.find((w) => w.key === "lace") ||
        wallets.find((w) => w.key === "eternl") ||
        wallets[0];
      if (!prefer) throw new Error("Install Lace or Eternl, then refresh.");
      const next = await connectCardanoCip30Wallet(prefer.key);
      if (!mounted.current) return;
      onSessionChange?.(next);
    } catch (e) {
      if (mounted.current) setErr(humanizeMinswapErr(e?.message || e));
    } finally {
      if (mounted.current) setConnectBusy(false);
    }
  };

  const flip = () => {
    setPayId(recvId);
    setRecvId(payId);
    if (quote?.amount_out) {
      setPayStr(formatCardanoTokenAmount(quote.amount_out, recvDecimals));
    } else {
      setPayStr("");
    }
  };

  const pickToken = (row) => {
    if (!row?.tokenId || !pickerSide) return;
    ensureToken(row);
    if (pickerSide === "pay") {
      setPayId(row.tokenId);
      if (normId(row.tokenId) === normId(recvId)) setRecvId(payId);
    } else {
      setRecvId(row.tokenId);
      if (normId(row.tokenId) === normId(payId)) setPayId(recvId);
    }
    setPickerSide(null);
    setPickerQ("");
  };

  const runSwap = async () => {
    setErr("");
    setSuccessTx("");
    if (!session?.walletKey || !session?.addressBech32) {
      setErr("Connect Lace / Eternl first.");
      return;
    }
    if (Number(session.networkId) !== 1) {
      setErr("Minswap aggregator is mainnet-only. Switch Lace to Cardano mainnet.");
      return;
    }
    const atomic = decimalToAtomicString(payStr, payDecimals);
    if (!atomic) {
      setErr("Enter a valid amount.");
      return;
    }
    setBusy(true);
    try {
      const tokenIn = payId === "lovelace" ? "lovelace" : payId;
      const tokenOut = recvId === "lovelace" ? "lovelace" : recvId;
      const est =
        quote &&
        String(quote.token_in) === tokenIn &&
        String(quote.token_out) === tokenOut &&
        String(quote.amount_in) === atomic
          ? quote
          : await minswapEstimate({
              amount: atomic,
              tokenIn,
              tokenOut,
              slippage: slippagePct,
              amountInDecimal: false,
              allowMultiHops: true,
            });
      const built = await minswapBuildTx({
        sender: session.addressBech32,
        minAmountOut: String(est.min_amount_out),
        amount: atomic,
        tokenIn,
        tokenOut,
        slippage: slippagePct,
        amountInDecimal: false,
        allowMultiHops: true,
      });
      const cbor = built?.cbor;
      if (!cbor) throw new Error("Minswap did not return a transaction");
      const { txId } = await minswapSignAndSubmit({
        walletKey: session.walletKey,
        api: session.api,
        unsignedCbor: cbor,
      });
      if (!mounted.current) return;
      setSuccessTx(txId);
      setPayStr("");
      setQuote(null);
      window.setTimeout(() => {
        if (mounted.current) void refreshWalletAndOrders();
      }, 8000);
    } catch (e) {
      if (mounted.current) setErr(humanizeMinswapErr(e?.message || e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const cancelOrder = async (order) => {
    if (!session?.walletKey || !session?.addressBech32 || !order?.tx_in || !order?.protocol) return;
    setCancelBusy(true);
    setErr("");
    try {
      const built = await minswapCancelTx({
        sender: session.addressBech32,
        orders: [{ tx_in: order.tx_in, protocol: order.protocol }],
      });
      const cbor = built?.cbor;
      if (!cbor) throw new Error("Minswap did not return a cancel transaction");
      const { txId } = await minswapSignAndSubmit({
        walletKey: session.walletKey,
        api: session.api,
        unsignedCbor: cbor,
      });
      if (!mounted.current) return;
      setSuccessTx(txId);
      window.setTimeout(() => {
        if (mounted.current) void refreshWalletAndOrders();
      }, 6000);
    } catch (e) {
      if (mounted.current) setErr(humanizeMinswapErr(e?.message || e));
    } finally {
      if (mounted.current) setCancelBusy(false);
    }
  };

  const outPretty = useMemo(() => {
    if (payNum <= 0) return "0";
    if (quoteLoading) return "…";
    if (!quote?.amount_out) return "—";
    return formatWithCommas(
      Number(formatCardanoTokenAmount(quote.amount_out, recvDecimals)),
      Math.min(recvDecimals, 8),
    );
  }, [payNum, quoteLoading, quote, recvDecimals]);

  const impact =
    typeof quote?.avg_price_impact === "number" && Number.isFinite(quote.avg_price_impact)
      ? quote.avg_price_impact
      : null;

  const explorerTx = successTx
    ? network.explorerTx?.(successTx) || `https://cardanoscan.io/transaction/${successTx}`
    : null;

  const seedAndHits = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const r of [...catalog, ...pickerHits]) {
      const id = normId(r.tokenId);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(r);
    }
    const q = pickerQ.trim().toLowerCase();
    if (!q) return out;
    return out.filter(
      (r) =>
        r.ticker?.toLowerCase().includes(q) ||
        r.displayName?.toLowerCase().includes(q) ||
        r.tokenId?.toLowerCase().includes(q),
    );
  }, [catalog, pickerHits, pickerQ]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: glass.text }}>Minswap</div>
          <div style={{ fontSize: 11, color: glass.textTertiary, marginTop: 2 }}>
            Cardano aggregator · routes across Minswap + other DEXes
            {adaUsd != null ? ` · ADA $${adaUsd.toFixed(3)}` : ""}
          </div>
        </div>
        {!session?.addressBech32 ? (
          <button
            type="button"
            disabled={connectBusy}
            onClick={onConnect}
            style={primaryBtn(glass, theme)}
          >
            {connectBusy ? "Connecting…" : "Connect Lace"}
          </button>
        ) : (
          <div style={{ fontSize: 11, color: glass.textSecondary, textAlign: "right" }}>
            {shortCardanoAddress(session.addressBech32)}
            <div style={{ color: glass.textTertiary }}>{session.ada} ADA</div>
          </div>
        )}
      </div>

      {/* Pay */}
      <SwapBox
        glass={glass}
        theme={theme}
        label="You pay"
        balance={balPay}
        meta={payMeta}
        amount={payStr}
        onAmountChange={(v) => setPayStr(sanitizeDecimalInput(v, payDecimals))}
        onPickToken={() => {
          setPickerSide("pay");
          setPickerQ("");
        }}
        onMax={() => {
          if (balPay != null && balPay > 0) setPayStr(String(balPay));
        }}
      />

      <button
        type="button"
        onClick={flip}
        style={{
          alignSelf: "center",
          width: 36,
          height: 36,
          borderRadius: 10,
          border: `1px solid ${glass.border}`,
          background: theme === "dark" ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
          color: glass.text,
          cursor: "pointer",
          fontSize: 16,
          fontWeight: 700,
        }}
        aria-label="Flip tokens"
      >
        ↕
      </button>

      {/* Receive */}
      <SwapBox
        glass={glass}
        theme={theme}
        label="You receive"
        balance={balRecv}
        meta={recvMeta}
        amount={outPretty}
        readOnly
        onPickToken={() => {
          setPickerSide("recv");
          setPickerQ("");
        }}
      />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: 11, color: glass.textTertiary }}>
          Slippage{" "}
          <select
            value={slippagePct}
            onChange={(e) => setSlippagePct(Number(e.target.value))}
            style={{
              marginLeft: 4,
              borderRadius: 6,
              border: `1px solid ${glass.border}`,
              background: "transparent",
              color: glass.text,
              fontSize: 11,
              padding: "2px 6px",
            }}
          >
            {[0.1, 0.5, 1, 2, 5].map((p) => (
              <option key={p} value={p}>
                {p}%
              </option>
            ))}
          </select>
        </div>
        {impact != null ? (
          <div style={{ fontSize: 11, color: impact > 5 ? glass.red : glass.textTertiary }}>
            Impact {impact.toFixed(2)}%
          </div>
        ) : null}
      </div>

      {quote?.min_amount_out ? (
        <div style={{ fontSize: 11, color: glass.textTertiary }}>
          Min received {formatWithCommas(Number(formatCardanoTokenAmount(quote.min_amount_out, recvDecimals)), 8)}{" "}
          {recvMeta?.ticker || ""}
        </div>
      ) : null}

      <button
        type="button"
        disabled={busy || !session?.addressBech32 || payNum <= 0 || quoteLoading || !quote}
        onClick={runSwap}
        style={{
          ...primaryBtn(glass, theme),
          width: "100%",
          padding: "12px 14px",
          fontSize: 13,
          opacity: busy || !session?.addressBech32 || payNum <= 0 || !quote ? 0.55 : 1,
          cursor: busy || !session?.addressBech32 || payNum <= 0 || !quote ? "not-allowed" : "pointer",
        }}
      >
        {!session?.addressBech32
          ? "Connect wallet to swap"
          : busy
            ? "Confirm in wallet…"
            : quoteLoading
              ? "Fetching route…"
              : `Swap via Minswap`}
      </button>

      {successTx ? (
        <div style={{ fontSize: 12, color: glass.green, lineHeight: 1.4 }}>
          Tx submitted.{" "}
          {explorerTx ? (
            <a href={explorerTx} target="_blank" rel="noreferrer" style={{ color: "#6ea8ff" }}>
              View on explorer
            </a>
          ) : (
            successTx.slice(0, 16) + "…"
          )}
        </div>
      ) : null}
      {err ? <div style={{ fontSize: 12, color: glass.red, lineHeight: 1.4 }}>{err}</div> : null}

      {pendingOrders.length > 0 ? (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 12,
            border: `1px solid ${glass.border}`,
            background: theme === "dark" ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.02)",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: glass.text, marginBottom: 8 }}>
            Pending orders ({pendingOrders.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pendingOrders.slice(0, 6).map((o) => {
              const tin = o.token_in?.ticker || o.token_in?.token_id?.slice(0, 8) || "?";
              const tout = o.token_out?.ticker || o.token_out?.token_id?.slice(0, 8) || "?";
              return (
                <div
                  key={o.tx_in}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    fontSize: 11,
                    color: glass.textSecondary,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: glass.text, fontWeight: 650 }}>
                      {o.amount_in} {tin} → {tout}
                    </div>
                    <div style={{ color: glass.textTertiary }}>
                      {o.protocol} · min {o.min_amount_out}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={cancelBusy}
                    onClick={() => cancelOrder(o)}
                    style={{ ...chipBtn(glass), color: glass.red, flexShrink: 0 }}
                  >
                    Cancel
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {pickerSide ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={() => setPickerSide(null)}
        >
          <div
            style={{
              width: "min(420px, 100%)",
              maxHeight: "70vh",
              overflow: "auto",
              borderRadius: 16,
              border: `1px solid ${glass.border}`,
              background: theme === "dark" ? "#12151c" : "#fff",
              padding: 14,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ fontWeight: 700, color: glass.text }}>Select token</div>
              <button type="button" onClick={() => setPickerSide(null)} style={chipBtn(glass)}>
                Close
              </button>
            </div>
            <input
              value={pickerQ}
              onChange={(e) => setPickerQ(e.target.value)}
              placeholder="Search ticker or policy…"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "10px 12px",
                borderRadius: 10,
                border: `1px solid ${glass.border}`,
                background: "transparent",
                color: glass.text,
                fontSize: 13,
                marginBottom: 10,
              }}
            />
            {pickerLoading ? (
              <div style={{ fontSize: 12, color: glass.textTertiary }}>Searching Minswap…</div>
            ) : null}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {seedAndHits.map((r) => (
                <button
                  key={r.tokenId}
                  type="button"
                  onClick={() => pickToken(r)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 8px",
                    borderRadius: 10,
                    border: "none",
                    background: "transparent",
                    color: glass.text,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  {r.logoURI ? (
                    <img src={r.logoURI} alt="" width={28} height={28} style={{ borderRadius: "50%" }} />
                  ) : (
                    <span
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        background: theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      {(r.ticker || "?").slice(0, 2)}
                    </span>
                  )}
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{r.ticker}</div>
                    <div
                      style={{
                        fontSize: 10,
                        color: glass.textTertiary,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.displayName}
                    </div>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SwapBox({
  glass,
  theme,
  label,
  balance,
  meta,
  amount,
  onAmountChange,
  onPickToken,
  onMax,
  readOnly,
}) {
  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 14,
        border: `1px solid ${glass.border}`,
        background: theme === "dark" ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: glass.textTertiary }}>{label}</span>
        <span style={{ fontSize: 11, color: glass.textTertiary }}>
          {balance != null && Number.isFinite(balance) ? `Bal ${formatWithCommas(balance, 6)}` : ""}
          {onMax ? (
            <button
              type="button"
              onClick={onMax}
              style={{
                marginLeft: 8,
                border: "none",
                background: "transparent",
                color: "#6ea8ff",
                fontSize: 11,
                cursor: "pointer",
                padding: 0,
              }}
            >
              Max
            </button>
          ) : null}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {readOnly ? (
          <div style={{ flex: 1, fontSize: 22, fontWeight: 700, color: glass.text, minWidth: 0 }}>{amount}</div>
        ) : (
          <input
            value={amount}
            onChange={(e) => onAmountChange?.(e.target.value)}
            placeholder="0"
            inputMode="decimal"
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              color: glass.text,
              fontSize: 22,
              fontWeight: 700,
            }}
          />
        )}
        <button
          type="button"
          onClick={onPickToken}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
            borderRadius: 999,
            border: `1px solid ${glass.border}`,
            background: theme === "dark" ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.8)",
            color: glass.text,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          {meta?.logoURI ? (
            <img src={meta.logoURI} alt="" width={22} height={22} style={{ borderRadius: "50%" }} />
          ) : null}
          <span style={{ fontWeight: 700, fontSize: 13 }}>{meta?.ticker || "Token"}</span>
          <span style={{ fontSize: 10, color: glass.textTertiary }}>▼</span>
        </button>
      </div>
    </div>
  );
}

function primaryBtn(glass, theme) {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    border: `1px solid ${glass.border}`,
    background: theme === "dark" ? "rgba(110,168,255,0.16)" : "rgba(37,99,235,0.1)",
    color: glass.text,
    fontSize: 12,
    fontWeight: 700,
    padding: "8px 12px",
    cursor: "pointer",
  };
}

function chipBtn(glass) {
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "6px 10px",
    borderRadius: 8,
    border: `1px solid ${glass.border}`,
    background: "transparent",
    color: glass.text,
    fontSize: 11,
    fontWeight: 650,
    cursor: "pointer",
  };
}
