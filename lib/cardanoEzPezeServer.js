/**
 * Server-only: build Cardano Predict stake tx (pOmega → escrow) and payout sends.
 * Uses Mesh + Koios (same stack as mint). Never import from Vite browser code.
 */
import { MeshTxBuilder, MeshWallet, KoiosProvider } from "@meshsdk/core";
import {
  resolveCardanoPomegaUnit,
  resolveCardanoPomegaDecimals,
  humanToCardanoRawAmount,
  cardanoHasEzEscrowSigner,
} from "./cardanoPomegaConfig.js";

function koiosNetwork(networkId) {
  return Number(networkId) === 0 ? "preprod" : "api";
}

/**
 * Min ADA locked with the pOmega stake output (lovelace).
 * Keep tight — wallet also needs ADA for fee + change UTxO with remaining tokens.
 */
const STAKE_MIN_LOVELACE = String(
  Math.max(1_200_000, parseInt(String(process.env.CARDANO_EZ_STAKE_MIN_LOVELACE || "1500000"), 10) || 1_500_000),
);

/** Rough ADA needed in the betting wallet (stake min + change min + fee headroom). */
const STAKE_WALLET_MIN_LOVELACE = BigInt(
  Math.max(
    3_000_000,
    parseInt(String(process.env.CARDANO_EZ_STAKE_WALLET_MIN_LOVELACE || "5000000"), 10) || 5_000_000,
  ),
);

function sumLovelaceFromUtxos(utxos) {
  let total = 0n;
  for (const u of utxos || []) {
    const amt = u?.output?.amount ?? u?.amount;
    if (!Array.isArray(amt)) continue;
    for (const a of amt) {
      if (String(a?.unit || "") === "lovelace") {
        try {
          total += BigInt(String(a.quantity || "0"));
        } catch {
          /* ignore */
        }
      }
    }
  }
  return total;
}

function rewriteCardanoCoinError(err) {
  const msg = String(err?.message || err || "");
  if (/utxo fully depleted|insufficient|not enough ada|insufficient funds|value.*depleted/i.test(msg)) {
    return (
      "Not enough ADA in this Lace wallet for a token stake. " +
      "Cardano locks ~1.5 ADA with the pOmega you send, plus fee and change. " +
      "Fund the betting wallet with at least ~5 ADA, then retry."
    );
  }
  return msg;
}

/**
 * @param {{ fromAddress: string, escrowAddress: string, amountHuman: string|number, networkId?: number }} opts
 */
export async function buildCardanoEzPezeStakeTx(opts) {
  const fromAddress = String(opts?.fromAddress || "").trim();
  const escrowAddress = String(opts?.escrowAddress || "").trim();
  const networkId = Number(opts?.networkId ?? 1);
  if (!fromAddress.startsWith("addr")) throw new Error("fromAddress required");
  if (!escrowAddress.startsWith("addr")) throw new Error("escrowAddress required");
  if (fromAddress.toLowerCase() === escrowAddress.toLowerCase()) {
    throw new Error("Escrow address matches your wallet — set CARDANO_EZ_ESCROW_ADDRESS to a dedicated escrow wallet.");
  }

  const decimals = resolveCardanoPomegaDecimals();
  const raw = humanToCardanoRawAmount(opts?.amountHuman, decimals);
  if (raw < 1n) throw new Error("Stake amount must be greater than zero");

  const unit = resolveCardanoPomegaUnit();
  const provider = new KoiosProvider(koiosNetwork(networkId));
  const utxos = await provider.fetchAddressUTxOs(fromAddress);
  if (!utxos?.length) throw new Error("No UTxOs found — fund the wallet with ADA + pOmega first");

  const adaLovelace = sumLovelaceFromUtxos(utxos);
  if (adaLovelace < STAKE_WALLET_MIN_LOVELACE) {
    const have = Number(adaLovelace) / 1_000_000;
    const need = Number(STAKE_WALLET_MIN_LOVELACE) / 1_000_000;
    throw new Error(
      `Not enough ADA for Predict stakes (have ~${have.toFixed(2)} ADA, need ~${need.toFixed(0)} ADA). ` +
        "Token sends lock ADA with the assets for fees and change — add ADA to this Lace account and retry.",
    );
  }

  const txBuilder = new MeshTxBuilder({
    fetcher: provider,
    submitter: provider,
    evaluator: provider,
  });

  try {
    const unsignedTx = await txBuilder
      .txOut(escrowAddress, [
        { unit: "lovelace", quantity: STAKE_MIN_LOVELACE },
        { unit, quantity: raw.toString() },
      ])
      .changeAddress(fromAddress)
      .selectUtxosFrom(utxos)
      .complete();

    return {
      cbor: unsignedTx,
      unit,
      rawAmount: raw.toString(),
      decimals,
      minLovelace: STAKE_MIN_LOVELACE,
      walletLovelace: adaLovelace.toString(),
    };
  } catch (e) {
    throw new Error(rewriteCardanoCoinError(e));
  }
}

