export default function GraphLoading() {
  return (
    <div className="flex h-screen flex-col bg-gray-50">
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <div className="h-6 w-40 animate-pulse rounded bg-gray-200" />
        <div className="flex gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-8 w-20 animate-pulse rounded bg-gray-100" />
          ))}
        </div>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div className="hidden w-64 shrink-0 border-r border-gray-200 bg-white p-4 lg:block">
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-9 animate-pulse rounded bg-gray-100" />
            ))}
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="h-full w-full max-w-3xl animate-pulse rounded-lg border border-gray-200 bg-white" />
        </div>
      </div>
    </div>
  );
}
