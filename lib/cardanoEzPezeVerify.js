/**
 * Verify Cardano Predict stake: pOmega native asset to escrow (Koios tx_utxos).
 */
import {
  resolveCardanoPomegaPolicyId,
  resolveCardanoPomegaUnit,
  resolveCardanoPomegaDecimals,
  humanToCardanoRawAmount,
} from "./cardanoPomegaConfig.js";

function koiosBase(networkId) {
  return Number(networkId) === 0
    ? "https://preprod.koios.rest/api/v1"
    : "https://api.koios.rest/api/v1";
}

function normalizeTxHash(h) {
  return String(h || "")
    .trim()
    .toLowerCase()
    .replace(/^0x/, "");
}

/**
 * @param {object} p
 * @param {string} p.txHash
 * @param {string} p.userAddress
 * @param {string} p.escrowAddress
 * @param {string|number} p.amountHuman
 * @param {number} [p.decimals]
 * @param {number} [p.networkId]
 * @param {Set<string>} [p.usedTxHashes]
 */
export async function verifyCardanoEzPezeStake(p) {
  const txHash = normalizeTxHash(p.txHash);
  if (!/^[0-9a-f]{64}$/.test(txHash)) {
    return { ok: false, error: "Invalid Cardano transaction hash" };
  }
  const used = p.usedTxHashes;
  if (used instanceof Set && used.has(txHash)) {
    return { ok: false, error: "This stake transaction was already used for a bet." };
  }

  const user = String(p.userAddress || "").trim().toLowerCase();
  const escrow = String(p.escrowAddress || "").trim().toLowerCase();
  if (!user.startsWith("addr") || !escrow.startsWith("addr")) {
    return { ok: false, error: "Invalid Cardano addresses" };
  }

  const decimals = p.decimals != null ? Number(p.decimals) : resolveCardanoPomegaDecimals();
  const expected = humanToCardanoRawAmount(p.amountHuman, decimals);
  if (expected < 1n) return { ok: false, error: "Invalid stake amount" };

  const policyId = resolveCardanoPomegaPolicyId();
  const unit = resolveCardanoPomegaUnit();
  const assetNameHex = unit.slice(policyId.length);

  const base = koiosBase(p.networkId ?? 1);

  async function fetchTxUtxos() {
    const r = await fetch(`${base}/tx_utxos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ _tx_hashes: [txHash] }),
    });
    const rows = await r.json().catch(() => null);
    if (!r.ok) {
      return { error: `Koios tx lookup failed (${r.status})`, pending: true, rows: null };
    }
    const row = Array.isArray(rows) ? rows.find((x) => normalizeTxHash(x?.tx_hash) === txHash) : null;
    return { row, rows, pending: !row };
  }

  let looked;
  try {
    looked = await fetchTxUtxos();
  } catch (e) {
    return { ok: false, error: e?.message || "Koios request failed", pending: true };
  }
  // Brief server-side wait — Cardano submit often races Koios indexing.
  if (looked.pending && !looked.error) {
    await new Promise((r) => setTimeout(r, 2500));
    try {
      looked = await fetchTxUtxos();
    } catch (e) {
      return { ok: false, error: e?.message || "Koios request failed", pending: true };
    }
  }
  if (looked.error) {
    return { ok: false, error: looked.error, pending: true };
  }
  const row = looked.row;
  if (!row) {
    return { ok: false, error: "Transaction not found yet — wait a few seconds and retry.", pending: true };
  }

  const inputs = Array.isArray(row.inputs) ? row.inputs : [];
  const outputs = Array.isArray(row.outputs) ? row.outputs : [];
  const userSpent = inputs.some((i) => String(i?.payment_addr?.bech32 || "").toLowerCase() === user);
  if (!userSpent) {
    return { ok: false, error: "Stake tx must be signed/spent from your connected Lace wallet." };
  }

  let received = 0n;
  for (const o of outputs) {
    const dest = String(o?.payment_addr?.bech32 || "").toLowerCase();
    if (dest !== escrow) continue;
    for (const a of o?.asset_list || []) {
      const pid = String(a?.policy_id || "").toLowerCase();
      const name = String(a?.asset_name || "").toLowerCase();
      if (pid === policyId && name === assetNameHex) {
        try {
          received += BigInt(String(a?.quantity || "0"));
        } catch {
          /* ignore */
        }
      }
    }
  }

  if (received < expected) {
    return {
      ok: false,
      error: `Escrow received ${received.toString()} pOmega base units; expected at least ${expected.toString()}.`,
    };
  }

  return { ok: true, rawAmount: received, txHash };
}
