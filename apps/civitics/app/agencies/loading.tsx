// QWEN-ADDED: skeleton loading state for agencies list (Next.js Suspense fallback)
export default function AgenciesLoading() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 h-8 w-48 animate-pulse rounded bg-gray-200" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="h-36 animate-pulse rounded-xl border border-gray-200 bg-white"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
