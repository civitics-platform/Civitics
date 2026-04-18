import Link from "next/link";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type InitiativeLink = {
  id:    string;
  title: string;
  stage: "draft" | "deliberate" | "mobilise" | "resolved";
  scope: "federal" | "state" | "local";
  issue_area_tags: string[];
};

// ─── Stage config ──────────────────────────────────────────────────────────────

const STAGE_STYLES: Record<string, { label: string; color: string }> = {
  draft:      { label: "Draft",        color: "bg-gray-100 text-gray-600 border-gray-200" },
  deliberate: { label: "Deliberating", color: "bg-amber-100 text-amber-700 border-amber-200" },
  mobilise:   { label: "Mobilising",   color: "bg-indigo-100 text-indigo-700 border-indigo-200" },
  resolved:   { label: "Resolved",     color: "bg-green-100 text-green-700 border-green-200" },
};

// ─── RelatedInitiatives ────────────────────────────────────────────────────────

interface RelatedInitiativesProps {
  initiatives: InitiativeLink[];
}

export function RelatedInitiatives({ initiatives }: RelatedInitiativesProps) {
  if (initiatives.length === 0) return null;

  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Citizen initiatives</h3>
        <Link
          href="/initiatives"
          className="text-xs text-indigo-600 hover:text-indigo-800"
        >
          Browse all →
        </Link>
      </div>
      <p className="mb-3 text-xs text-gray-500">
        Citizens have linked {initiatives.length} initiative{initiatives.length !== 1 ? "s" : ""} to this proposal.
      </p>
      <div className="space-y-2">
        {initiatives.map((init) => {
          const ss = (STAGE_STYLES[init.stage] ?? STAGE_STYLES.draft)!;
          return (
            <Link
              key={init.id}
              href={`/initiatives/${init.id}`}
              className="block rounded-lg border border-gray-200 bg-white p-3 transition-colors hover:border-indigo-200 hover:bg-indigo-50"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="flex-1 text-sm font-medium text-gray-900 leading-snug line-clamp-2">
                  {init.title}
                </p>
                <span className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${ss.color}`}>
                  {ss.label}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500 capitalize">
                  {init.scope}
                </span>
                {init.issue_area_tags.slice(0, 3).map((t) => (
                  <span key={t} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-600 capitalize">
                    {t.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
