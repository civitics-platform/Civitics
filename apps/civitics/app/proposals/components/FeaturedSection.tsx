"use client";

import { useState } from "react";
import { ProposalCard, type ProposalCardData } from "./ProposalCard";

type Tab = "closing_soon" | "trending" | "most_commented" | "new" | "bills" | "most_viewed";

interface FeaturedSectionProps {
  closingSoon:   ProposalCardData[];
  bills:         ProposalCardData[];
  mostViewed:    ProposalCardData[];
  trending:      ProposalCardData[];
  mostCommented: ProposalCardData[];
  newest:        ProposalCardData[];
}

const TABS: { id: Tab; label: string; icon: string; emptyMsg: string }[] = [
  {
    id:       "closing_soon",
    label:    "Closing Soon",
    icon:     "⏰",
    emptyMsg: "No open comment periods right now.",
  },
  {
    id:       "trending",
    label:    "Trending",
    icon:     "🔥",
    emptyMsg: "No trending proposals in the last 24 hours.",
  },
  {
    id:       "most_commented",
    label:    "Most Commented",
    icon:     "💬",
    emptyMsg: "No proposals have comments yet.",
  },
  {
    id:       "new",
    label:    "New",
    icon:     "✨",
    emptyMsg: "No new proposals.",
  },
  {
    id:       "bills",
    label:    "Congressional Bills",
    icon:     "🏛️",
    emptyMsg: "No congressional bills found.",
  },
  {
    id:       "most_viewed",
    label:    "Most Viewed",
    icon:     "👁",
    emptyMsg: "No view data yet.",
  },
];

export function FeaturedSection({ closingSoon, bills, mostViewed, trending, mostCommented, newest }: FeaturedSectionProps) {
  const [activeTab, setActiveTab] = useState<Tab>("closing_soon");

  const proposals =
    activeTab === "closing_soon"    ? closingSoon
    : activeTab === "trending"      ? trending
    : activeTab === "most_commented" ? mostCommented
    : activeTab === "new"           ? newest
    : activeTab === "bills"         ? bills
    : mostViewed;

  const activeTabMeta = TABS.find((t) => t.id === activeTab)!;

  // Count badge copy per tab
  function badge(tab: Tab): string | null {
    if (tab === "closing_soon" && closingSoon.length > 0)
      return `${closingSoon.length} closing soonest`;
    if (tab === "trending" && trending.length > 0)
      return `${trending.length} hot`;
    if (tab === "most_commented" && mostCommented.length > 0)
      return `${mostCommented.length} discussed`;
    if (tab === "new" && newest.length > 0)
      return `${newest.length} recent`;
    if (tab === "bills" && bills.length > 0)
      return `${bills.length} recent`;
    if (tab === "most_viewed" && mostViewed.length > 0)
      return `${mostViewed.length} proposals`;
    return null;
  }

  return (
    <section aria-labelledby="featured-heading" className="mb-12">
      {/* Tab header */}
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
        <h2 id="featured-heading" className="sr-only">Featured proposals</h2>

        <div
          role="tablist"
          aria-label="Featured proposals"
          className="flex gap-1 flex-wrap"
        >
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            const count = badge(tab.id);
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                aria-controls="featured-tab-panel"
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 ${
                  isActive
                    ? "bg-gray-900 text-white"
                    : "bg-white border border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-900"
                }`}
              >
                <span aria-hidden="true">{tab.icon}</span>
                {tab.label}
                {count && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                      isActive ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Panel */}
      <div
        id="featured-tab-panel"
        role="tabpanel"
        aria-label={activeTabMeta.label}
      >
        {proposals.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {proposals.map((p) => (
              <ProposalCard key={p.id} proposal={p} />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-gray-200 bg-white px-8 py-10 text-center">
            <p className="text-sm text-gray-400">{activeTabMeta.emptyMsg}</p>
          </div>
        )}
      </div>
    </section>
  );
}
