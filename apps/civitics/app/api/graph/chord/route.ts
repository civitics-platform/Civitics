import { NextResponse } from "next/server";
import { createAdminClient } from "@civitics/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = createAdminClient();

    // Query financial relationships joined with entity tags for industry classification
    const { data, error } = await supabase
      .from("financial_relationships")
      .select(`
        recipient_id,
        amount_cents,
        donor_name
      `)
      .gt("amount_cents", 1000000) // min $10k = 1_000_000 cents
      .limit(1000);

    if (error) {
      console.error("[chord]", error.message);
      return NextResponse.json({ groups: [], matrix: [], data: [] });
    }

    // Return raw data for client-side processing
    return NextResponse.json({ data: data ?? [], count: data?.length ?? 0 });
  } catch (e) {
    console.error("[chord]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
