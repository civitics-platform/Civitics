import Link from "next/link";

// ─── Types ───────────────────────────────────────────────────────────────────

export type HomeOfficialCardData = {
  id: string;
  full_name: string;
  role_title: string;
  party: string | null;
  photo_url: string | null;
  chamber: string | null;
  district_name: string | null;
  state_name: string | null;
  isFederal: boolean;
  /** Server-fetched stats — no client queries on the homepage. */
  voteCount: number;
  donorCount: number;
  totalDonationsCents: number;
};

// ─── Style tables ────────────────────────────────────────────────────────────

const PARTY_BORDER: Record<string, string> = {
  democrat:    "border-l-4 border-l-blue-500",
  republican:  "border-l-4 border-l-red-500",
  independent: "border-l-4 border-l-purple-500",
};

const PARTY_BADGE: Record<string, string> = {
  democrat:    "bg-blue-100 text-blue-800",
  republican:  "bg-red-100 text-red-800",
  independent: "bg-purple-100 text-purple-800",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function formatMoney(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(0)}K`;
  if (dollars > 0) return `$${dollars.toLocaleString()}`;
  return "—";
}

// ─── Card ────────────────────────────────────────────────────────────────────

/**
 * Compact, server-rendered variant of OfficialCard used on the homepage.
 * Mirrors the detail card's visual language (party border, federal/state
 * badges, 3-stat bar, "View full profile" footer) but:
 *   - drops the recent-votes list + AI-phase-2 CTA,
 *   - takes stats as props (no client-side Supabase queries),
 *   - renders as a single clickable <Link> → /officials/[id].
 */
export function HomeOfficialCard({ official }: { official: HomeOfficialCardData }) {
  const partyBorder = PARTY_BORDER[official.party ?? ""] ?? "border-l-4 border-l-gray-300";
  const partyBadge  = PARTY_BADGE[official.party ?? ""]  ?? "bg-gray-100 text-gray-700";
  const partyLabel  = official.party
    ? official.party.charAt(0).toUpperCase() + official.party.slice(1)
    : "Unknown";

  return (
    <Link
      href={`/officials/${official.id}`}
      className={`group flex h-full flex-col rounded-lg border border-gray-200 bg-white transition-all hover:border-indigo-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${partyBorder}`}
    >
      {/* Profile header */}
      <div className="flex flex-1 flex-col px-4 py-4">
        <div className="flex items-start gap-3">
          {/* Avatar */}
          {official.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={official.photo_url}
              alt=""
              className="h-12 w-12 shrink-0 rounded-full border-2 border-gray-200 object-cover"
            />
          ) : (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-gray-200 bg-gray-100 text-sm font-bold text-gray-500">
              {initials(official.full_name)}
            </div>
          )}

          {/* Name / role / badges */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1">
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${partyBadge}`}>
                {partyLabel}
              </span>
              {official.chamber && (
                <span className="rounded border border-gray-200 px-1 py-0.5 font-mono text-[9px] text-gray-500">
                  {official.chamber.toUpperCase()}
                </span>
              )}
              {official.isFederal ? (
                <span className="rounded border border-blue-200 bg-blue-50 px-1 py-0.5 text-[9px] font-semibold text-blue-600">
                  Federal
                </span>
              ) : (
                <span className="rounded border border-gray-200 bg-gray-50 px-1 py-0.5 text-[9px] font-semibold text-gray-500">
                  State
                </span>
              )}
            </div>
            <p className="mt-1 truncate text-sm font-semibold leading-tight text-gray-900 group-hover:text-indigo-700">
              {official.full_name}
            </p>
            <p className="truncate text-xs text-gray-500">{official.role_title}</p>
            {(official.state_name || official.district_name) && (
              <p className="truncate text-[11px] text-gray-400">
                {[official.state_name, official.district_name].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        </div>

        <div className="flex-1" />

        {/* Stats bar */}
        <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded border border-gray-100 bg-gray-100">
          <Stat value={official.voteCount > 0 ? official.voteCount.toLocaleString() : "—"} label="Votes" />
          <Stat value={official.donorCount > 0 ? official.donorCount.toLocaleString() : "—"} label="Donors" />
          <Stat value={formatMoney(official.totalDonationsCents)} label="Raised" />
        </div>
      </div>

      {/* Footer CTA */}
      <div className="border-t border-gray-100 bg-gray-50 px-4 py-2 text-center text-[11px] font-medium text-gray-500 group-hover:text-indigo-600 transition-colors">
        View full profile →
      </div>
    </Link>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="bg-white px-2 py-2 text-center">
      <p className="text-sm font-bold text-gray-900">{value}</p>
      <p className="text-[9px] text-gray-400">{label}</p>
    </div>
  );
}
