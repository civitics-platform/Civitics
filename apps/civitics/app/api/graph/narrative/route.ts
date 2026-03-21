import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createAiClient, MODELS } from "@civitics/ai";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { vizType, entityNames, activeFilters } = await req.json() as {
      vizType: string;
      entityNames: string[];
      activeFilters: string[];
    };

    const entityList = entityNames.length > 0
      ? entityNames.join(", ")
      : "the connection graph";

    const filterList = activeFilters.length > 0
      ? activeFilters.join(", ")
      : "all connection types";

    const client = createAiClient();

    const message = await client.messages.create({
      model: MODELS.haiku,
      max_tokens: 300,
      system: `You are a civic journalist explaining government data to ordinary citizens.
Write clear, factual, neutral narratives. Never editorialize. Never attribute motive.
Only state verifiable facts. Plain language, no jargon. Be concise.`,
      messages: [
        {
          role: "user",
          content: `Write a 2-3 sentence plain language narrative explaining what this civic data visualization shows.

Visualization type: ${vizType}
Focused on: ${entityList}
Active filters: ${filterList}

Be factual and specific. If you don't have enough data to say something specific, describe what this type of visualization generally reveals about civic accountability.

Add a note at the end: "Note: This is an AI-generated summary. Always verify against source data."`,
        },
      ],
    });

    const text = message.content[0]?.type === "text"
      ? message.content[0].text
      : "Unable to generate narrative.";

    return NextResponse.json({ narrative: text });
  } catch (e) {
    console.error("[narrative]", e);
    return NextResponse.json({ error: "Failed to generate narrative" }, { status: 500 });
  }
}
