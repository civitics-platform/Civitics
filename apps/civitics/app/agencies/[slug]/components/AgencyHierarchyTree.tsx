type AgencyRef = { id: string; name: string; acronym: string | null };

function Chip({ agency, isCurrent }: { agency: AgencyRef; isCurrent?: boolean }) {
  const label = agency.acronym ?? agency.name.split(" ").map((w) => w[0]).join("").slice(0, 5).toUpperCase();

  if (isCurrent) {
    return (
      <div className="flex items-center gap-2 rounded-lg border-2 border-indigo-300 bg-indigo-50 px-3 py-2">
        <span className="font-mono text-xs font-bold text-indigo-600">{label}</span>
        <span className="text-sm font-semibold text-indigo-900 truncate">{agency.name}</span>
        <span className="ml-auto shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600">
          This agency
        </span>
      </div>
    );
  }

  return (
    <a
      href={`/agencies/${agency.id}`}
      className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 hover:border-indigo-300 hover:shadow-sm transition-all"
    >
      <span className="font-mono text-xs font-bold text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-800 truncate">{agency.name}</span>
      <svg
        className="ml-auto h-3.5 w-3.5 shrink-0 text-gray-300"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </a>
  );
}

export function AgencyHierarchyTree({
  parent,
  current,
  children,
}: {
  parent: AgencyRef | null;
  current: AgencyRef;
  children: AgencyRef[];
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
        Agency Hierarchy
      </p>

      <div className="space-y-1.5">
        {/* Parent row */}
        {parent && (
          <div>
            <Chip agency={parent} />
          </div>
        )}

        {/* Current agency row — indented when there's a parent */}
        <div className={parent ? "flex gap-2" : undefined}>
          {parent && (
            <div className="flex w-5 shrink-0 flex-col items-center">
              <div className="mt-0 w-px flex-1 bg-gray-200" />
              <div className="mb-1 h-3 w-3 rounded-sm border-b-2 border-l-2 border-gray-200" />
            </div>
          )}
          <div className="flex-1">
            <Chip agency={current} isCurrent />
          </div>
        </div>

        {/* Child rows — indented under current */}
        {children.length > 0 && (
          <div className="flex gap-2">
            <div className="flex w-5 shrink-0 flex-col items-center">
              <div className="mt-0 w-px flex-1 bg-gray-200" />
            </div>
            <div className="flex-1 space-y-1.5">
              {children.map((child) => (
                <div key={child.id} className="flex gap-2">
                  <div className="flex w-4 shrink-0 flex-col items-center">
                    <div className="mt-0 w-px flex-1 bg-gray-200" />
                    <div className="mb-1 h-3 w-3 rounded-sm border-b-2 border-l-2 border-gray-200" />
                  </div>
                  <div className="flex-1">
                    <Chip agency={child} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {children.length > 0 && (
        <p className="mt-2 text-[11px] text-gray-400">
          {children.length} sub-{children.length === 1 ? "agency" : "agencies"}
        </p>
      )}
    </div>
  );
}
