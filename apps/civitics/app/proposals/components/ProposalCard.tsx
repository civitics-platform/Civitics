"use client";

import Link from "next/link";
import { CommentPeriodBadge } from "./CommentPeriodBadge";
import { SubmitCommentButton } from "./SubmitCommentButton";
import { EntityTags, type EntityTag } from "../../components/tags/EntityTags";
import { ProposalShareButton } from "./ProposalShareButton";

export type ProposalCardData = {
  id: string;
  title: string;
  type: string;
  status: string;
  regulations_gov_id: string | null;
  congress_gov_url: string | null;
  comment_period_end: string | null;
  summary_plain: string | null;
  summary_model: string | null;
  introduced_at: string | null;
  metadata: Record<string, string>;
  // Resolved at query time by the page
  agency_name?: string | null;
  ai_summary?: string | null;
  tags?: EntityTag[];
};

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  open_comment:         { label: "Open for Comment", color: "bg-amber-100 text-amber-800 border-amber-200" },
  introduced:           { label: "Introduced",       color: "bg-blue-100 text-blue-800 border-blue-200" },
  in_committee:         { label: "In Committee",     color: "bg-blue-100 text-blue-800 border-blue-200" },
  passed_committee:     { label: "Passed Committee", color: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  floor_vote:           { label: "Floor Vote",       color: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  passed_chamber:       { label: "Passed Chamber",   color: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  passed_both_chambers: { label: "Passed Both",      color: "bg-violet-100 text-violet-800 border-violet-200" },
  signed:               { label: "Signed",           color: "bg-green-100 text-green-800 border-green-200" },
  enacted:              { label: "Enacted",          color: "bg-green-100 text-green-800 border-green-200" },
  failed:               { label: "Failed",           color: "bg-red-100 text-red-800 border-red-200" },
  withdrawn:            { label: "Withdrawn",        color: "bg-gray-100 text-gray-600 border-gray-200" },
  comment_closed:       { label: "Comment Closed",   color: "bg-gray-100 text-gray-600 border-gray-200" },
};

const TYPE_LABEL: Record<string, string> = {
  regulation:      "Federal Regulation",
  bill:            "Congressional Bill",
  executive_order: "Executive Order",
  treaty:          "Treaty",
  referendum:      "Referendum",
  resolution:      "Resolution",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  // timeZone: "UTC" ensures server (Node UTC) and browser produce identical output
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function isOpenForComment(p: ProposalCardData): boolean {
  return (
    p.status === "open_comment" &&
    !!p.comment_period_end &&
    new Date(p.comment_period_end) > new Date()
  );
}

export function ProposalCard({ proposal }: { proposal: ProposalCardData }) {
  const statusBadge = STATUS_BADGE[proposal.status] ?? {
    label: proposal.status,
    color: "bg-gray-100 text-gray-600 border-gray-200",
  };
  const typeLabel = TYPE_LABEL[proposal.type] ?? proposal.type;
  const agencyAcronym = proposal.metadata?.agency_id ?? null;
  const docType = proposal.metadata?.document_type ?? null;
  const open = isOpenForComment(proposal);

  // Summary: prefer cached AI summary, fall back to summary_plain
  const summaryText = proposal.ai_summary ?? proposal.summary_plain ?? null;
  const isAiSummary = !!proposal.ai_summary || !!proposal.summary_model;
  const summaryTruncated = summaryText
    ? summaryText.length > 150
      ? summaryText.slice(0, 150) + "…"
      : summaryText
    : null;

  // ── Overlay pattern ───────────────────────────────────────────────────────
  // SubmitCommentButton renders as <a>, so wrapping the whole card in <Link>
  // (also <a>) creates nested <a> tags — invalid HTML that browsers auto-correct,
  // breaking hydration. Instead: card content lives in a plain <div>; an
  // absolutely-positioned invisible <Link> covers the whole card surface.
  // Action buttons use `relative z-10` to sit above the overlay and receive
  // their own clicks normally.
  return (
    <div className="relative group h-full">
      {/* Card content — NOT inside any <a> */}
      <div
        suppressHydrationWarning
        className={`flex flex-col h-full rounded-lg border bg-white p-5 transition-all group-hover:shadow-md group-hover:border-gray-300 cursor-pointer ${
          open ? "border-amber-200" : "border-gray-200"
        }`}
      >
        {/* Badge row */}
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <span
            suppressHydrationWarning
            className={`rounded border px-2 py-0.5 text-xs font-medium ${statusBadge.color}`}
          >
            {open ? "⏰ " : ""}{statusBadge.label}
          </span>
          {docType && (
            <span className="text-xs text-gray-400">{docType}</span>
          )}
          {!docType && typeLabel && (
            <span className="text-xs text-gray-400">{typeLabel}</span>
          )}
        </div>

        {/* Agency — link filters proposals list to this agency */}
        {agencyAcronym && (
          <div className="flex items-center gap-1.5 mb-2 relative z-10">
            <a
              href={`/proposals?agency=${encodeURIComponent(agencyAcronym)}`}
              className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-mono font-semibold text-gray-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
              title={proposal.agency_name ? `View all ${proposal.agency_name} proposals` : `View all ${agencyAcronym} proposals`}
              onClick={(e) => e.stopPropagation()}
            >
              {agencyAcronym}
            </a>
            {proposal.agency_name && (
              <span className="text-xs text-gray-400 truncate" title={proposal.agency_name}>
                ·{" "}
                {proposal.agency_name.length > 40
                  ? proposal.agency_name.slice(0, 40) + "…"
                  : proposal.agency_name}
              </span>
            )}
          </div>
        )}

        {/* Title */}
        <h3 className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2 mb-2 group-hover:text-indigo-700 transition-colors">
          {proposal.title}
        </h3>

        {/* Summary */}
        {summaryTruncated && (
          <div className="mb-3">
            {isAiSummary && (
              <span className="inline-block rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600 mb-1">
                AI summary
              </span>
            )}
            <p className="text-xs text-gray-500 leading-relaxed line-clamp-3">
              {summaryTruncated}
            </p>
          </div>
        )}

        {/* Tags */}
        {proposal.tags && proposal.tags.length > 0 && (
          <EntityTags
            entityType="proposal"
            entityId={proposal.id}
            tags={proposal.tags}
            variant="compact"
          />
        )}

        <div className="mt-auto space-y-3">
          {/* Deadline badge */}
          {open && proposal.comment_period_end && (
            <CommentPeriodBadge
              commentPeriodEnd={proposal.comment_period_end}
              compact
            />
          )}
          {!open && proposal.introduced_at && (
            <p className="text-xs text-gray-400">
              Introduced {formatDate(proposal.introduced_at)}
            </p>
          )}

          {/* Action row — relative z-10 lifts these above the card overlay link */}
          <div className="relative z-10 flex items-center gap-2">
            {open && (
              <SubmitCommentButton
                regulationsGovId={proposal.regulations_gov_id}
                congressGovUrl={proposal.congress_gov_url}
                size="sm"
                stopPropagation
              />
            )}
            <ProposalShareButton title={proposal.title} id={proposal.id} stopPropagation />
          </div>
        </div>
      </div>

      {/* Invisible full-card link overlay. Positioned after content so it
          stacks above the static card div; action buttons (z-10) stay on top. */}
      <Link
        href={`/proposals/${proposal.id}`}
        className="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        aria-label={proposal.title}
      />
    </div>
  );
}
