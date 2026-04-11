"use client";

/**
 * InitiativeCommentPanel — Sprint 10
 *
 * Shown on initiative pages in the mobilise stage when at least one linked
 * proposal has an active comment period (i.e. regulations_gov_id set and
 * comment_period_end is either null or in the future).
 *
 * Reuses the /api/proposals/[id]/comment endpoint — the comment is about the
 * linked federal proposal, submitted in the context of this initiative.
 *
 * Core principle: official comment submission is always free. No auth required.
 */

import { useState } from "react";

export type CommentableProposal = {
  id:                  string;
  title:               string;
  bill_number:         string | null;
  short_title:         string | null;
  regulations_gov_id:  string | null;
  congress_gov_url:    string | null;
  comment_period_end:  string | null;
};

type Props = {
  initiativeTitle:   string;
  initiativeSummary: string | null;
  proposals:         CommentableProposal[];
};

// Filter to proposals that actually accept comments and haven't expired
function isCommentable(p: CommentableProposal): boolean {
  if (!p.regulations_gov_id && !p.congress_gov_url) return false;
  if (p.comment_period_end) {
    return new Date(p.comment_period_end) > new Date();
  }
  return true; // no end date = open period assumed
}

function proposalLabel(p: CommentableProposal): string {
  if (p.bill_number) return `${p.bill_number} · ${p.short_title ?? p.title}`;
  return p.short_title ?? p.title;
}

const INITIATIVE_TEMPLATE = (initiativeTitle: string, summary: string | null) =>
  `I am writing to support the civic initiative: "${initiativeTitle}".` +
  (summary ? `\n\nThis initiative aims to: ${summary}` : "") +
  "\n\nI urge the agency to consider this perspective:\n\n[Share your thoughts here]\n\nThank you for considering public input on this matter.";

// ─── Component ────────────────────────────────────────────────────────────────

export function InitiativeCommentPanel({
  initiativeTitle,
  initiativeSummary,
  proposals,
}: Props) {
  const eligible = proposals.filter(isCommentable);
  if (eligible.length === 0) return null;

  return (
    <CommentPanelInner
      initiativeTitle={initiativeTitle}
      initiativeSummary={initiativeSummary}
      proposals={eligible}
    />
  );
}

