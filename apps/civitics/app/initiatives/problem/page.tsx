import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@civitics/db";
import { PostProblemForm } from "./PostProblemForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Post a Problem | Civitics",
  description: "Describe a civic problem — no solution needed yet. The community can help develop one.",
};

export default async function PostProblemPage() {
  const cookieStore = await cookies();
  const supabase = createServerClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in?next=/initiatives/problem");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <main id="main-content" className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-2 text-sm text-gray-500">
          <a href="/initiatives" className="hover:text-gray-900">Initiatives</a>
          <span>/</span>
          <span className="text-gray-900">Post a problem</span>
        </nav>

        {/* Header */}
        <div className="mb-8">
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded-full border border-orange-300 bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-orange-700">
              Problem statement
            </span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Post a problem</h1>
          <p className="mt-2 text-sm text-gray-500 leading-relaxed">
            You don&apos;t need a solution to get started. Describe a civic problem you&apos;ve
            identified — the community can discuss it, validate it, and help develop proposals to
            address it. Problems can be turned into full initiatives when the time is right.
          </p>
        </div>

        {/* Contrast with full initiative */}
        <div className="mb-8 grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
            <p className="font-semibold text-orange-800 mb-1">Problem statement</p>
            <p className="text-orange-700">Just the problem. No solution required. Community helps validate and develop next steps.</p>
          </div>
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
            <a href="/initiatives/new" className="block group">
              <p className="font-semibold text-indigo-800 mb-1 group-hover:underline">Full initiative →</p>
              <p className="text-indigo-700">Have a specific proposal? Start a full initiative with a proposed action and outcome.</p>
            </a>
          </div>
        </div>

        <PostProblemForm />
      </main>
    </div>
  );
}
