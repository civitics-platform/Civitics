// Dashboard uses createAdminClient() which needs the secret key — secret key
// is unavailable at Vercel build time, so the page must be force-dynamic to
// avoid build-time evaluation. CDN caching is done via the Cache-Control
// rule for /dashboard in next.config.mjs (30 min s-maxage + SWR), which gives
// us most of the ISR benefit without depending on build-time data fetching.
export const dynamic = "force-dynamic";

import { createAdminClient } from "@civitics/db";
import { PageHeader, TabBar } from "@civitics/ui";
import { DashboardClient } from "./DashboardClient";
import { SitemapSection } from "./SitemapSection";
import { BrowsingFlowsSection, type PathTransition, type EntryPage } from "./BrowsingFlowsSection";
import { ModerationSection } from "./ModerationSection";
import { PageViewTracker } from "../components/PageViewTracker";
import {
  type Db,
  section,
  getVersion,
  getDatabase,
  getPipelines,
  getAiCosts,
  getActivity,
  getOfficialsBreakdown,
  getQuality,
  getSelfTests,
  getChord,
} from "../api/claude/status/_lib/sections";
import type { StatusData } from "./useDashboardData";

export const metadata = { title: "Platform Transparency | Civitics" };

// ── Server-side data fetching ─────────────────────────────────────────────────

type OpenProposal = {
  id: string;
  title: string;
  agency: string;
  comment_period_end: string;
};

async function getOpenProposals(): Promise<OpenProposal[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = createAdminClient() as any;
    const now = new Date().toISOString();
    const in30 = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const { data } = await db
      .from("proposals")
      .select("id,title,metadata,comment_period_end")
      .eq("status", "open_comment")
      .gt("comment_period_end", now)
      .lt("comment_period_end", in30)
      .order("comment_period_end", { ascending: true })
      .limit(3);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).map((p: any) => ({
      id: p.id as string,
      title: p.title as string,
      agency: (p.metadata?.agency_id as string | undefined) ?? "Federal Agency",
      comment_period_end: p.comment_period_end as string,
    }));
  } catch {
    return [];
  }
}

// Pre-fetch the same status payload that useDashboardData would otherwise
// pull client-side via /api/claude/status/{core,quality}. Running these on
// the server, in parallel with the existing dashboard queries, replaces the
// client-side fetch waterfall — DashboardClient receives real numbers as
// props on first paint instead of rendering "Loading…" text and then
// hydrating into a fetch chain.
//
// The platform/usage and platform/anthropic endpoints are NOT prefetched
// here: anthropic hits an external Admin API on every miss (slow + flaky),
// and usage is non-critical for LCP. The hook still pulls them client-side.
async function getInitialStatus(): Promise<StatusData | null> {
  try {
    const db = createAdminClient() as Db;
    const now = new Date();
    const monthStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      1
    ).toISOString();
    const yesterday = new Date(
      now.getTime() - 24 * 60 * 60 * 1000
    ).toISOString();

    const t0 = Date.now();
    const [
      version,
      database,
      pipelines,
      aiCosts,
      activity,
      officialsBreakdown,
      quality,
      selfTests,
      chord,
    ] = await Promise.all([
      section(() => getVersion(db)),
      section(() => getDatabase(db, yesterday)),
      section(() => getPipelines(db)),
      section(() => getAiCosts(db, monthStart)),
      section(() => getActivity(db, yesterday)),
      section(() => getOfficialsBreakdown(db)),
      section(() => getQuality(db)),
      section(() => getSelfTests(db)),
      section(() => getChord(db)),
    ]);

    return {
      meta: {
        query_time_ms: Date.now() - t0,
        timestamp: now.toISOString(),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      version: version as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      database: database as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pipelines: pipelines as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ai_costs: aiCosts as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      quality: quality as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      self_tests: selfTests as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      activity: activity as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      officials_breakdown: officialsBreakdown as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chord: chord as any,
    };
  } catch {
    return null;
  }
}

async function getBrowsingFlows(): Promise<{
  transitions: PathTransition[];
  entryPages: EntryPage[];
}> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = createAdminClient() as any;
    const [{ data: tRows }, { data: eRows }] = await Promise.all([
      db.rpc("get_pv_top_transitions", { lim: 12, min_count: 3, days: 30 }),
      db.rpc("get_pv_entry_pages", { lim: 6, days: 30 }),
    ]);
    type TRow = { from_page: string; to_page: string; sessions: number | string };
    type ERow = { page: string; sessions: number | string };
    const transitions: PathTransition[] = (tRows ?? []).map((r: TRow) => ({
      from_page: r.from_page,
      to_page: r.to_page,
      sessions: Number(r.sessions),
    }));
    const entryPages: EntryPage[] = (eRows ?? []).map((r: ERow) => ({
      page: r.page,
      sessions: Number(r.sessions),
    }));
    return { transitions, entryPages };
  } catch {
    return { transitions: [], entryPages: [] };
  }
}

// ── Tab config ────────────────────────────────────────────────────────────────

const DASHBOARD_TABS = [
  { id: "transparency", label: "Transparency", href: "?tab=transparency" },
  { id: "operations",   label: "Operations",   href: "?tab=operations" },
];

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const tab = searchParams?.tab === "operations" ? "operations" : "transparency";
  const isOps = tab === "operations";

  const [openProposals, browsingFlows, initialStatus] = await Promise.all([
    getOpenProposals(),
    isOps ? getBrowsingFlows() : Promise.resolve({ transitions: [] as PathTransition[], entryPages: [] as EntryPage[] }),
    getInitialStatus(),
  ]);

  return (
    <div className="min-h-screen bg-gray-50">
      <PageViewTracker entityType="dashboard" />
      <main id="main-content">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <PageHeader
            title="Platform Transparency"
            description="Live data on what Civitics tracks, how pipelines are performing, and what the platform costs to run. This page is our receipt."
            breadcrumb={[
              { label: "Civitics", href: "/" },
              { label: "Transparency" },
            ]}
          />

          <div className="mb-6">
            <TabBar tabs={DASHBOARD_TABS} activeTab={tab} />
          </div>

          <DashboardClient
            openProposals={openProposals}
            tab={tab}
            initialStatus={initialStatus}
          />

          {/* Transparency-only: Sitemap */}
          {!isOps && (
            <div className="mt-6">
              <SitemapSection />
            </div>
          )}

          {/* Operations-only: Browsing Flows + Moderation */}
          {isOps && (
            <div className="mt-6 space-y-6">
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <BrowsingFlowsSection
                  transitions={browsingFlows.transitions}
                  entryPages={browsingFlows.entryPages}
                />
              </div>
              <ModerationSection />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
