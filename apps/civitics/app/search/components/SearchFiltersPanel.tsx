"use client";

import { GroupBrowser } from "@civitics/graph";
import type { FocusGroup } from "@civitics/graph";

// ---------------------------------------------------------------------------
// Filter state type (mirrors the API query params)
// ---------------------------------------------------------------------------

export interface SearchFilters {
  type: string;       // all|officials|proposals|agencies|financial
  party?: string;
  state?: string;
  chamber?: string;   // senate|house
  status?: string;
  proposal_type?: string;
  date_from?: string;
  date_to?: string;
  agency_type?: string;
  entity_type?: string;
  industry?: string;
  min_amount?: string;
  max_amount?: string;
}

interface SearchFiltersPanelProps {
  filters: SearchFilters;
  onFiltersChange: (filters: Partial<SearchFilters>) => void;
}

// ---------------------------------------------------------------------------
// Compute activeGroupIds from current filters (for the GroupBrowser checkmarks)
// ---------------------------------------------------------------------------
function filtersToGroupId(f: SearchFilters): string | null {
  if (f.type === "officials" || f.type === "all") {
    if (f.state)   return `group-state-${f.state}`;
    if (f.party === "democrat"   && f.chamber === "senate") return "group-senate-dems";
    if (f.party === "republican" && f.chamber === "senate") return "group-senate-reps";
    if (f.party === "democrat"   && f.chamber === "house")  return "group-house-dems";
    if (f.party === "republican" && f.chamber === "house")  return "group-house-reps";
    if (f.chamber === "senate"   && !f.party) return "group-full-senate";
    if (f.chamber === "house"    && !f.party) return "group-full-house";
  }
  if (f.type === "agencies") {
    if (!f.party && !f.state) return "group-federal-agencies";
  }
  if ((f.type === "financial" || f.type === "all") && f.industry) {
    return `group-pac-${f.industry.toLowerCase()}`;
  }
  return null;
}

// Map a FocusGroup's filter to SearchFilters
function groupToFilters(group: FocusGroup): Partial<SearchFilters> {
  const f = group.filter;
  const result: Partial<SearchFilters> = {};

  if (f.entity_type === "official") {
    result.type = "officials";
    if (f.party)   result.party   = f.party;
    if (f.state)   result.state   = f.state;
    if (f.chamber) result.chamber = f.chamber;
  } else if (f.entity_type === "pac") {
    result.type = "financial";
    if (f.industry) result.industry = f.industry;
  } else if (f.entity_type === "agency") {
    result.type = "agencies";
  } else if (f.entity_type === "proposal") {
    result.type = "proposals";
    if (f.tag) result.status = f.tag; // topic-tag maps to a proposal filter
  }

  return result;
}

// ---------------------------------------------------------------------------
// Constants for per-type filter pills
// ---------------------------------------------------------------------------

const PARTIES = [
  { value: "democrat",     label: "Democrat",     color: "bg-blue-100 text-blue-700 border-blue-200" },
  { value: "republican",   label: "Republican",   color: "bg-red-100 text-red-700 border-red-200" },
  { value: "independent",  label: "Independent",  color: "bg-purple-100 text-purple-700 border-purple-200" },
];

const CHAMBERS = [
  { value: "senate", label: "Senate" },
  { value: "house",  label: "House" },
];

const PROPOSAL_STATUSES = [
  { value: "open_comment",     label: "Open Comment" },
  { value: "introduced",       label: "Introduced" },
  { value: "in_committee",     label: "In Committee" },
  { value: "passed_committee", label: "Passed Committee" },
  { value: "floor_vote",       label: "Floor Vote" },
  { value: "enacted",          label: "Enacted" },
  { value: "signed",           label: "Signed" },
  { value: "failed",           label: "Failed" },
];

const PROPOSAL_TYPES = [
  { value: "bill",            label: "Bill" },
  { value: "regulation",      label: "Regulation" },
  { value: "executive_order", label: "Executive Order" },
  { value: "resolution",      label: "Resolution" },
  { value: "treaty",          label: "Treaty" },
];

const AGENCY_TYPES = [
  { value: "federal",      label: "Federal" },
  { value: "independent",  label: "Independent" },
  { value: "state",        label: "State" },
  { value: "local",        label: "Local" },
];

const FINANCIAL_ENTITY_TYPES = [
  { value: "pac",         label: "PAC" },
  { value: "super_pac",   label: "Super PAC" },
  { value: "corporation", label: "Corporation" },
  { value: "union",       label: "Union" },
  { value: "party_committee", label: "Party Cmte" },
];

