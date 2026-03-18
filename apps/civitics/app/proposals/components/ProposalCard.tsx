import { CommentPeriodBadge } from "./CommentPeriodBadge";
import { SubmitCommentButton } from "./SubmitCommentButton";

export type ProposalCardData = {
  id: string;
  title: string;
  type: string;
  status: string;
  regulations_gov_id: string | null;
  congress_gov_url: string | null;
  comment_period_end: string | null;
  summary_plain: string | null;
  introduced_at: string | null;
  metadata: Record<string, string>;
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
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
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

  const summary = proposal.summary_plain?.slice(0, 240) ?? null;

  return (
    <div
      className={`flex flex-col rounded-lg border bg-white p-5 transition-shadow hover:shadow-sm ${
        open ? "border-amber-200" : "border-gray-200"
      }`}
    >
      {/* Badge row */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <span
          className={`rounded border px-2 py-0.5 text-xs font-medium ${statusBadge.color}`}
        >
          {open ? "⏰ " : ""}{statusBadge.label}
        </span>
        {agencyAcronym && (
          <span className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-mono text-gray-600">
            {agencyAcronym}
          </span>
        )}
        {docType && (
          <span className="text-xs text-gray-400">{docType}</span>
        )}
        {!docType && typeLabel && (
          <span className="text-xs text-gray-400">{typeLabel}</span>
        )}
      </div>

      {/* Title */}
      <h3 className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2 mb-2">
        {proposal.title}
      </h3>

      {/* Summary */}
      {summary && (
        <p className="text-xs text-gray-500 leading-relaxed line-clamp-3 mb-3">
          {summary}
          {(proposal.summary_plain?.length ?? 0) > 240 ? "…" : ""}
        </p>
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

        {/* Actions */}
        <div className="flex items-center justify-between gap-2">
          <a
            href={`/proposals/${proposal.id}`}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
          >
            Read more →
          </a>
          {open && (
            <SubmitCommentButton
              regulationsGovId={proposal.regulations_gov_id}
              congressGovUrl={proposal.congress_gov_url}
              size="sm"
            />
          )}
        </div>
      </div>
    </div>
  );
}
