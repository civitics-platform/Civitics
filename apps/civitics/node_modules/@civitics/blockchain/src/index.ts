/**
 * @civitics/blockchain
 *
 * Wallet config, contract ABIs, chain routing, ERC-4337.
 * Phase 0: Chain config stubs only — real integration in Phase 4.
 *
 * Design rules:
 *  - Blockchain is INVISIBLE to users — no addresses, no network names in UI
 *  - No gas fee prompts — Biconomy paymaster handles sponsorship
 *  - Advanced users may see chain details if they opt in
 *  - Platform routes to cheapest available chain automatically
 *  - Chains: Optimism (primary), Base (US onboarding), Polygon (international)
 *  - NEVER deploy to mainnet without a completed smart contract audit
 */

export type SupportedChain = "optimism" | "base" | "polygon";

export const CHAIN_CONFIG = {
  optimism: {
    chainId: 10,
    name: "OP Mainnet",
    rpcUrl: "https://mainnet.optimism.io",
    // Primary chain: mission-aligned, RetroPGF, decentralized
  },
  base: {
    chainId: 8453,
    name: "Base",
    rpcUrl: "https://mainnet.base.org",
    // US user onboarding, Coinbase fiat ramp
  },
  polygon: {
    chainId: 137,
    name: "Polygon",
    rpcUrl: "https://polygon-rpc.com",
    // International: cheapest transactions, strong in emerging markets
  },
} as const satisfies Record<SupportedChain, { chainId: number; name: string; rpcUrl: string }>;

// Phase 0 stub — replaced by real contract addresses after audit in Phase 4
export const CONTRACT_ADDRESSES = {
  civicCredits: null as string | null,    // ERC-4337 credit ledger (Optimism)
  commonsToken: null as string | null,    // COMMONS token (Phase 4+)
  warrantyCanary: null as string | null,  // Warrant canary contract (Optimism)
};

/**
 * Hash content for on-chain anchoring.
 * Used for: official comments, promise records, government docs.
 * The hash is stored on-chain; the full content lives in Arweave/R2.
 */
export async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return "0x" + hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