/**
 * Resolve Mesh key from env.
 * Prefer CARDANO_EZ_ESCROW_PRIVATE_KEY:
 *   - xprv1… (CIP-1852 root / Mesh "root")
 *   - 5820… (cardano-cli payment.skey cborHex)
 * Fallback: CARDANO_EZ_ESCROW_MNEMONIC (15/24 words)
 */
function resolveEscrowMeshKey() {
  const pk = String(process.env.CARDANO_EZ_ESCROW_PRIVATE_KEY || "").trim();
  if (pk) {
    if (/^xprv1[a-z0-9]+$/i.test(pk)) {
      return { type: "root", bech32: pk };
    }
    // cardano-cli payment signing key cborHex (Ed25519PrivateKey_ed25519)
    const hex = pk.replace(/^0x/i, "").toLowerCase();
    if (/^5820[0-9a-f]{64}$/.test(hex)) {
      return { type: "cli", payment: hex };
    }
    if (/^[0-9a-f]{64}$/.test(hex)) {
      return { type: "cli", payment: `5820${hex}` };
    }
    throw new Error(
      "CARDANO_EZ_ESCROW_PRIVATE_KEY must be an xprv1… root key, a 64-byte hex payment key, or cardano-cli cborHex (5820…)",
    );
  }

  const mnemonic = String(process.env.CARDANO_EZ_ESCROW_MNEMONIC || "").trim();
  if (!mnemonic) {
    throw new Error("Set CARDANO_EZ_ESCROW_PRIVATE_KEY (preferred) or CARDANO_EZ_ESCROW_MNEMONIC");
  }
  const words = mnemonic.split(/\s+/).filter(Boolean);
  if (words.length !== 15 && words.length !== 24) {
    throw new Error("CARDANO_EZ_ESCROW_MNEMONIC must be 15 or 24 words");
  }
  return { type: "mnemonic", words };
}

async function loadEscrowWallet(networkId = 1) {
  const provider = new KoiosProvider(koiosNetwork(networkId));
  const wallet = new MeshWallet({
    networkId: Number(networkId) === 0 ? 0 : 1,
    fetcher: provider,
    submitter: provider,
    key: resolveEscrowMeshKey(),
  });
  if (typeof wallet.init === "function") {
    await wallet.init();
  }
  return wallet;
}

/**
 * Pay raw pOmega units from escrow signing key to winner.
 * @param {{ recipientAddress: string, amountHuman: string|number, networkId?: number }} opts
 */
export async function payoutCardanoEzPezeWinner(opts) {
  if (!cardanoHasEzEscrowSigner()) {
    return { ok: false, error: "CARDANO_EZ_ESCROW_PRIVATE_KEY (or MNEMONIC) not configured" };
  }
  const recipient = String(opts?.recipientAddress || "").trim();
  if (!recipient.startsWith("addr")) {
    return { ok: false, error: "Invalid Cardano recipient" };
  }
  const networkId = Number(opts?.networkId ?? 1);
  const decimals = resolveCardanoPomegaDecimals();
  const raw = humanToCardanoRawAmount(opts?.amountHuman, decimals);
  if (raw < 1n) return { ok: false, error: "Payout would be zero" };

  try {
    const wallet = await loadEscrowWallet(networkId);
    const from = await wallet.getChangeAddress();
    const unit = resolveCardanoPomegaUnit();
    const provider = new KoiosProvider(koiosNetwork(networkId));
    const utxos = await provider.fetchAddressUTxOs(from);
    if (!utxos?.length) {
      return { ok: false, error: "Escrow wallet has no UTxOs — fund ADA + pOmega" };
    }

    const txBuilder = new MeshTxBuilder({
      fetcher: provider,
      submitter: provider,
      evaluator: provider,
    });
    const unsigned = await txBuilder
      .txOut(recipient, [
        { unit: "lovelace", quantity: STAKE_MIN_LOVELACE },
        { unit, quantity: raw.toString() },
      ])
      .changeAddress(from)
      .selectUtxosFrom(utxos)
      .complete();
    const signed = await wallet.signTx(unsigned);
    const txId = await wallet.submitTx(signed);
    if (!txId) return { ok: false, error: "Empty tx id from Cardano submit" };
    return { ok: true, txHash: String(txId) };
  } catch (e) {
    return { ok: false, error: rewriteCardanoCoinError(e) };
  }
}
