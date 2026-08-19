/**
 * Server-only Cardano mint helpers.
 * Mesh builds the unsigned tx (Node has crypto); Emurgo CSL attaches CIP-30 witnesses.
 * Never import this module from browser/Vite code.
 */
import {
  MeshTxBuilder,
  ForgeScript,
  resolveScriptHash,
  stringToHex,
  KoiosProvider,
} from "@meshsdk/core";
import * as CSL from "@emurgo/cardano-serialization-lib-nodejs";

const POMEGA = {
  assetName: "pOmega",
  ticker: "pOmega",
  decimals: 6,
  mintUnits: "100000000000000000",
  description: "Olympus pOmega on Cardano — Catalyst pilot",
};
const MUSDC = {
  assetName: "mUSDC",
  ticker: "mUSDC",
  decimals: 6,
  mintUnits: "10000000000000",
  description: "Olympus mirrored USDC on Cardano — Catalyst pilot",
};

/** Mesh KoiosProvider expects a network token, not a full URL. */
function koiosNetwork(networkId) {
  return Number(networkId) === 0 ? "preprod" : "api";
}

function hexToBuf(hex) {
  return Buffer.from(String(hex || "").replace(/^0x/i, ""), "hex");
}

/**
 * @param {{ address: string, networkId: number, utxos?: any[] }} opts
 */
export async function buildOlympusCardanoMintTx(opts) {
  const address = String(opts?.address || "").trim();
  const networkId = Number(opts?.networkId);
  if (!address) throw new Error("address required");

  const provider = new KoiosProvider(koiosNetwork(networkId));
  let utxos = Array.isArray(opts?.utxos) ? opts.utxos : [];
  // Prefer fetcher UTxOs (Mesh format). Client CIP-30 hex UTxOs are not Mesh-shaped.
  if (!utxos.length || typeof utxos[0] === "string") {
    try {
      utxos = await provider.fetchAddressUTxOs(address);
    } catch (e) {
      console.warn("[cardanoMintServer] fetchAddressUTxOs failed", e?.message || e);
      utxos = [];
    }
  }
  if (!utxos?.length) {
    throw new Error("No UTxOs found for address — fund the wallet with ADA first");
  }

  const forgingScript = ForgeScript.withOneSignature(address);
  const policyId = resolveScriptHash(forgingScript);
  const pOmegaHex = stringToHex(POMEGA.assetName);
  const mUsdcHex = stringToHex(MUSDC.assetName);

  const metadata = {
    [policyId]: {
      [POMEGA.assetName]: {
        name: POMEGA.assetName,
        ticker: POMEGA.ticker,
        description: POMEGA.description,
        decimals: POMEGA.decimals,
      },
      [MUSDC.assetName]: {
        name: MUSDC.assetName,
        ticker: MUSDC.ticker,
        description: MUSDC.description,
        decimals: MUSDC.decimals,
      },
    },
  };

  const txBuilder = new MeshTxBuilder({
    fetcher: provider,
    submitter: provider,
    evaluator: provider,
  });

  const unsignedTx = await txBuilder
    .mint(POMEGA.mintUnits, policyId, pOmegaHex)
    .mintingScript(forgingScript)
    .mint(MUSDC.mintUnits, policyId, mUsdcHex)
    .mintingScript(forgingScript)
    .metadataValue(721, metadata)
    .changeAddress(address)
    .selectUtxosFrom(utxos)
    .complete();

  return {
    cbor: unsignedTx,
    policyId,
    pOmegaUnits: POMEGA.mintUnits,
    mUsdcUnits: MUSDC.mintUnits,
  };
}

/**
 * Merge CIP-30 wallet witnesses into the unsigned tx witness set.
 * Mesh mint txs already include native_scripts (policy); replacing the whole
 * witness set drops them and Cardano rejects the submit.
 */
export function attachWitnessSetToTx(txCborHex, witnessSetHex) {
  const tx = CSL.Transaction.from_bytes(hexToBuf(txCborHex));
  const walletWs = CSL.TransactionWitnessSet.from_bytes(hexToBuf(witnessSetHex));
  const baseWs = tx.witness_set();
  const merged = CSL.TransactionWitnessSet.new();

  const vkeys = CSL.Vkeywitnesses.new();
  const seenVkey = new Set();
  const pushVkeys = (ws) => {
    const list = ws?.vkeys?.();
    if (!list) return;
    for (let i = 0; i < list.len(); i++) {
      const vk = list.get(i);
      const key = Buffer.from(vk.to_bytes()).toString("hex");
      if (seenVkey.has(key)) continue;
      seenVkey.add(key);
      vkeys.add(vk);
    }
  };
  pushVkeys(baseWs);
  pushVkeys(walletWs);
  if (vkeys.len() > 0) merged.set_vkeys(vkeys);

  const nativeScripts = CSL.NativeScripts.new();
  const seenScript = new Set();
  const pushNative = (ws) => {
    const list = ws?.native_scripts?.();
    if (!list) return;
    for (let i = 0; i < list.len(); i++) {
      const ns = list.get(i);
      const key = Buffer.from(ns.to_bytes()).toString("hex");
      if (seenScript.has(key)) continue;
      seenScript.add(key);
      nativeScripts.add(ns);
    }
  };
  pushNative(baseWs);
  pushNative(walletWs);
  if (nativeScripts.len() > 0) merged.set_native_scripts(nativeScripts);

  // Preserve any other witness fields Mesh may have attached.
  const boot = baseWs.bootstraps?.() || walletWs.bootstraps?.();
  if (boot && boot.len() > 0) merged.set_bootstraps(boot);
  const plutus = baseWs.plutus_scripts?.() || walletWs.plutus_scripts?.();
  if (plutus && plutus.len() > 0) merged.set_plutus_scripts(plutus);
  const pdata = baseWs.plutus_data?.() || walletWs.plutus_data?.();
  if (pdata && pdata.len() > 0) merged.set_plutus_data(pdata);
  const redeemers = baseWs.redeemers?.() || walletWs.redeemers?.();
  if (redeemers) merged.set_redeemers(redeemers);

  const signed = CSL.Transaction.new(tx.body(), merged, tx.auxiliary_data());
  return Buffer.from(signed.to_bytes()).toString("hex");
}

/**
 * @param {{ cbor: string, witnessSet: string, networkId?: number }} opts
 */
export async function submitWitnessedCardanoTx(opts) {
  const unsigned = String(opts?.cbor || "").replace(/^0x/i, "");
  const witness = String(opts?.witnessSet || "").replace(/^0x/i, "");
  const networkId = Number(opts?.networkId ?? 1);
  if (!unsigned || !witness) throw new Error("cbor and witness_set required");

  const signedCbor = attachWitnessSetToTx(unsigned, witness);
  const provider = new KoiosProvider(koiosNetwork(networkId));
  try {
    const txId = await provider.submitTx(signedCbor);
    if (!txId) throw new Error("Submit returned empty tx id");
    return { tx_id: String(txId) };
  } catch (e) {
    const msg = String(e?.message || e || "Submit failed");
    // Surface useful Cardano node / Koios rejection text
    throw new Error(msg.length > 400 ? `${msg.slice(0, 400)}…` : msg);
  }
}
