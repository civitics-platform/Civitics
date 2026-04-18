export const dynamic = "force-dynamic";

import { cookies } from "next/headers";
import { createServerClient, agencyFullName } from "@civitics/db";
import { AgenciesList } from "./components/AgenciesList";
import { AgencyActivityChart } from "./components/AgencyActivityChart";
import { PageViewTracker } from "../components/PageViewTracker";
import { PageHeader } from "@civitics/ui";
import { NavBar } from "../components/NavBar";

export const metadata = { title: "Agencies" };

export type AgencyRow = {
  id: string;
  name: string;
  short_name: string | null;
  acronym: string | null;
  agency_type: string;
  website_url: string | null;
  description: string | null;
  totalProposals: number;
  openProposals: number;
  isFeatured?: boolean;
};

export default async function AgenciesPage() {
  const cookieStore = await cookies();
  const supabase = createServerClient(cookieStore);

  const { data: agencyRows, error } = await supabase
    .from("agencies")
    .select("id, name, short_name, acronym, agency_type, website_url, description, metadata")
    .eq("is_active", true)
    .order("name")
    .limit(200);

  if (error) console.error("agencies fetch error:", error.message);

  const rows = agencyRows ?? [];
  const now = new Date().toISOString();

  // Fetch proposal counts for each agency in parallel
  const statPairs = await Promise.all(
    rows.map((agency) => {
      const key = agency.acronym ?? agency.name;
      return Promise.all([
        supabase
          .from("proposals")
          .select("id", { count: "exact", head: true })
          .filter("metadata->>agency_id", "eq", key),
        supabase
          .from("proposals")
          .select("id", { count: "exact", head: true })
          .filter("metadata->>agency_id", "eq", key)
          .eq("status", "open_comment")
          .gt("comment_period_end", now),
      ]);
    })
  );

  const agencies: AgencyRow[] = rows.map((agency, i) => {
    const pair = statPairs[i];
    const meta = agency.metadata as Record<string, unknown> | null;
    return {
      id: agency.id,
      name: agencyFullName(agency.acronym) ?? agency.name,
      short_name: agency.short_name ?? null,
      acronym: agency.acronym ?? null,
      agency_type: agency.agency_type,
      website_url: agency.website_url ?? null,
      description: agency.description ?? null,
      totalProposals: pair?.[0]?.count ?? 0,
      openProposals: pair?.[1]?.count ?? 0,
      isFeatured: meta?.["is_whitehouse"] === true,
    };
  });

  // Top agencies by proposal count for the activity chart (exclude EOP/featured, min 1 proposal)
  const chartRows = agencies
    .filter((a) => !a.isFeatured && a.totalProposals > 0)
    .sort((a, b) => b.totalProposals - a.totalProposals)
    .slice(0, 12)
    .map((a) => ({ name: a.name, acronym: a.acronym, count: a.totalProposals }));

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <PageViewTracker entityType="agency_list" />
      <main id="main-content">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <PageHeader
          title="Agencies"
          description="Federal agencies, their active rulemaking, and open comment periods."
        />
        <div className="mt-6">
          <AgencyActivityChart rows={chartRows} />
        </div>
      </div>
      <AgenciesList agencies={agencies} />
      </main>
    </div>
  );
}
