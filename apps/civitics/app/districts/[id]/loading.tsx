export default function DistrictLoading() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-2 h-8 w-64 animate-pulse rounded bg-gray-200" />
        <div className="mb-6 h-4 w-96 max-w-full animate-pulse rounded bg-gray-100" />
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="h-96 animate-pulse rounded-xl border border-gray-200 bg-white" />
          </div>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-32 animate-pulse rounded-xl border border-gray-200 bg-white"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
