"use client";

import { useState } from "react";

type Props = {
  regulationsGovId: string | null;
  congressGovUrl: string | null;
  title: string;
  proposalId: string;
};

const TABS = ["write", "template"] as const;
type Tab = (typeof TABS)[number];

const TEMPLATES = {
  support: (title: string) =>
    `I am writing to express my support for the proposed rule: "${title}".\n\nI believe this rule will have a positive impact because:\n\n[Explain your reasons here]\n\nThank you for considering public input on this important matter.`,
  oppose: (title: string) =>
    `I am writing to express my opposition to the proposed rule: "${title}".\n\nI am concerned about this rule because:\n\n[Explain your concerns here]\n\nI respectfully urge the agency to reconsider this proposal.`,
  info: (title: string) =>
    `I am writing regarding the proposed rule: "${title}".\n\nI request additional information on the following points:\n\n[List your questions here]\n\nThank you for your transparency and responsiveness to public inquiry.`,
};

export function CommentDraftSection({ regulationsGovId, congressGovUrl, title, proposalId }: Props) {
  const [tab, setTab] = useState<Tab>("write");
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [org, setOrg] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmationNumber, setConfirmationNumber] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  const submitHref = regulationsGovId
    ? `https://www.regulations.gov/commenton/${regulationsGovId}`
    : congressGovUrl ?? null;

  if (!submitHref) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-5 text-sm text-gray-500">
        Comment submission URL not available for this proposal. Check{" "}
        <a
          href="https://www.regulations.gov"
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-600 hover:underline"
        >
          regulations.gov
        </a>{" "}
        directly.
      </div>
    );
  }

  if (submitted) {
    const displayHref = fallbackUrl ?? submitHref;
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6 text-center">
        <p className="text-lg font-semibold text-emerald-800">
          ✓ Thanks for participating in democracy.
        </p>
        {confirmationNumber ? (
          <p className="mt-1 text-sm text-emerald-700">
            Confirmation #: <span className="font-mono font-medium">{confirmationNumber}</span>
          </p>
        ) : (
          <p className="mt-1 text-sm text-emerald-700">
            Your comment has been prepared. Paste it into the form at regulations.gov to submit
            officially.
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={() => {
              if (typeof navigator !== "undefined") {
                navigator.clipboard.writeText(text).catch(() => {});
              }
            }}
            className="rounded-md border border-emerald-300 bg-white px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 transition-colors"
          >
            Copy comment text
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
          onClick={() => setSubmitted(false)}
          className="mt-3 text-xs text-emerald-600 hover:underline"
        >
          Edit my comment
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Step 1: Draft */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
          Step 1 — Draft your comment
        </p>

        {/* Tab bar */}
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1 mb-3 w-fit">
          {(["write", "template"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                if (t === "template" && !text) setText(TEMPLATES.support(title));
              }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === t
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {t === "write" ? "Write My Own" : "Use Template"}
            </button>
          ))}
          <span className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-300 cursor-default">
            AI Help
            <span className="ml-1 text-[10px] font-normal">(coming soon)</span>
          </span>
        </div>

        {tab === "template" && (
          <div className="flex gap-2 mb-2">
            {(["support", "oppose", "info"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setText(TEMPLATES[t](title))}
                className="rounded border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:border-gray-300 hover:bg-gray-50 transition-colors capitalize"
              >
                {t === "info" ? "Request info" : t}
              </button>
            ))}
          </div>
        )}

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Share your perspective on this proposal. What impact will it have on you, your community, or your industry?"
          rows={7}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <p className="mt-1 text-right text-xs text-gray-400">
          {text.length} characters
        </p>
      </div>

      {/* Step 2: Details */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
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
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
          Step 3 — Submit
        </p>
        <button
          disabled={!text.trim() || isSubmitting}
          onClick={async () => {
            setIsSubmitting(true);
            try {
              const res = await fetch(`/api/proposals/${proposalId}/comment`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  comment_text: text,
                  name: name || undefined,
                  org: org || undefined,
                  regulations_gov_id: regulationsGovId,
                }),
              });
              const data = await res.json();
              if (data.status === "submitted") {
                setConfirmationNumber(data.confirmation_number ?? null);
                setFallbackUrl(null);
              } else {
                // failed or no_api_key — always provide fallback
                setFallbackUrl(data.fallback_url ?? submitHref);
              }
            } catch {
              setFallbackUrl(submitHref);
            } finally {
              setIsSubmitting(false);
              setSubmitted(true);
            }
          }}
          className="w-full rounded-md bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isSubmitting ? "Submitting..." : "Submit Official Comment →"}
        </button>
        <p className="mt-2 text-center text-xs text-gray-400">
          Opens regulations.gov · Free, always · No account required
        </p>
      </div>
    </div>
  );
}