// Split into inner component so we can use hooks safely
function CommentPanelInner({
  initiativeTitle,
  initiativeSummary,
  proposals,
}: {
  initiativeTitle:   string;
  initiativeSummary: string | null;
  proposals:         CommentableProposal[];
}) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [text,        setText]        = useState(() => INITIATIVE_TEMPLATE(initiativeTitle, initiativeSummary));
  const [name,        setName]        = useState("");
  const [org,         setOrg]         = useState("");
  const [submitted,   setSubmitted]   = useState(false);
  const [submitting,  setSubmitting]  = useState(false);
  const [confirmNum,  setConfirmNum]  = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  const selected    = proposals[selectedIdx];
  const submitHref  = selected.regulations_gov_id
    ? `https://www.regulations.gov/commenton/${selected.regulations_gov_id}`
    : selected.congress_gov_url;

  const daysLeft = selected.comment_period_end
    ? Math.max(0, Math.ceil((new Date(selected.comment_period_end).getTime() - Date.now()) / 86400000))
    : null;

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/proposals/${selected.id}/comment`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          comment_text:       text,
          name:               name || undefined,
          org:                org  || undefined,
          regulations_gov_id: selected.regulations_gov_id,
        }),
      });
      const data = await res.json();
      if (data.status === "submitted") {
        setConfirmNum(data.confirmation_number ?? null);
        setFallbackUrl(null);
      } else {
        setFallbackUrl(data.fallback_url ?? submitHref ?? null);
      }
    } catch {
      setFallbackUrl(submitHref ?? null);
    } finally {
      setSubmitting(false);
      setSubmitted(true);
    }
  }

  // ── Success state ────────────────────────────────────────────────────────
  if (submitted) {
    const displayHref = fallbackUrl ?? submitHref;
    return (
      <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-6">
        <p className="text-center text-lg font-semibold text-emerald-800">
          ✓ Thanks for participating in democracy.
        </p>
        {confirmNum ? (
          <p className="mt-1 text-center text-sm text-emerald-700">
            Confirmation #: <span className="font-mono font-medium">{confirmNum}</span>
          </p>
        ) : (
          <p className="mt-1 text-center text-sm text-emerald-700">
            Your comment is ready — paste it into the form at regulations.gov to submit officially.
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => { navigator.clipboard?.writeText(text).catch(() => {}); }}
            className="rounded-md border border-emerald-300 bg-white px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 transition-colors"
          >
            Copy comment
          </button>
          {displayHref && (
            <a
              href={displayHref}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
            >
              Open regulations.gov →
            </a>
          )}
        </div>
        <button
          type="button"
          onClick={() => setSubmitted(false)}
          className="mt-4 block w-full text-center text-xs text-emerald-600 hover:underline"
        >
          Edit my comment
        </button>
      </div>
    );
  }

  // ── Draft state ──────────────────────────────────────────────────────────
  return (
    <div className="mt-6 rounded-xl border border-blue-200 bg-white p-5 shadow-sm">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-gray-900">Submit an official comment</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            Your initiative can trigger a formal public comment to the responsible agency — free, always.
          </p>
        </div>
        {daysLeft !== null && (
          <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            daysLeft <= 7
              ? "bg-red-100 text-red-700"
              : "bg-amber-100 text-amber-700"
          }`}>
            {daysLeft}d left
          </span>
        )}
      </div>

      {/* Proposal selector (shown when multiple eligible) */}
      {proposals.length > 1 && (
        <div className="mb-4">
          <label className="mb-1 block text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Comment on which proposal?
          </label>
          <div className="space-y-1">
            {proposals.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedIdx(i)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                  i === selectedIdx
                    ? "border-indigo-300 bg-indigo-50 text-indigo-800 font-semibold"
                    : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                }`}
              >
                {proposalLabel(p)}
                {p.comment_period_end && (
                  <span className="ml-1.5 text-gray-400">
                    · ends {new Date(p.comment_period_end).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Selected proposal pill */}
      {proposals.length === 1 && (
        <div className="mb-4 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
          <p className="text-xs text-gray-500">
            Related proposal:{" "}
            <a
              href={`/proposals/${selected.id}`}
              className="font-medium text-indigo-600 hover:underline"
            >
              {proposalLabel(selected)}
            </a>
          </p>
          {selected.comment_period_end && (
            <p className="mt-0.5 text-[11px] text-gray-400">
              Comment period closes {new Date(selected.comment_period_end).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </p>
          )}
        </div>
      )}

      {/* Step 1: Draft */}
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Step 1 — Draft your comment
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <p className="mt-1 text-right text-xs text-gray-400">{text.length} characters</p>
        </div>

        {/* Step 2: Details */}
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Step 2 — Your details (optional)
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (optional)"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <input
              type="text"
              value={org}
              onChange={(e) => setOrg(e.target.value)}
              placeholder="Organization (optional)"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <p className="mt-1.5 text-xs text-gray-400">
            Anonymous comments are accepted. Your identity is never required.
          </p>
        </div>

        {/* Step 3: Submit */}
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Step 3 — Submit
          </p>
          <button
            type="button"
            disabled={!text.trim() || submitting}
            onClick={handleSubmit}
            className="w-full rounded-md bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
          >
            {submitting ? "Submitting…" : "Submit Official Comment →"}
          </button>
          <p className="mt-2 text-center text-xs text-gray-400">
            Submits to regulations.gov · Free, always · No account required
          </p>
        </div>
      </div>
    </div>
  );
}
