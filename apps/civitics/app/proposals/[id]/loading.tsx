export default function ProposalDetailLoading() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 space-y-2">
          <div className="h-5 w-32 animate-pulse rounded bg-gray-200" />
          <div className="h-9 w-3/4 animate-pulse rounded bg-gray-200" />
          <div className="flex gap-2">
            <div className="h-6 w-20 animate-pulse rounded-full bg-gray-100" />
            <div className="h-6 w-24 animate-pulse rounded-full bg-gray-100" />
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <div className="h-48 animate-pulse rounded-xl border border-gray-200 bg-white" />
            <div className="h-64 animate-pulse rounded-xl border border-gray-200 bg-white" />
            <div className="h-96 animate-pulse rounded-xl border border-gray-200 bg-white" />
          </div>
          <div className="space-y-4">
            <div className="h-48 animate-pulse rounded-xl border border-gray-200 bg-white" />
            <div className="h-32 animate-pulse rounded-xl border border-gray-200 bg-white" />
          </div>
        </div>
      </div>
    </div>
  );
}
