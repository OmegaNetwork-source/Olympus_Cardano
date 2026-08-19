#!/usr/bin/env node
/**
 * Generate a dedicated Cardano Predict escrow wallet (address + private key).
 * Lace does not re-export mnemonics — use this key on the API instead.
 *
 *   node scripts/brew-cardano-ez-escrow.mjs
 *
 * Then set:
 *   CARDANO_EZ_ESCROW_ADDRESS=<printed address>
 *   CARDANO_EZ_ESCROW_PRIVATE_KEY=<printed xprv1…>
 * Fund that address with ADA + pOmega float for winner payouts.
 */
import { MeshWallet } from "@meshsdk/core";

const networkId = Number(process.env.CARDANO_NETWORK_ID || "1") === 0 ? 0 : 1;
const brewed = MeshWallet.brew(true);
const rootOrMnemonic = Array.isArray(brewed) ? null : String(brewed);

let wallet;
if (rootOrMnemonic && rootOrMnemonic.startsWith("xprv")) {
  wallet = new MeshWallet({
    networkId,
    key: { type: "root", bech32: rootOrMnemonic },
  });
} else {
  const words = Array.isArray(brewed) ? brewed : String(brewed).trim().split(/\s+/);
  wallet = new MeshWallet({
    networkId,
    key: { type: "mnemonic", words },
  });
}

await wallet.init();
const address = await wallet.getChangeAddress();

console.log("\nCardano EZ Peeze escrow wallet (KEEP SECRET — do not commit)\n");
console.log(`CARDANO_EZ_ESCROW_ADDRESS=${address}`);
if (rootOrMnemonic && rootOrMnemonic.startsWith("xprv")) {
  console.log(`CARDANO_EZ_ESCROW_PRIVATE_KEY=${rootOrMnemonic}`);
} else {
  const words = Array.isArray(brewed) ? brewed.join(" ") : String(brewed);
  console.log(`CARDANO_EZ_ESCROW_MNEMONIC="${words}"`);
}
console.log(`\nNetwork: ${networkId === 0 ? "preprod/testnet" : "mainnet"}`);
console.log("Fund this address with ADA + pOmega, then restart the API.\n");
