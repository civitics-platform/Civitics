import { cache } from "react";
import { createAdminClient } from "@civitics/db";

// React.cache() dedupes within a single request. generateMetadata() and the
// page component both fetch the official row; without this wrapper, that's
// two identical Supabase round-trips per page render. Keep the column list
// the union of what either caller needs so the cache hit is always a hit.
//
// Uses createAdminClient (no cookies dep) so the function is safe to call
// from generateMetadata, which doesn't have a request scope.

export type CachedOfficial = {
  id: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  role_title: string;
  party: string | null;
  photo_url: string | null;
  email: string | null;
  website_url: string | null;
  phone: string | null;
  district_name: string | null;
  term_start: string | null;
  term_end: string | null;
  is_active: boolean;
  jurisdiction_id: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  jurisdictions: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  governing_bodies: any;
};

export const getCachedOfficial = cache(
  async (id: string): Promise<CachedOfficial | null> => {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("officials")
      .select(
        "id, full_name, first_name, last_name, role_title, party, photo_url, email, website_url, phone, district_name, term_start, term_end, is_active, jurisdiction_id, jurisdictions!jurisdiction_id(name), governing_bodies!governing_body_id(short_name)"
      )
      .eq("id", id)
      .single();
    return (data as CachedOfficial | null) ?? null;
  }
);
