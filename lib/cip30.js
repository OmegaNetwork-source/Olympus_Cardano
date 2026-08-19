/**
 * Cardano CIP-30 helpers — isolated from EVM/Solana/TON/Aptos wallet stacks.
 * Uses browser-injected wallets (Lace, Eternl, etc.) via window.cardano.
 */
import { bech32 } from "bech32";

const KNOWN_WALLETS = [
  { key: "lace", name: "Lace", iconHint: "lace" },
  { key: "eternl", name: "Eternl", iconHint: "eternl" },
  { key: "nami", name: "Nami", iconHint: "nami" },
  { key: "typhoncip30", name: "Typhon", iconHint: "typhon" },
  { key: "flint", name: "Flint", iconHint: "flint" },
  { key: "gerowallet", name: "Gero", iconHint: "gero" },
  { key: "nufi", name: "NuFi", iconHint: "nufi" },
  { key: "vespr", name: "VESPR", iconHint: "vespr" },
];

export function hexToBytes(hex) {
  const h = String(hex || "").replace(/^0x/i, "");
  if (!h || h.length % 2) return new Uint8Array();
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Minimal CBOR uint / Value parser for CIP-30 getBalance (coin or [coin, multiasset]). */
export function parseLovelaceFromBalanceCbor(hex) {
  const buf = hexToBytes(hex);
  if (!buf.length) return 0n;
  let i = 0;

  const readAdditional = (additional) => {
    if (additional < 24) return BigInt(additional);
    if (additional === 24) return BigInt(buf[i++]);
    if (additional === 25) {
      const v = (buf[i] << 8) | buf[i + 1];
      i += 2;
      return BigInt(v);
    }
    if (additional === 26) {
      const v = ((buf[i] << 24) | (buf[i + 1] << 16) | (buf[i + 2] << 8) | buf[i + 3]) >>> 0;
      i += 4;
      return BigInt(v);
    }
    if (additional === 27) {
      let v = 0n;
      for (let k = 0; k < 8; k++) v = (v << 8n) | BigInt(buf[i++]);
      return v;
    }
    throw new Error("Unsupported CBOR integer size");
  };

  const readUint = () => {
    const b = buf[i++];
    const major = b >> 5;
    const additional = b & 0x1f;
    if (major !== 0) throw new Error("Expected CBOR unsigned integer");
    return readAdditional(additional);
  };

  const b0 = buf[i];
  const major0 = b0 >> 5;
  const add0 = b0 & 0x1f;
  if (major0 === 0) {
    i++;
    return readAdditional(add0);
  }
  if (major0 === 4) {
    i++;
    readAdditional(add0); // array length
    return readUint();
  }
  // Fallback: try first uint anywhere reasonable
  try {
    i = 0;
    return readUint();
  } catch {
    return 0n;
  }
}

export function lovelaceToAda(lovelace) {
  const n = typeof lovelace === "bigint" ? lovelace : BigInt(lovelace || 0);
  const whole = n / 1_000_000n;
  const frac = n % 1_000_000n;
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}

export function cardanoHexAddressToBech32(hex, networkId = 1) {
  const bytes = hexToBytes(hex);
  if (!bytes.length) return "";
  const words = bech32.toWords(bytes);
  const hrp = Number(networkId) === 0 ? "addr_test" : "addr";
  return bech32.encode(hrp, words, 1023);
}

export function shortCardanoAddress(addr) {
  const s = String(addr || "");
  if (s.length <= 16) return s;
  return `${s.slice(0, 10)}…${s.slice(-6)}`;
}

/** @returns {{ key: string, name: string, icon?: string, apiVersion?: string }[]} */
export function listCardanoCip30Wallets() {
  if (typeof window === "undefined") return [];
  const root = window.cardano;
  if (!root || typeof root !== "object") return [];

  const found = [];
  const seen = new Set();

  for (const meta of KNOWN_WALLETS) {
    const w = root[meta.key];
    if (w && typeof w.enable === "function") {
      seen.add(meta.key);
      found.push({
        key: meta.key,
        name: w.name || meta.name,
        icon: typeof w.icon === "string" ? w.icon : undefined,
        apiVersion: w.apiVersion,
      });
    }
  }

  for (const key of Object.keys(root)) {
    if (seen.has(key)) continue;
    const w = root[key];
    if (!w || typeof w.enable !== "function") continue;
    if (key === "enable" || key === "nami") continue;
    found.push({
      key,
      name: w.name || key,
      icon: typeof w.icon === "string" ? w.icon : undefined,
      apiVersion: w.apiVersion,
    });
  }

  return found;
}

/**
 * @param {string} walletKey
 * @returns {Promise<{
 *   walletKey: string,
 *   api: object,
 *   networkId: number,
 *   addressHex: string,
 *   addressBech32: string,
 *   lovelace: bigint,
 *   ada: string,
 * }>}
 */
export async function connectCardanoCip30Wallet(walletKey) {
  if (typeof window === "undefined") throw new Error("Window unavailable");
  const root = window.cardano;
  const injected = root?.[walletKey];
  if (!injected?.enable) {
    throw new Error(`${walletKey} wallet not found. Install Lace (lace.io) or Eternl and refresh.`);
  }

  const api = await injected.enable();
  const networkId = Number(await api.getNetworkId());
  let addressHex =
    (await api.getChangeAddress?.()) ||
    (await api.getUsedAddresses?.())?.[0] ||
    (await api.getUnusedAddresses?.())?.[0] ||
    "";
  if (Array.isArray(addressHex)) addressHex = addressHex[0] || "";
  addressHex = String(addressHex || "");
  if (!addressHex) throw new Error("Wallet returned no address");

  const addressBech32 = cardanoHexAddressToBech32(addressHex, networkId);
  let lovelace = 0n;
  try {
    const balHex = await api.getBalance();
    lovelace = parseLovelaceFromBalanceCbor(balHex);
  } catch (e) {
    console.warn("[cardano] getBalance failed", e);
  }

  return {
    walletKey,
    api,
    networkId,
    addressHex,
    addressBech32,
    lovelace,
    ada: lovelaceToAda(lovelace),
  };
}

export async function refreshCardanoBalance(api) {
  if (!api?.getBalance) return { lovelace: 0n, ada: "0" };
  const balHex = await api.getBalance();
  const lovelace = parseLovelaceFromBalanceCbor(balHex);
  return { lovelace, ada: lovelaceToAda(lovelace) };
}
