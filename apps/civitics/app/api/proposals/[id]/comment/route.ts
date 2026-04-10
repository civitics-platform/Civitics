// QWEN-ADDED: Submits an official comment to regulations.gov and saves the record
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@civitics/db";

export const dynamic = "force-dynamic";

const REGULATIONS_GOV_API = "https://api.regulations.gov/v4/comments";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { comment_text, name, org, regulations_gov_id } = body;

    if (!comment_text || typeof comment_text !== "string" || !comment_text.trim()) {
      return NextResponse.json(
        { error: "comment_text is required" },
        { status: 400 }
      );
    }

    if (!regulations_gov_id) {
      return NextResponse.json(
        { error: "regulations_gov_id is required" },
        { status: 400 }
      );
    }

    const cookieStore = await cookies();
    const supabase = createServerClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();

    const apiKey = process.env.REGULATIONS_GOV_API_KEY;

    // No API key — return fallback URL without calling regulations.gov
    if (!apiKey) {
      const fallback_url = `https://www.regulations.gov/commenton/${regulations_gov_id}`;
      return NextResponse.json({ status: "no_api_key", fallback_url });
    }

    // POST to regulations.gov API
    const regBody = {
      data: {
        attributes: {
          commentOn: regulations_gov_id,
          comment: comment_text,
          submitterType: "INDIVIDUAL",
          firstName: name ?? "",
          organization: org ?? "",
        },
        type: "comments",
      },
    };

    let confirmationNumber: string | undefined;
    let submissionStatus: "submitted" | "failed" = "failed";
    const fallback_url = `https://www.regulations.gov/commenton/${regulations_gov_id}`;

    try {
      const response = await fetch(REGULATIONS_GOV_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": apiKey,
        },
        body: JSON.stringify(regBody),
      });

      if (response.ok) {
        const json = await response.json();
        confirmationNumber = json?.data?.id;
        submissionStatus = "submitted";
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch {
      submissionStatus = "failed";
    }

    // Save to official_comment_submissions only if user is authenticated
    // user_id is NOT NULL in the schema — cannot insert without a user
    if (user) {
      await supabase.from("official_comment_submissions").insert({
        user_id: user.id,
        proposal_id: params.id,
        regulations_gov_id,
        comment_text,
        submitted_at: new Date().toISOString(),
        submission_status: submissionStatus,
        confirmation_number: confirmationNumber ?? null,
        metadata: {
          name: name ?? null,
          org: org ?? null,
          fallback_url: submissionStatus === "failed" ? fallback_url : null,
        },
      });
    }

    if (submissionStatus === "submitted" && confirmationNumber) {
      return NextResponse.json({
        status: "submitted",
        confirmation_number: confirmationNumber,
      });
    }

    return NextResponse.json({
      status: "failed",
      fallback_url,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
