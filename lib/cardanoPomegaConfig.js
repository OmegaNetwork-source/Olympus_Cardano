/**
 * Cardano pOmega / mUSDC unit resolution for Predict escrow (mirrors Solana mint helpers).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CARDANO_ASSET_DECIMALS, CARDANO_OLYMPUS_TOKENS } from "./olympusCardanoAssets.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEPLOY_PATH = path.join(__dirname, "..", "..", "deployments", "pomega-cardano.json");

function stringToHex(str) {
  const s = String(str || "");
  let out = "";
  for (let i = 0; i < s.length; i++) out += s.charCodeAt(i).toString(16).padStart(2, "0");
  return out;
}

export const CARDANO_POMEGA_POLICY_ID_DEFAULT =
  "e9ff6e554a9932a8b9c0b94bb4a3241b8b55d572773ff94864746cb8";
export const CARDANO_POMEGA_ASSET_NAME = "pOmega";
export const CARDANO_MUSDC_ASSET_NAME = "mUSDC";
export const CARDANO_POMEGA_DECIMALS = CARDANO_ASSET_DECIMALS;

let cachedDeploy = undefined;

export function loadCardanoPomegaDeploy() {
  if (cachedDeploy !== undefined) return cachedDeploy;
  try {
    if (fs.existsSync(DEPLOY_PATH)) {
      cachedDeploy = JSON.parse(fs.readFileSync(DEPLOY_PATH, "utf8"));
      return cachedDeploy;
    }
  } catch {
    /* ignore */
  }
  cachedDeploy = null;
  return null;
}

export function resolveCardanoPomegaPolicyId() {
  const env = String(process.env.CARDANO_POMEGA_POLICY_ID || "").trim().toLowerCase();
  if (/^[0-9a-f]{56}$/.test(env)) return env;
  const d = loadCardanoPomegaDeploy();
  const fromFile = String(d?.policyId || "").trim().toLowerCase();
  if (/^[0-9a-f]{56}$/.test(fromFile)) return fromFile;
  return CARDANO_POMEGA_POLICY_ID_DEFAULT;
}

export function resolveCardanoPomegaDecimals() {
  const n = parseInt(String(process.env.CARDANO_POMEGA_DECIMALS || ""), 10);
  if (Number.isFinite(n) && n >= 0 && n <= 18) return n;
  const d = loadCardanoPomegaDeploy();
  const fromFile = Number(d?.decimals);
  if (Number.isFinite(fromFile) && fromFile >= 0 && fromFile <= 18) return fromFile;
  return CARDANO_POMEGA_DECIMALS;
}

export function resolveCardanoPomegaUnit() {
  const env = String(process.env.CARDANO_POMEGA_UNIT || "").trim().toLowerCase();
  if (/^[0-9a-f]{56,}[0-9a-f]*$/i.test(env) && env.length >= 56) return env;
  const d = loadCardanoPomegaDeploy();
  const fromFile = String(d?.pOmega?.unit || "").trim().toLowerCase();
  if (fromFile) return fromFile;
  const policy = resolveCardanoPomegaPolicyId();
  return `${policy}${stringToHex(CARDANO_POMEGA_ASSET_NAME)}`;
}

export function resolveCardanoMusdcUnit() {
  const env = String(process.env.CARDANO_MUSDC_UNIT || "").trim().toLowerCase();
  if (/^[0-9a-f]{56,}[0-9a-f]*$/i.test(env) && env.length >= 56) return env;
  const d = loadCardanoPomegaDeploy();
  const fromFile = String(d?.mUSDC?.unit || "").trim().toLowerCase();
  if (fromFile) return fromFile;
  const policy = resolveCardanoPomegaPolicyId();
  return `${policy}${stringToHex(CARDANO_MUSDC_ASSET_NAME)}`;
}

export function resolveCardanoEzEscrowAddress() {
  const env = String(process.env.CARDANO_EZ_ESCROW_ADDRESS || "").trim();
  if (env.startsWith("addr")) return env;
  const d = loadCardanoPomegaDeploy();
  const owner = String(d?.owner || "").trim();
  if (owner.startsWith("addr")) return owner;
  return "";
}

/** True if either private key or mnemonic is set for escrow payouts. */
export function cardanoHasEzEscrowSigner() {
  return Boolean(
    String(process.env.CARDANO_EZ_ESCROW_PRIVATE_KEY || "").trim() ||
      String(process.env.CARDANO_EZ_ESCROW_MNEMONIC || "").trim(),
  );
}

/** @deprecated Prefer cardanoHasEzEscrowSigner — kept for older imports. */
export function cardanoHasEzEscrowMnemonic() {
  return cardanoHasEzEscrowSigner();
}

export function humanToCardanoRawAmount(human, decimals = CARDANO_POMEGA_DECIMALS) {
  const d = Math.min(36, Math.max(0, Number(decimals) || 0));
  const s = String(human ?? "").trim();
  if (!s) return 0n;
  const neg = s.startsWith("-");
  const t = neg ? s.slice(1).trim() : s;
  const m = t.match(/^(\d*)(?:\.(\d*))?$/);
  if (!m) return 0n;
  const intPart = m[1] || "0";
  let frac = (m[2] || "").replace(/\D/g, "");
  frac = (frac + "0".repeat(d)).slice(0, d);
  const whole = BigInt(intPart) * 10n ** BigInt(d) + BigInt(frac || "0");
  return neg ? -whole : whole;
}

export { CARDANO_OLYMPUS_TOKENS, CARDANO_ASSET_DECIMALS };
