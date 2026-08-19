/**
 * Mint Olympus pOmega + mUSDC as Cardano native assets via CIP-30 (Lace/Eternl) + Mesh.
 * One signature policy from the connected payment key; full supply minted in a single tx.
 */
import {
  CARDANO_OLYMPUS_TOKENS,
  CARDANO_MINT_MIN_ADA_HINT,
  saveCardanoDeployRecord,
  formatCardanoAssetAmount,
  cardanoAssetUnit,
} from "./olympusCardanoAssets.js";
import { lovelaceToAda } from "./cip30.js";

function koiosBaseUrl(networkId) {
  return Number(networkId) === 0
    ? "https://preprod.koios.rest/api/v1"
    : "https://api.koios.rest/api/v1";
}

async function loadMesh() {
  return import("@meshsdk/core");
}

/**
 * @param {number} networkId CIP-30 network id (0 testnet/preprod, 1 mainnet)
 */
export async function createCardanoKoiosProvider(networkId) {
  const { KoiosProvider } = await loadMesh();
  return new KoiosProvider(koiosBaseUrl(networkId));
}

/**
 * Enable Mesh BrowserWallet for an already-known CIP-30 key (e.g. "lace").
 * @param {string} walletKey
 */
export async function enableMeshCardanoWallet(walletKey) {
  const { BrowserWallet } = await loadMesh();
  if (!walletKey) throw new Error("No Cardano wallet selected");
  return BrowserWallet.enable(walletKey);
}

/**
 * Read pOmega / mUSDC balances for a policy from the connected wallet.
 * @returns {Promise<{
 *   ada: string,
 *   lovelace: bigint,
 *   assets: { key: string, ticker: string, units: string, display: string, unit: string }[],
 *   rawAssets: { unit: string, quantity: string }[],
 * }>}
 */
export async function readOlympusCardanoBalances(walletKey, policyId) {
  const wallet = await enableMeshCardanoWallet(walletKey);
  const balance = await wallet.getBalance();
  const lovelaceEntry = (balance || []).find((a) => a.unit === "lovelace");
  const lovelace = BigInt(lovelaceEntry?.quantity || "0");
  const rawAssets = (balance || []).filter((a) => a.unit !== "lovelace");

  const pid = String(policyId || "").toLowerCase();
  const { stringToHex } = await loadMesh();
  const assets = [];

  for (const tok of Object.values(CARDANO_OLYMPUS_TOKENS)) {
    const nameHex = stringToHex(tok.assetName);
    const unit = cardanoAssetUnit(pid, nameHex);
    const hit = rawAssets.find((a) => String(a.unit || "").toLowerCase() === unit);
    const units = hit?.quantity || "0";
    assets.push({
      key: tok.key,
      ticker: tok.ticker,
      units,
      display: formatCardanoAssetAmount(units, tok.decimals),
      unit,
    });
  }

  return {
    ada: lovelaceToAda(lovelace),
    lovelace,
    assets,
    rawAssets,
  };
}

/**
 * Derive the one-sig policy id for this wallet address (same script used at mint).
 */
export async function deriveOlympusCardanoPolicyId(changeAddress) {
  const { ForgeScript, resolveScriptHash } = await loadMesh();
  const forgingScript = ForgeScript.withOneSignature(changeAddress);
  return {
    policyId: resolveScriptHash(forgingScript),
    forgingScript,
  };
}

/**
 * Mint full supply of pOmega + mUSDC under a one-signature policy from the connected wallet.
 *
 * @param {{
 *   walletKey: string,
 *   networkId: number,
 *   addressBech32: string,
 * }} opts
 * @returns {Promise<{
 *   policyId: string,
 *   txHash: string,
 *   pOmegaUnits: string,
 *   mUsdcUnits: string,
 *   explorerTx: string,
 * }>}
 */
export async function mintOlympusCardanoTokens(opts) {
  const walletKey = opts?.walletKey;
  const networkId = Number(opts?.networkId);
  const addressBech32 = opts?.addressBech32 || "";
  if (!walletKey) throw new Error("Connect Lace / Eternl first");

  const {
    MeshTxBuilder,
    ForgeScript,
    resolveScriptHash,
    stringToHex,
    KoiosProvider,
  } = await loadMesh();

  const wallet = await enableMeshCardanoWallet(walletKey);
  const changeAddress = await wallet.getChangeAddress();
  const utxos = await wallet.getUtxos();
  if (!utxos?.length) {
    throw new Error(
      `No UTxOs found. Send at least ~${CARDANO_MINT_MIN_ADA_HINT} ADA to this wallet for fees and min-UTXO, then retry.`,
    );
  }

  const balance = await wallet.getBalance();
  const lovelace = BigInt((balance || []).find((a) => a.unit === "lovelace")?.quantity || "0");
  const minLovelace = BigInt(CARDANO_MINT_MIN_ADA_HINT) * 1_000_000n;
  if (lovelace < minLovelace) {
    throw new Error(
      `Need ~${CARDANO_MINT_MIN_ADA_HINT}+ ADA for fees and multi-asset min-UTXO (have ${lovelaceToAda(lovelace)} ADA). Fund this address, then mint.`,
    );
  }

  const provider = new KoiosProvider(koiosBaseUrl(networkId));
  const forgingScript = ForgeScript.withOneSignature(changeAddress);
  const policyId = resolveScriptHash(forgingScript);

  const pOmega = CARDANO_OLYMPUS_TOKENS.pOmega;
  const mUsdc = CARDANO_OLYMPUS_TOKENS.mUSDC;
  const pOmegaHex = stringToHex(pOmega.assetName);
  const mUsdcHex = stringToHex(mUsdc.assetName);

  // CIP-25 label 721 — wallets that read decimals from metadata will show 6dp.
  const metadata = {
    [policyId]: {
      [pOmega.assetName]: {
        name: pOmega.assetName,
        ticker: pOmega.ticker,
        description: pOmega.description,
        decimals: pOmega.decimals,
      },
      [mUsdc.assetName]: {
        name: mUsdc.assetName,
        ticker: mUsdc.ticker,
        description: mUsdc.description,
        decimals: mUsdc.decimals,
      },
    },
  };

  const txBuilder = new MeshTxBuilder({
    fetcher: provider,
    submitter: provider,
    evaluator: provider,
  });

  const unsignedTx = await txBuilder
    .mint(pOmega.mintUnits, policyId, pOmegaHex)
    .mintingScript(forgingScript)
    .mint(mUsdc.mintUnits, policyId, mUsdcHex)
    .mintingScript(forgingScript)
    .metadataValue(721, metadata)
    .changeAddress(changeAddress)
    .selectUtxosFrom(utxos)
    .complete();

  const signedTx = await wallet.signTx(unsignedTx);
  const txHash = await wallet.submitTx(signedTx);

  const record = {
    policyId,
    txHash,
    networkId,
    addressBech32: addressBech32 || changeAddress,
    mintedAt: new Date().toISOString(),
    pOmegaUnits: pOmega.mintUnits,
    mUsdcUnits: mUsdc.mintUnits,
  };
  saveCardanoDeployRecord(record);

  const explorerTx =
    networkId === 0
      ? `https://preprod.cardanoscan.io/transaction/${txHash}`
      : `https://cardanoscan.io/transaction/${txHash}`;

  return {
    policyId,
    txHash,
    pOmegaUnits: pOmega.mintUnits,
    mUsdcUnits: mUsdc.mintUnits,
    explorerTx,
  };
}
