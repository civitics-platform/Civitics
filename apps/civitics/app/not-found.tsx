// Custom 404 page — rendered by Next.js App Router for notFound() calls and missing routes.
// No "use client" — server component. No NavBar or data-fetching imports.

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-10 text-center shadow-sm">

        {/* Large 404 number */}
        <p className="text-8xl font-extrabold text-gray-100 select-none leading-none mb-6">
          404
        </p>

        <h1 className="text-xl font-bold text-gray-900 mb-2">
          Page not found
        </h1>
        <p className="text-sm text-gray-500 mb-8">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>

        {/* Quick-link grid */}
        <div className="grid grid-cols-2 gap-3 mb-8">
          <a
            href="/officials"
            className="rounded-lg border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
          >
            👤 Officials
          </a>
          <a
            href="/proposals"
            className="rounded-lg border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
          >
            📋 Proposals
          </a>
          <a
            href="/agencies"
            className="rounded-lg border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
          >
            🏛 Agencies
          </a>
          <a
            href="/initiatives"
            className="rounded-lg border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
          >
            ✊ Initiatives
          </a>
        </div>

        <a
          href="/"
          className="text-sm font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
        >
          ← Back to Civitics
        </a>
      </div>
    </div>
  );
}
