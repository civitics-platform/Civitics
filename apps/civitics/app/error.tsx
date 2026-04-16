"use client";
// Next.js App Router requires error boundaries to be client components.
// No NavBar or data-fetching imports — this page renders when the rest of the
// app may be broken.

import { useEffect } from "react";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    // Log to console for debugging (not to an external service in dev)
    console.error("[Civitics] Unhandled error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-10 text-center shadow-sm">

        {/* Icon */}
        <p className="text-5xl mb-6">⚠️</p>

        <h1 className="text-xl font-bold text-gray-900 mb-2">
          Something went wrong
        </h1>
        <p className="text-sm text-gray-500 mb-8">
          An unexpected error occurred. Try refreshing the page or head back home.
        </p>

        {/* Error digest — safe to show in prod, does not expose stack traces */}
        {error.digest && (
          <p className="mb-6 rounded bg-gray-50 px-3 py-2 font-mono text-xs text-gray-400">
            Error code: {error.digest}
          </p>
        )}

        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
          >
            Try again
          </button>
          <a
            href="/"
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}
