/**
 * Olympus native assets on Cardano (not ERC-20 / jettons).
 * Supply matches Aptos/EVM Olympus: pOmega 100B whole @ 6dp, mUSDC 10M whole @ 6dp.
 */

export const CARDANO_ASSET_DECIMALS = 6;

/** Whole tokens: 100_000_000_000 */
export const POMEGA_WHOLE_SUPPLY = 100_000_000_000n;
/** Base units: 100B × 10^6 */
export const POMEGA_MINT_UNITS = "100000000000000000";

/** Whole tokens: 10_000_000 */
export const MUSDC_WHOLE_SUPPLY = 10_000_000n;
/** Base units: 10M × 10^6 */
export const MUSDC_MINT_UNITS = "10000000000000";

export const CARDANO_OLYMPUS_TOKENS = {
  pOmega: {
    key: "pOmega",
    assetName: "pOmega",
    ticker: "pOmega",
    decimals: CARDANO_ASSET_DECIMALS,
    wholeSupply: POMEGA_WHOLE_SUPPLY,
    mintUnits: POMEGA_MINT_UNITS,
    description: "Olympus pOmega on Cardano — Catalyst pilot",
  },
  mUSDC: {
    key: "mUSDC",
    assetName: "mUSDC",
    ticker: "mUSDC",
    decimals: CARDANO_ASSET_DECIMALS,
    wholeSupply: MUSDC_WHOLE_SUPPLY,
    mintUnits: MUSDC_MINT_UNITS,
    description: "Olympus mirrored USDC on Cardano — Catalyst pilot",
  },
};

/** Rough ADA needed: fees + multi-asset min-UTXO headroom. */
export const CARDANO_MINT_MIN_ADA_HINT = 5;

const STORAGE_PREFIX = "olympus.cardano.deploy.v1";

export function cardanoDeployStorageKey(networkId, addressBech32) {
  return `${STORAGE_PREFIX}.${Number(networkId)}.${String(addressBech32 || "").toLowerCase()}`;
}

/** @returns {{ policyId: string, txHash?: string, mintedAt?: string, networkId: number, addressBech32?: string } | null} */
export function loadCardanoDeployRecord(networkId, addressBech32) {
  if (typeof window === "undefined" || !addressBech32) return null;
  try {
    const raw = window.localStorage.getItem(cardanoDeployStorageKey(networkId, addressBech32));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.policyId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveCardanoDeployRecord(record) {
  if (typeof window === "undefined" || !record?.policyId || !record?.addressBech32) return;
  const key = cardanoDeployStorageKey(record.networkId, record.addressBech32);
  window.localStorage.setItem(key, JSON.stringify(record));
}

export function clearCardanoDeployRecord(networkId, addressBech32) {
  if (typeof window === "undefined" || !addressBech32) return;
  window.localStorage.removeItem(cardanoDeployStorageKey(networkId, addressBech32));
}

/** Format base units with decimals for display. */
export function formatCardanoAssetAmount(units, decimals = CARDANO_ASSET_DECIMALS) {
  let n;
  try {
    n = typeof units === "bigint" ? units : BigInt(String(units || "0"));
  } catch {
    return "0";
  }
  const neg = n < 0n;
  if (neg) n = -n;
  const base = 10n ** BigInt(decimals);
  const whole = n / base;
  const frac = n % base;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  const body = fracStr ? `${whole}.${fracStr}` : `${whole}`;
  return neg ? `-${body}` : body;
}

export function cardanoAssetUnit(policyId, assetNameHex) {
  return `${String(policyId || "").toLowerCase()}${String(assetNameHex || "").toLowerCase()}`;
}
