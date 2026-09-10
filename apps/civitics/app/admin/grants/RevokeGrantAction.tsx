"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { revokeConfirmMessage, revokeResultMessage } from "@/lib/active-grants";

// FIX-1167 — the revoke control for one ACTIVE grant row.
//
// Two steps on purpose. revoke_grant() is set-based on the
// (user_id, role, target_type, target_id) key, so one click can retire several
// rows; the confirmation therefore leads with the COUNT, and that count is
// re-read from the server the moment the operator asks to revoke rather than
// taken from the server-rendered page, which may be minutes old.
//
// `initialCount` is what the page rendered, used only for the button label
// before the pre-read lands. `revokeResultMessage` compares the pre-read count
// against the count the RPC actually returned: under the FIX-928
// NULLS NOT DISTINCT index those must agree, and a mismatch is shown rather
// than smoothed over.
export function RevokeGrantAction({
  grantId,
  initialCount,
  identity,
}: {
  grantId: string;
  initialCount: number;
  identity: { userEmail: string | null; userName: string | null; userId: string; role: string; targetLabel: string };
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "checking" | "confirm" | "revoking">("idle");
  const [pending, setPending] = useState<number>(initialCount);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function beginRevoke() {
    setPhase("checking");
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/grants/${grantId}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? `count read failed (${res.status})`);
        setPhase("idle");
        return;
      }
      // A key that no longer has any active rows has already been revoked
      // elsewhere; say so instead of firing a write that flips nothing.
      if ((data?.activeOnKey ?? 0) === 0) {
        setResult("Nothing active on this key any more — refreshing.");
        setPhase("idle");
        router.refresh();
        return;
      }
      setPending(data.activeOnKey);
      setPhase("confirm");
    } catch {
      setError("network error");
      setPhase("idle");
    }
  }

  async function confirmRevoke() {
    setPhase("revoking");
    setError(null);
    try {
      const res = await fetch(`/api/admin/grants/${grantId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? `revoke failed (${res.status})`);
        setPhase("idle");
        return;
      }
      setResult(revokeResultMessage(pending, data?.revoked ?? 0));
      setPhase("idle");
      router.refresh();
    } catch {
      setError("network error");
      setPhase("idle");
    }
  }

  if (phase === "confirm") {
    return (
      <div className="flex flex-col items-end gap-1">
        <p className="max-w-xs text-right text-[11px] leading-snug text-ink">
          {revokeConfirmMessage(identity, pending)}
        </p>
        {pending > 1 && (
          <p className="max-w-xs text-right text-[10px] leading-snug text-accent">
            This key holds {pending} active rows — one revoke retires all of them.
          </p>
        )}
        <div className="flex gap-2">
          <button
            onClick={confirmRevoke}
            className="bg-accent px-3 py-1.5 text-xs font-medium text-paper hover:opacity-90 transition-opacity"
          >
            Yes, revoke {pending}
          </button>
          <button
            onClick={() => setPhase("idle")}
            className="border border-rule bg-card px-3 py-1.5 text-xs font-medium text-ink hover:border-ink transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={beginRevoke}
        disabled={phase !== "idle"}
        className="border border-rule bg-card px-3 py-1.5 text-xs font-medium text-accent hover:border-accent hover:bg-accent/5 disabled:opacity-50 transition-colors"
      >
        {phase === "checking" ? "Checking…" : phase === "revoking" ? "Revoking…" : "Revoke"}
      </button>
      {error && <p className="text-[10px] text-accent">{error}</p>}
      {result && <p className="max-w-xs text-right text-[10px] leading-snug text-ink-soft">{result}</p>}
    </div>
  );
}