const US_STATES = [
  ["AL","Alabama"], ["AK","Alaska"], ["AZ","Arizona"], ["AR","Arkansas"], ["CA","California"],
  ["CO","Colorado"], ["CT","Connecticut"], ["DE","Delaware"], ["DC","D.C."], ["FL","Florida"],
  ["GA","Georgia"], ["HI","Hawaii"], ["ID","Idaho"], ["IL","Illinois"], ["IN","Indiana"],
  ["IA","Iowa"], ["KS","Kansas"], ["KY","Kentucky"], ["LA","Louisiana"], ["ME","Maine"],
  ["MD","Maryland"], ["MA","Massachusetts"], ["MI","Michigan"], ["MN","Minnesota"],
  ["MS","Mississippi"], ["MO","Missouri"], ["MT","Montana"], ["NE","Nebraska"],
  ["NV","Nevada"], ["NH","New Hampshire"], ["NJ","New Jersey"], ["NM","New Mexico"],
  ["NY","New York"], ["NC","North Carolina"], ["ND","North Dakota"], ["OH","Ohio"],
  ["OK","Oklahoma"], ["OR","Oregon"], ["PA","Pennsylvania"], ["RI","Rhode Island"],
  ["SC","South Carolina"], ["SD","South Dakota"], ["TN","Tennessee"], ["TX","Texas"],
  ["UT","Utah"], ["VT","Vermont"], ["VA","Virginia"], ["WA","Washington"],
  ["WV","West Virginia"], ["WI","Wisconsin"], ["WY","Wyoming"],
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SearchFiltersPanel({ filters, onFiltersChange }: SearchFiltersPanelProps) {
  const activeGroupId = filtersToGroupId(filters);

  function handleGroupSelect(group: FocusGroup) {
    const mapped = groupToFilters(group);
    // If already active, clear those filters
    if (activeGroupId && filtersToGroupId({ ...filters, ...mapped }) === activeGroupId) {
      onFiltersChange({ type: "all", party: undefined, state: undefined, chamber: undefined, industry: undefined });
    } else {
      onFiltersChange(mapped);
    }
  }

  function pill(
    label: string,
    active: boolean,
    onClick: () => void,
    colorClass?: string,
  ) {
    return (
      <button
        key={label}
        onClick={onClick}
        className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors
          ${active
            ? (colorClass ?? "bg-indigo-100 border-indigo-300 text-indigo-700")
            : "bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50"}`}
      >
        {label}
      </button>
    );
  }

  function clearButton(onClick: () => void) {
    return (
      <button onClick={onClick} className="text-[11px] text-gray-400 hover:text-indigo-500 transition-colors ml-auto">
        Clear
      </button>
    );
  }

  const showOfficialFilters = filters.type === "officials" || filters.type === "all";
  const showProposalFilters = filters.type === "proposals";
  const showAgencyFilters   = filters.type === "agencies";
  const showFinancialFilters = filters.type === "financial";

  return (
    <div className="h-full flex flex-col overflow-hidden border-r border-gray-200 bg-white">
      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Taxonomy tree */}
        <div className="pt-2 pb-1">
          <GroupBrowser
            onAddGroup={handleGroupSelect}
            activeGroupIds={activeGroupId ? [activeGroupId] : []}
          />
        </div>

        {/* Per-type filter pills */}
        {(showOfficialFilters || showProposalFilters || showAgencyFilters || showFinancialFilters) && (
          <div className="border-t border-gray-100 px-3 py-3 space-y-4">

            {/* Officials */}
            {showOfficialFilters && (
              <>
                <div>
                  <div className="flex items-center mb-1.5">
                    <span className="text-[10px] uppercase tracking-wide font-semibold text-gray-400">Party</span>
                    {filters.party && clearButton(() => onFiltersChange({ party: undefined }))}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {PARTIES.map(({ value, label, color }) =>
                      pill(label, filters.party === value, () =>
                        onFiltersChange({ party: filters.party === value ? undefined : value }),
                        filters.party === value ? color : undefined,
                      )
                    )}
                  </div>
                </div>

                <div>
                  <div className="flex items-center mb-1.5">
                    <span className="text-[10px] uppercase tracking-wide font-semibold text-gray-400">Chamber</span>
                    {filters.chamber && clearButton(() => onFiltersChange({ chamber: undefined }))}
                  </div>
                  <div className="flex gap-1.5">
                    {CHAMBERS.map(({ value, label }) =>
                      pill(label, filters.chamber === value, () =>
                        onFiltersChange({ chamber: filters.chamber === value ? undefined : value }),
                      )
                    )}
                  </div>
                </div>

                <div>
                  <div className="flex items-center mb-1.5">
                    <span className="text-[10px] uppercase tracking-wide font-semibold text-gray-400">State</span>
                    {filters.state && clearButton(() => onFiltersChange({ state: undefined }))}
                  </div>
                  <select
                    value={filters.state ?? ""}
                    onChange={(e) => onFiltersChange({ state: e.target.value || undefined })}
                    className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  >
                    <option value="">All states</option>
                    {US_STATES.map(([abbr, name]) => (
                      <option key={abbr} value={abbr}>{name} ({abbr})</option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {/* Proposals */}
            {showProposalFilters && (
              <>
                <div>
                  <div className="flex items-center mb-1.5">
                    <span className="text-[10px] uppercase tracking-wide font-semibold text-gray-400">Status</span>
                    {filters.status && clearButton(() => onFiltersChange({ status: undefined }))}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {PROPOSAL_STATUSES.map(({ value, label }) =>
                      pill(label, filters.status === value, () =>
                        onFiltersChange({ status: filters.status === value ? undefined : value }),
                      )
                    )}
                  </div>
                </div>

                <div>
                  <div className="flex items-center mb-1.5">
                    <span className="text-[10px] uppercase tracking-wide font-semibold text-gray-400">Type</span>
                    {filters.proposal_type && clearButton(() => onFiltersChange({ proposal_type: undefined }))}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {PROPOSAL_TYPES.map(({ value, label }) =>
                      pill(label, filters.proposal_type === value, () =>
                        onFiltersChange({ proposal_type: filters.proposal_type === value ? undefined : value }),
                      )
                    )}
                  </div>
                </div>

                <div>
                  <span className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 block mb-1.5">
                    Comment Period
                  </span>
                  <div className="space-y-1.5">
                    <input
                      type="date"
                      value={filters.date_from ?? ""}
                      onChange={(e) => onFiltersChange({ date_from: e.target.value || undefined })}
                      placeholder="From"
                      className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs text-gray-700 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    />
                    <input
                      type="date"
                      value={filters.date_to ?? ""}
                      onChange={(e) => onFiltersChange({ date_to: e.target.value || undefined })}
                      placeholder="To"
                      className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs text-gray-700 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    />
                  </div>
                </div>
              </>
            )}

            {/* Agencies */}
            {showAgencyFilters && (
              <div>
                <div className="flex items-center mb-1.5">
                  <span className="text-[10px] uppercase tracking-wide font-semibold text-gray-400">Type</span>
                  {filters.agency_type && clearButton(() => onFiltersChange({ agency_type: undefined }))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {AGENCY_TYPES.map(({ value, label }) =>
                    pill(label, filters.agency_type === value, () =>
                      onFiltersChange({ agency_type: filters.agency_type === value ? undefined : value }),
                    )
                  )}
                </div>
              </div>
            )}

            {/* Financial */}
            {showFinancialFilters && (
              <>
                <div>
                  <div className="flex items-center mb-1.5">
                    <span className="text-[10px] uppercase tracking-wide font-semibold text-gray-400">Entity Type</span>
                    {filters.entity_type && clearButton(() => onFiltersChange({ entity_type: undefined }))}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {FINANCIAL_ENTITY_TYPES.map(({ value, label }) =>
                      pill(label, filters.entity_type === value, () =>
                        onFiltersChange({ entity_type: filters.entity_type === value ? undefined : value }),
                      )
                    )}
                  </div>
                </div>

                <div>
                  <span className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 block mb-1.5">
                    Amount Range (USD)
                  </span>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={0}
                      placeholder="Min $"
                      value={filters.min_amount ?? ""}
                      onChange={(e) => onFiltersChange({ min_amount: e.target.value || undefined })}
                      className="flex-1 min-w-0 rounded border border-gray-200 px-2 py-1.5 text-xs text-gray-700 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    />
                    <input
                      type="number"
                      min={0}
                      placeholder="Max $"
                      value={filters.max_amount ?? ""}
                      onChange={(e) => onFiltersChange({ max_amount: e.target.value || undefined })}
                      className="flex-1 min-w-0 rounded border border-gray-200 px-2 py-1.5 text-xs text-gray-700 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
