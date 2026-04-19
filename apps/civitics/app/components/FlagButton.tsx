"use client";

import { useState } from "react";

type ContentType = "civic_comment" | "official_community_comment";

const REASONS: Array<{ value: string; label: string }> = [
  { value: "spam",           label: "Spam" },
  { value: "harassment",     label: "Harassment" },
  { value: "off_topic",      label: "Off-topic" },
  { value: "misinformation", label: "Misinformation" },
  { value: "other",          label: "Other" },
];

interface FlagButtonProps {
  contentType: ContentType;
  contentId: string;
}

export function FlagButton({ contentType, contentId }: FlagButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("spam");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/moderation/flag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content_type: contentType,
          content_id:   contentId,
          reason,
          note: note.trim() || undefined,
        }),
      });
      if (res.status === 401) {
        setNeedsAuth(true);
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to flag");
      }
      setDone(true);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to flag");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <span className="text-[10px] text-gray-400" aria-live="polite">
        Flagged · thanks
      </span>
    );
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-[10px] text-gray-400 hover:text-red-600 transition-colors"
        aria-label="Flag this comment"
        aria-expanded={open}
      >
        ⚑ Flag
      </button>

      {open && (
        <div className="absolute right-0 top-5 z-20 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
          <label className="block text-[11px] font-medium text-gray-700">Reason</label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900"
          >
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>

          <label className="mt-2 block text-[11px] font-medium text-gray-700">
            Add context (optional)
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={500}
            className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 resize-none"
          />

          {needsAuth && (
            <p className="mt-2 text-[10px] text-red-600">
              <a href="/auth/sign-in" className="underline">Sign in</a> to flag comments.
            </p>
          )}
          {error && !needsAuth && (
            <p className="mt-2 text-[10px] text-red-600">{error}</p>
          )}

          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="rounded bg-red-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? "…" : "Submit flag"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
