// QWEN-ADDED: Government spending records section for official detail pages

type SpendingRow = {
  id: string;
  recipient_name: string;
  award_type: string | null;
  amount_cents: number;
  award_date: string | null;
  description: string | null;
  awarding_agency: string;
};

function formatMoney(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(0)}K`;
  if (dollars > 0) return `$${dollars.toLocaleString()}`;
  return "$0";
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const AWARD_TYPE_STYLES: Record<string, { label: string; cls: string }> = {
  contract:  { label: 'Contract', cls: 'bg-gray-100 text-gray-600' },
  grant:     { label: 'Grant',    cls: 'bg-green-100 text-green-700' },
  loan:      { label: 'Loan',     cls: 'bg-amber-100 text-amber-700' },
};

/**
 * Server component — data passed as props.
 * Returns null if items.length === 0.
 */
export function SpendingSection({ items }: { items: SpendingRow[] }) {
  if (items.length === 0) return null;

  const totalCents = items.reduce((s, r) => s + r.amount_cents, 0);

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden mb-6">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-900">Government Spending</h2>
          </div>
          <span className="text-sm font-bold text-gray-900">{formatMoney(totalCents)}</span>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-5 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Recipient</th>
              <th className="text-left px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Type</th>
              <th className="text-right px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Amount</th>
              <th className="text-left px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {items.map((row) => {
              const typeStyle = AWARD_TYPE_STYLES[row.award_type ?? ''] ?? { label: row.award_type ?? 'Other', cls: 'bg-gray-100 text-gray-600' };
              return (
                <tr key={row.id} className="hover:bg-gray-50/50">
                  <td className="px-5 py-3">
                    <p className="font-medium text-gray-800 truncate max-w-[200px]">{row.recipient_name}</p>
                    {row.description && (
                      <p className="text-[10px] text-gray-400 truncate max-w-[200px] mt-0.5">{row.description}</p>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${typeStyle.cls}`}>
                      {typeStyle.label}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right font-semibold text-gray-900 tabular-nums">
                    {formatMoney(row.amount_cents)}
                  </td>
                  <td className="px-3 py-3 text-gray-400 tabular-nums">
                    {formatDate(row.award_date)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
