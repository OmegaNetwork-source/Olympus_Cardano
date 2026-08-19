/**
 * Cardano network / explorer helpers for Olympus Cardano demo.
 */

export const CARDANO_NETWORK = {
  0: {
    id: 0,
    name: "Preprod / testnet",
    short: "Testnet",
    explorerAddress: (addr) => `https://preprod.cardanoscan.io/address/${encodeURIComponent(addr)}`,
    explorerTx: (tx) => `https://preprod.cardanoscan.io/transaction/${tx}`,
    explorerPolicy: (policyId) => `https://preprod.cardanoscan.io/tokenPolicy/${policyId}`,
    explorerHome: "https://preprod.cardanoscan.io",
    faucet: "https://docs.cardano.org/cardano-testnets/tools/faucet",
  },
  1: {
    id: 1,
    name: "Cardano mainnet",
    short: "Mainnet",
    explorerAddress: (addr) => `https://cardanoscan.io/address/${encodeURIComponent(addr)}`,
    explorerTx: (tx) => `https://cardanoscan.io/transaction/${tx}`,
    explorerPolicy: (policyId) => `https://cardanoscan.io/tokenPolicy/${policyId}`,
    explorerHome: "https://cardanoscan.io",
  },
};

export function getCardanoNetworkMeta(networkId) {
  return CARDANO_NETWORK[Number(networkId)] || CARDANO_NETWORK[1];
}

export function cardanoPagePath(seekerShell = false) {
  return seekerShell ? "/seeker/cardano" : "/cardano";
}

export const CARDANO_DOCS = {
  lace: "https://www.lace.io/",
  eternl: "https://eternl.io/",
  cip30: "https://cips.cardano.org/cip/CIP-30",
  nativeAssets: "https://developers.cardano.org/docs/native-tokens/",
  olympusCardano: "/cardano",
};
