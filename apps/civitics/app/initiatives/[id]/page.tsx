import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { cookies } from "next/headers";
import { createServerClient } from "@civitics/db";
import { AuthButton } from "../../components/AuthButton";
import { GlobalSearch } from "../../components/GlobalSearch";
import { PageViewTracker } from "../../components/PageViewTracker";
import { UpvoteButton } from "./components/UpvoteButton";
import { VersionHistory } from "./components/VersionHistory";
import { InlineEditor } from "./components/InlineEditor";
import { ArgumentBoard } from "./components/ArgumentBoard";
import { QualityGate } from "./components/QualityGate";
import { SignaturePanel } from "./components/SignaturePanel";
import { ResponseWindowStatus, type ResponseRow } from "./components/ResponseWindowStatus";
import { FollowButton } from "./components/FollowButton";
import { InitiativeCommentPanel, type CommentableProposal } from "./components/InitiativeCommentPanel";

export const dynamic = "force-dynamic";

export async function generateStaticParams() {
  return [];
}

// QWEN-ADDED: SEO/OG metadata for initiative detail pages
export async function generateMetadata(
  { params }: { params: { id: string } }
): Promise<Metadata> {
  const cookieStore = await cookies();
  const supabase = createServerClient(cookieStore);
  const { data } = await supabase
    .from("civic_initiatives")
    .select("title, summary, stage, scope")
    .eq("id", params.id)
    .single();

  if (!data) return { title: "Initiative | Civitics" };

  const description = data.summary
    ? data.summary.slice(0, 160)
    : `${data.scope} · ${data.stage}`;

  return {
    title: data.title,
    description,
    openGraph: {
      title: `${data.title} | Civitics`,
      description,
    },
  };
}

// ─── Types ────────────────────────────────────────────────────────────────────

type InitiativeDetail = {
  id: string;
  title: string;
  summary: string | null;
  body_md: string;
  stage: "draft" | "deliberate" | "mobilise" | "resolved";
  scope: "federal" | "state" | "local";
  authorship_type: "individual" | "community";
  primary_author_id: string | null;
  issue_area_tags: string[];
  target_district: string | null;
  quality_gate_score: Record<string, unknown>;
  mobilise_started_at: string | null;
  resolved_at: string | null;
  resolution_type: string | null;
  created_at: string;
  updated_at: string;
};


// ─── Constants ────────────────────────────────────────────────────────────────

const STAGE_STYLES: Record<string, { label: string; color: string; description: string }> = {
  draft:      { label: "Draft",        color: "bg-gray-100 text-gray-700 border-gray-200",   description: "Private draft — only visible to you" },
  deliberate: { label: "Deliberating", color: "bg-amber-100 text-amber-700 border-amber-200", description: "Open for community deliberation" },
  mobilise:   { label: "Mobilising",   color: "bg-indigo-100 text-indigo-700 border-indigo-200", description: "Gathering signatures" },
  resolved:   { label: "Resolved",     color: "bg-green-100 text-green-700 border-green-200", description: "Resolved" },
};


// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function renderMarkdown(md: string): string {
  // Very lightweight Markdown → HTML (server-side, no deps)
  return md
    .split("\n")
    .map((line) => {
      if (/^### /.test(line)) return `<h3 class="text-base font-bold text-gray-900 mt-5 mb-1">${line.slice(4)}</h3>`;
      if (/^## /.test(line))  return `<h2 class="text-lg font-bold text-gray-900 mt-6 mb-2">${line.slice(3)}</h2>`;
      if (/^# /.test(line))   return `<h1 class="text-xl font-bold text-gray-900 mt-6 mb-2">${line.slice(2)}</h1>`;
      if (/^- /.test(line))   return `<li class="ml-4 text-gray-700">${line.slice(2)}</li>`;
      if (line.trim() === "") return "<br/>";
      // Bold + italic inline
      const processed = line
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/_(.+?)_/g, "<em>$1</em>");
      return `<p class="text-gray-700 leading-relaxed">${processed}</p>`;
    })
    .join("\n");
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function InitiativeDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;

  const cookieStore = await cookies();
  const supabase = createServerClient(cookieStore);

  // Fetch initiative + counts in parallel
  const [initiativeRes, { data: { user } }, totalSigsRes, verifiedSigsRes, upvoteRes, followRes, linkedProposalsRes] =
    await Promise.all([
      supabase.from("civic_initiatives").select("*").eq("id", id).single(),
      supabase.auth.getUser(),
      supabase
        .from("civic_initiative_signatures")
        .select("*", { count: "exact", head: true })
        .eq("initiative_id", id),
      supabase
        .from("civic_initiative_signatures")
        .select("*", { count: "exact", head: true })
        .eq("initiative_id", id)
        .eq("verification_tier", "district"),
      supabase
        .from("civic_initiative_upvotes")
        .select("*", { count: "exact", head: true })
        .eq("initiative_id", id),
      supabase
        .from("civic_initiative_follows")
        .select("*", { count: "exact", head: true })
        .eq("initiative_id", id),
      supabase
        .from("civic_initiative_proposal_links")
        .select("proposal_id, proposals!proposal_id(id, title, bill_number, short_title, status, regulations_gov_id, congress_gov_url, comment_period_end)")
        .eq("initiative_id", id)
        .limit(10),
    ]);

  if (initiativeRes.error || !initiativeRes.data) {
    notFound();
  }

  const initiative = initiativeRes.data as InitiativeDetail;
  const isAuthor = user?.id === initiative.primary_author_id;
  const canEdit = isAuthor && (initiative.stage === "draft" || initiative.stage === "deliberate");
  const stageStyle = STAGE_STYLES[initiative.stage] ?? STAGE_STYLES.draft;
  const upvoteCount   = upvoteRes.count ?? 0;
  const followCount   = followRes.count ?? 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linkedProposals = ((linkedProposalsRes.data ?? []) as any[])
    .map((row) => row.proposals)
    .filter(Boolean) as CommentableProposal[];

  // Fetch official responses
  const { data: responses } = await supabase
    .from("civic_initiative_responses")
    .select("id,official_id,response_type,body_text,committee_referred,window_opened_at,window_closes_at,responded_at,is_verified_staff")
    .eq("initiative_id", id);

  const officialResponses = (responses ?? []) as ResponseRow[];

  return (
    <div className="min-h-screen bg-gray-50">
      <PageViewTracker entityType="initiative" entityId={id} />

      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600">
                <span className="text-xs font-bold text-white">CV</span>
              </div>
              <span className="hidden text-sm font-semibold text-gray-900 sm:block">Civitics</span>
            </Link>
            <nav className="hidden md:flex items-center gap-4">
              {[
                { label: "Officials",   href: "/officials" },
                { label: "Proposals",   href: "/proposals" },
                { label: "Agencies",    href: "/agencies" },
                { label: "Graph",       href: "/graph" },
                { label: "Initiatives", href: "/initiatives" },
              ].map(({ label, href }) => (
                <Link
                  key={href}
                  href={href}
                  className={`text-sm font-medium transition-colors ${
                    href === "/initiatives"
                      ? "text-indigo-600"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <GlobalSearch variant="nav" />
            <AuthButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-2 text-sm text-gray-500">
          <Link href="/initiatives" className="hover:text-gray-900">Initiatives</Link>
          <span>/</span>
          <span className="line-clamp-1 text-gray-900">{initiative.title}</span>
        </nav>

        <div className="lg:grid lg:grid-cols-[1fr_280px] lg:gap-8">
          {/* ── Main column ──────────────────────────────────────────── */}
          <div>
            {/* Header */}
            <div className="mb-6">
              {/* Stage + badges */}
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${stageStyle.color}`}>
                  {stageStyle.label}
                </span>
                <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 capitalize">
                  {initiative.scope}
                </span>
                {initiative.authorship_type === "community" && (
                  <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                    Community
                  </span>
                )}
                {initiative.issue_area_tags.map((t) => (
                  <Link
                    key={t}
                    href={`/initiatives?tag=${t}`}
                    className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600 capitalize hover:bg-gray-200"
                  >
                    {t.replace(/_/g, " ")}
                  </Link>
                ))}
              </div>

              {/* Title + edit button */}
              <div className="flex items-start justify-between gap-3">
                <h1 className="text-2xl font-bold text-gray-900 leading-tight">
                  {initiative.title}
                </h1>
                {canEdit && (
                  <div className="relative flex-shrink-0 pt-0.5">
                    <InlineEditor
                      initiativeId={initiative.id}
                      currentTitle={initiative.title}
                      currentSummary={initiative.summary}
                      currentBody={initiative.body_md}
                      currentScope={initiative.scope}
                      currentTags={initiative.issue_area_tags}
                    />
                  </div>
                )}
              </div>

              {/* Summary */}
              {initiative.summary && (
                <p className="mt-2 text-base text-gray-600 leading-relaxed">
                  {initiative.summary}
                </p>
              )}

              {/* Meta */}
              <p className="mt-3 text-xs text-gray-400">
                Started {formatDate(initiative.created_at)}
                {initiative.updated_at !== initiative.created_at && (
                  <> · Updated {formatDate(initiative.updated_at)}</>
                )}
                {initiative.target_district && (
                  <> · {initiative.target_district}</>
                )}
              </p>
            </div>

            {/* Stage description banner */}
            {initiative.stage === "draft" && isAuthor && (
              <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-amber-800">
                  <span className="font-semibold">This is a private draft.</span> Only you can see it.
                  Edit the proposal until you&apos;re ready to open it for deliberation.
                </p>
              </div>
            )}

            {/* Quality gate — shown to author on draft + deliberate stages */}
            {isAuthor && (initiative.stage === "draft" || initiative.stage === "deliberate") && (
              <QualityGate
                initiativeId={initiative.id}
                currentStage={initiative.stage}
              />
            )}

            {/* Proposal body */}
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">
                Proposal
              </h2>
              <div
                className="prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(initiative.body_md) }}
              />
            </div>

            {/* Official response windows */}
            <ResponseWindowStatus
              initiativeId={id}
              responses={officialResponses}
            />

            {/* Official comment submission — shown in mobilise stage when linked proposals have open dockets */}
            {initiative.stage === "mobilise" && (
              <InitiativeCommentPanel
                initiativeTitle={initiative.title}
                initiativeSummary={initiative.summary}
                proposals={linkedProposals}
              />
            )}

            {/* Version history */}
            {/* Argument board */}
            <ArgumentBoard
              initiativeId={initiative.id}
              stage={initiative.stage}
              currentUserId={user?.id ?? null}
            />

            <VersionHistory initiativeId={initiative.id} />
          </div>

          {/* ── Sidebar ──────────────────────────────────────────────── */}
          <aside className="mt-8 space-y-4 lg:mt-0">
            {/* Upvote + follow card */}
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <p className="mb-3 text-sm font-semibold text-gray-900">Support this initiative</p>
              <UpvoteButton initiativeId={initiative.id} initialCount={upvoteCount} />
              <p className="mt-2 text-xs text-gray-400">
                Upvotes help advance to deliberation.
              </p>
              <div className="mt-3 border-t border-gray-100 pt-3">
                <FollowButton initiativeId={initiative.id} initialCount={followCount} />
                <p className="mt-1.5 text-xs text-gray-400">
                  Follow to get updates on this initiative.
                </p>
              </div>
            </div>

            {/* Signature panel (shown in mobilise stage) */}
            {initiative.stage === "mobilise" && (
              <SignaturePanel
                initiativeId={initiative.id}
                mobiliseStartedAt={initiative.mobilise_started_at}
                initialTotal={totalSigsRes.count ?? 0}
                initialConstituent={verifiedSigsRes.count ?? 0}
              />
            )}

            {/* Meta card */}
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <p className="mb-3 text-sm font-semibold text-gray-900">Details</p>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-500">Stage</dt>
                  <dd className="font-medium text-gray-900 capitalize">{initiative.stage}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Scope</dt>
                  <dd className="font-medium text-gray-900 capitalize">{initiative.scope}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Authorship</dt>
                  <dd className="font-medium text-gray-900 capitalize">{initiative.authorship_type}</dd>
                </div>
                {initiative.target_district && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">District</dt>
                    <dd className="font-medium text-gray-900">{initiative.target_district}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-gray-500">Started</dt>
                  <dd className="font-medium text-gray-900">{formatDate(initiative.created_at)}</dd>
                </div>
              </dl>
            </div>
            {/* Linked proposals */}
            {linkedProposals.length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <p className="mb-3 text-sm font-semibold text-gray-900">Linked legislation</p>
                <div className="space-y-2">
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {linkedProposals.map((p: any) => (
                    <a
                      key={p.id}
                      href={`/proposals/${p.id}`}
                      className="block rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs transition-colors hover:border-indigo-200 hover:bg-indigo-50"
                    >
                      <span className="font-medium text-gray-800 line-clamp-2">
                        {p.bill_number ? `${p.bill_number} · ` : ""}{p.short_title ?? p.title}
                      </span>
                      <span className="mt-0.5 block capitalize text-gray-400">{p.status?.replace(/_/g, " ")}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
