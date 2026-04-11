"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// ─── Types ────────────────────────────────────────────────────────────────────

type Scope = "federal" | "state" | "local";

// ─── Constants ────────────────────────────────────────────────────────────────

const SCOPE_OPTIONS: { value: Scope; label: string; description: string }[] = [
  { value: "federal",  label: "Federal",  description: "Targets Congress, federal agencies, or the President" },
  { value: "state",    label: "State",    description: "Targets your state legislature or governor" },
  { value: "local",    label: "Local",    description: "Targets city, county, or district officials" },
];

const ISSUE_TAG_OPTIONS = [
  "climate", "healthcare", "education", "housing", "immigration", "finance",
  "energy", "agriculture", "transportation", "labor", "civil_rights",
  "foreign_policy", "criminal_justice", "technology", "consumer_protection",
];

// ─── Component ────────────────────────────────────────────────────────────────

export function CreateInitiativeForm() {
  const router = useRouter();

  const [title, setTitle]           = useState("");
  const [summary, setSummary]       = useState("");
  const [bodyMd, setBodyMd]         = useState("");
  const [scope, setScope]           = useState<Scope>("federal");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState<string | null>(null);

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Client-side validation
    if (title.trim().length < 10) {
      setError("Title must be at least 10 characters.");
      return;
    }
    if (title.trim().length > 120) {
      setError("Title must be 120 characters or fewer.");
      return;
    }
    if (bodyMd.trim().length === 0) {
      setError("Proposal body is required.");
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("/api/initiatives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          summary: summary.trim() || undefined,
          body_md: bodyMd.trim(),
          scope,
          issue_area_tags: selectedTags,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to create initiative.");
        setSubmitting(false);
        return;
      }

      // Redirect to the new initiative's detail page
      router.push(`/initiatives/${data.initiative.id}`);
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  const titleLen = title.length;
  const summaryLen = summary.length;

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* ── Title ────────────────────────────────────────────────────── */}
      <div>
        <label htmlFor="title" className="block text-sm font-semibold text-gray-900">
          Title <span className="text-red-500">*</span>
        </label>
        <p className="mt-0.5 text-xs text-gray-500">
          A clear, specific statement of what this initiative calls for. (10–120 chars)
        </p>
        <div className="relative mt-2">
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder="e.g. Require disclosure of campaign donations within 48 hours of receipt"
            className="block w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <span
            className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs tabular-nums ${
              titleLen < 10 || titleLen > 120 ? "text-red-400" : "text-gray-400"
            }`}
          >
            {titleLen}/120
          </span>
        </div>
      </div>

      {/* ── Summary ──────────────────────────────────────────────────── */}
      <div>
        <label htmlFor="summary" className="block text-sm font-semibold text-gray-900">
          One-line summary <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <p className="mt-0.5 text-xs text-gray-500">
          Plain-language description shown in cards and lists. Up to 500 characters.
        </p>
        <div className="relative mt-2">
          <textarea
            id="summary"
            rows={2}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            maxLength={500}
            placeholder="In plain language, what does this initiative ask for and why does it matter?"
            className="block w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
          />
          <span className={`absolute bottom-2 right-3 text-xs tabular-nums ${summaryLen > 500 ? "text-red-400" : "text-gray-400"}`}>
            {summaryLen}/500
          </span>
        </div>
      </div>

      {/* ── Proposal body ────────────────────────────────────────────── */}
      <div>
        <label htmlFor="body_md" className="block text-sm font-semibold text-gray-900">
          Proposal <span className="text-red-500">*</span>
        </label>
        <p className="mt-0.5 text-xs text-gray-500">
          The full proposal text. Include the problem, proposed action, and intended outcome.
          Markdown is supported.
        </p>
        <div className="mt-2 rounded-lg border border-gray-300 bg-white shadow-sm focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500">
          {/* Toolbar hint */}
          <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-1.5">
            <span className="text-xs text-gray-400">Markdown supported</span>
            <span className="ml-auto text-xs text-gray-400">**bold** _italic_ # Heading</span>
          </div>
          <textarea
            id="body_md"
            rows={14}
            value={bodyMd}
            onChange={(e) => setBodyMd(e.target.value)}
            placeholder={`## Problem\n\nDescribe the problem this initiative addresses...\n\n## Proposed Action\n\nWhat specifically should happen...\n\n## Intended Outcome\n\nWhat will change if this succeeds...`}
            className="block w-full rounded-b-lg px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none resize-y font-mono"
          />
        </div>
      </div>

      {/* ── Scope ────────────────────────────────────────────────────── */}
      <div>
        <label className="block text-sm font-semibold text-gray-900">
          Scope <span className="text-red-500">*</span>
        </label>
        <p className="mt-0.5 text-xs text-gray-500">Which level of government does this target?</p>
        <div className="mt-2 grid grid-cols-3 gap-3">
          {SCOPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setScope(opt.value)}
              className={`rounded-lg border p-3 text-left transition-colors ${
                scope === opt.value
                  ? "border-indigo-500 bg-indigo-50"
                  : "border-gray-200 bg-white hover:border-gray-300"
              }`}
            >
              <div className={`text-sm font-semibold ${scope === opt.value ? "text-indigo-700" : "text-gray-900"}`}>
                {opt.label}
              </div>
              <div className="mt-0.5 text-xs text-gray-500">{opt.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Issue tags ───────────────────────────────────────────────── */}
      <div>
        <label className="block text-sm font-semibold text-gray-900">
          Issue areas <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <p className="mt-0.5 text-xs text-gray-500">
          Select all that apply. Helps citizens find this initiative by topic.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {ISSUE_TAG_OPTIONS.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => toggleTag(tag)}
              className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors ${
                selectedTags.includes(tag)
                  ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
              }`}
            >
              {tag.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      </div>

      {/* ── Error ────────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Quality gate notice ──────────────────────────────────────── */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-xs text-amber-800">
          <span className="font-semibold">Starts as a draft.</span> Your initiative will be saved in
          draft mode. When you&apos;re ready, open it for community deliberation — the community
          will then shape and refine the proposal before it can advance to mobilisation.
        </p>
      </div>

      {/* ── Submit ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 border-t border-gray-200 pt-6">
        <a href="/initiatives" className="text-sm text-gray-500 hover:text-gray-700">
          Cancel
        </a>
        <button
          type="submit"
          disabled={submitting || title.trim().length < 10 || bodyMd.trim().length === 0}
          className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? "Saving…" : "Save draft"}
        </button>
      </div>
    </form>
  );
}
