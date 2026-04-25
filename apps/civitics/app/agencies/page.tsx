export const dynamic = "force-dynamic";

import { cookies } from "next/headers";
import { createServerClient, agencyFullName } from "@civitics/db";
import { AgenciesList } from "./components/AgenciesList";
import { AgencyActivityChart } from "./components/AgencyActivityChart";
import { PageViewTracker } from "../components/PageViewTracker";
import { PageHeader } from "@civitics/ui";

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
};

export default async function AgenciesPage() {
  const cookieStore = await cookies();
  const supabase = createServerClient(cookieStore);

  const [{ data: agencyRows, error }, { data: featuredRow }] = await Promise.all([
    supabase
      .from("agencies")
      .select("id, name, short_name, acronym, agency_type, website_url, description")
      .eq("is_active", true)
      .order("name")
      .limit(200),
    supabase
      .from("agencies")
      .select("id, name, short_name, acronym, agency_type, website_url, description")
      .filter("metadata->>featured", "eq", "true")
      .limit(1)
      .maybeSingle(),
  ]);

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
    };
  });

  const featuredAgency: AgencyRow | null = featuredRow
    ? {
        id:             featuredRow.id,
        name:           agencyFullName(featuredRow.acronym) ?? featuredRow.name,
        short_name:     featuredRow.short_name ?? null,
        acronym:        featuredRow.acronym ?? null,
        agency_type:    featuredRow.agency_type,
        website_url:    featuredRow.website_url ?? null,
        description:    featuredRow.description ?? null,
        totalProposals: agencies.find((a) => a.id === featuredRow.id)?.totalProposals ?? 0,
        openProposals:  agencies.find((a) => a.id === featuredRow.id)?.openProposals ?? 0,
      }
    : null;

  const chartRows = [...agencies]
    .sort((a, b) => b.totalProposals - a.totalProposals)
    .slice(0, 12)
    .map((a) => ({ name: a.name, acronym: a.acronym, count: a.totalProposals }));

  return (
    <div className="min-h-screen bg-gray-50">
      <PageViewTracker entityType="agency_list" />
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <PageHeader
          title="Agencies"
          description="Federal agencies, their active rulemaking, and open comment periods."
          breadcrumb={[
            { label: "Civitics", href: "/" },
            { label: "Agencies" },
          ]}
        />
        <AgencyActivityChart rows={chartRows} />
      </div>
      <AgenciesList agencies={agencies} featuredAgency={featuredAgency} />
    </div>
  );
}
