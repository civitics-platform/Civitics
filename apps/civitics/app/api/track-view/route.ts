import { NextRequest, NextResponse } from "next/server";
import { userAgent } from "next/server";
import { createAdminClient } from "@civitics/db";

export const dynamic = "force-dynamic";

function parseReferrer(refHeader: string, host: string): string {
  if (!refHeader) return "direct";
  if (refHeader.includes(host)) return "internal";
  if (refHeader.includes("google")) return "google";
  if (refHeader.includes("bing")) return "bing";
  if (refHeader.includes("twitter") || refHeader.includes("x.com")) return "twitter";
  if (refHeader.includes("reddit")) return "reddit";
  if (refHeader.includes("linkedin")) return "linkedin";
  if (refHeader.includes("facebook") || refHeader.includes("fb.com")) return "facebook";
  return "other";
}

export async function POST(request: NextRequest) {
  // Never track in development — keeps local data clean
  if (process.env.NODE_ENV === "development") {
    return NextResponse.json({ ok: true });
  }

  try {
    const body = await request.json() as {
      page: string;
      entity_type?: string;
      entity_id?: string;
      session_id: string;
    };

    const ua = userAgent(request);
    const refHeader = request.headers.get("referer") ?? "";
    const host = request.headers.get("host") ?? "civitics.com";
    const country = request.headers.get("x-vercel-ip-country") ?? null;

    const isBot = ua.isBot;
    // Extract bot name from UA string (first token before /)
    const botName = isBot
      ? (ua.ua?.split("/")?.[0]?.trim() ?? "Unknown bot")
      : null;
    const deviceType = isBot ? null : (ua.device?.type ?? "desktop");
    const browser = isBot ? null : (ua.browser?.name ?? null);

    const db = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).from("page_views").insert({
      page: body.page,
      entity_type: body.entity_type ?? null,
      entity_id: body.entity_id ?? null,
      referrer: parseReferrer(refHeader, host),
      is_bot: isBot,
      bot_name: botName,
      device_type: deviceType,
      browser,
      country_code: country,
      session_id: body.session_id,
    });
  } catch {
    // Tracking must never affect user experience — silently ignore all errors
  }

  return NextResponse.json({ ok: true });
}
