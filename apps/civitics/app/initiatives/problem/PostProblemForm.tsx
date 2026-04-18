"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// ─── Constants ────────────────────────────────────────────────────────────────

type Scope = "federal" | "state" | "local";

const SCOPE_OPTIONS: { value: Scope; label: string; description: string }[] = [
  { value: "federal",  label: "Federal",  description: "Congress, federal agencies, or the President" },
  { value: "state",    label: "State",    description: "State legislature or governor" },
  { value: "local",    label: "Local",    description: "City, county, or district officials" },
];

const ISSUE_TAG_OPTIONS = [
  "climate", "healthcare", "education", "housing", "immigration", "finance",
  "energy", "agriculture", "transportation", "labor", "civil_rights",
  "foreign_policy", "criminal_justice", "technology", "consumer_protection",
];

// ─── Component ────────────────────────────────────────────────────────────────

export function PostProblemForm() {
  const router = useRouter();

  const [title, setTitle]               = useState("");
  const [description, setDescription]   = useState("");
  const [scope, setScope]               = useState<Scope>("federal");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [submitting, setSubmitting]     = useState(false);
  const [error, setError]               = useState<string | null>(null);

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (title.trim().length < 10) {
      setError("Problem statement must be at least 10 characters.");
      return;
    }
    if (title.trim().length > 120) {
      setError("Problem statement must be 120 characters or fewer.");
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("/api/initiatives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          summary: description.trim() || undefined,
          body_md: description.trim(),  // store description in body_md; author can expand later
          scope,
          issue_area_tags: selectedTags,
          is_problem: true,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to post problem.");
        setSubmitting(false);
        return;
      }

      router.push(`/initiatives/${data.initiative.id}`);
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  const titleLen = title.length;

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* ── What's the problem? ──────────────────────────────────────── */}
      <div>
        <label htmlFor="title" className="block text-sm font-semibold text-gray-900">
          What&apos;s the problem? <span className="text-red-500">*</span>
        </label>
        <p className="mt-0.5 text-xs text-gray-500">
          State the problem clearly and specifically. (10–120 characters)
        </p>
        <div className="relative mt-2">
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder="e.g. Federal campaign finance disclosures take weeks to appear publicly"
            className="block w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400"
            autoFocus
          />
          <span
            className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs tabular-nums ${
              titleLen > 0 && (titleLen < 10 || titleLen > 120) ? "text-red-400" : "text-gray-400"
            }`}
          >
            {titleLen}/120
          </span>
        </div>
      </div>

      {/* ── More context ─────────────────────────────────────────────── */}
      <div>
        <label htmlFor="description" className="block text-sm font-semibold text-gray-900">
          More context <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <p className="mt-0.5 text-xs text-gray-500">
          Who is affected? How does it happen? Any data or examples? You don&apos;t need a solution yet.
        </p>
        <textarea
          id="description"
          rows={6}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          placeholder={`Describe the problem in more detail...\n\nWho does it affect? Under what circumstances? What evidence exists? What have previous efforts to address it achieved?`}
          className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400 resize-y"
        />
      </div>

      {/* ── Scope ────────────────────────────────────────────────────── */}
      <div>
        <label className="block text-sm font-semibold text-gray-900">
          Scope <span className="text-red-500">*</span>
        </label>
        <p className="mt-0.5 text-xs text-gray-500">Which level of government is most relevant?</p>
        <div className="mt-2 grid grid-cols-3 gap-3">
          {SCOPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setScope(opt.value)}
              className={`rounded-lg border p-3 text-left transition-colors ${
                scope === opt.value
                  ? "border-orange-400 bg-orange-50"
                  : "border-gray-200 bg-white hover:border-gray-300"
              }`}
            >
              <div className={`text-sm font-semibold ${scope === opt.value ? "text-orange-700" : "text-gray-900"}`}>
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
          Helps others find and respond to this problem.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {ISSUE_TAG_OPTIONS.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => toggleTag(tag)}
              className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors ${
                selectedTags.includes(tag)
                  ? "border-orange-400 bg-orange-50 text-orange-700"
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

      {/* ── What happens next ────────────────────────────────────────── */}
      <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
        <p className="text-xs text-orange-800">
          <span className="font-semibold">This posts publicly immediately.</span> The community can
          discuss the problem and help develop solutions. When you&apos;re ready to propose a
          specific action, you can turn it into a full initiative from the problem page.
        </p>
      </div>

      {/* ── Submit ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 border-t border-gray-200 pt-6">
        <a href="/initiatives" className="text-sm text-gray-500 hover:text-gray-700">
          Cancel
        </a>
        <button
          type="submit"
          disabled={submitting || title.trim().length < 10}
          className="rounded-lg bg-orange-500 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? "Posting…" : "Post problem"}
        </button>
      </div>
    </form>
  );
}
