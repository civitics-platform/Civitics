/**
 * @civitics/auth
 *
 * Privy integration + session management.
 * Phase 0: Simulation stubs — real Privy integration in Phase 4.
 *
 * Design rules:
 *  - Users never see wallet addresses, seed phrases, or network names
 *  - Wallet creation is invisible: email/social login → embedded wallet automatically
 *  - No gas fee prompts — Biconomy handles sponsorship silently (Phase 4)
 *  - Government email verification gates official account status
 */

export type AuthUser = {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  isEmailVerified: boolean;
  isGovernmentVerified: boolean;
  civicCreditsBalance: number;
  // Wallet fields — populated in Phase 4, never shown in UI by default
  walletAddress: string | null;
};

export type AuthSession = {
  user: AuthUser;
  accessToken: string;
};

// Phase 0 stub — replaced by Privy hooks in Phase 4
export function createAuthStub() {
  return {
    signIn: async (_email: string): Promise<void> => {
      throw new Error("Auth not yet configured — Phase 4 feature");
    },
    signOut: async (): Promise<void> => {
      throw new Error("Auth not yet configured — Phase 4 feature");
    },
    getSession: async (): Promise<AuthSession | null> => {
      return null;
    },
  };
}
