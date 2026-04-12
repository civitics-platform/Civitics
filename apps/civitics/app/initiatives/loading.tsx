// QWEN-ADDED: skeleton loading state for initiatives list (Next.js Suspense fallback)
export default function InitiativesLoading() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 h-8 w-48 animate-pulse rounded bg-gray-200" />
        <div className="mb-6 h-4 w-64 animate-pulse rounded bg-gray-100" />
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-xl border border-gray-200 bg-white"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
