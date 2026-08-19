/**
 * Cardano Olympus mint is gated: not on the public DEX.
 * Only this mainnet payment address may request a mint build.
 */
export const CARDANO_OLYMPUS_MINT_ALLOWLIST = Object.freeze([
  "addr1q8mhcul6zm5k9ta2e55qfzc5qlt96g2a07pp2tkpzazn8y3jhvm9vt6vmf2f6jmfxwjuulcjdz2g8g43r7tnwx8saulq6400s5",
]);

/** Obscure SPA path — not linked from main nav / Cardano Trade. */
export const CARDANO_OLYMPUS_MINT_PATH = "/ops/cardano-native-mint";

export function normalizeCardanoAddress(addr) {
  return String(addr || "").trim().toLowerCase();
}

export function isCardanoOlympusMintAllowed(addressBech32) {
  const a = normalizeCardanoAddress(addressBech32);
  if (!a) return false;
  return CARDANO_OLYMPUS_MINT_ALLOWLIST.some((x) => normalizeCardanoAddress(x) === a);
}

export function assertCardanoOlympusMintAllowed(addressBech32) {
  if (isCardanoOlympusMintAllowed(addressBech32)) return;
  const err = new Error("Mint not allowed for this wallet");
  err.code = "CARDANO_MINT_FORBIDDEN";
  throw err;
}
