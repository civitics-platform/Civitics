import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@civitics/db";
import { CreateInitiativeForm } from "./CreateInitiativeForm";
import Link from "next/link";
import { AuthButton } from "../../components/AuthButton";
import { GlobalSearch } from "../../components/GlobalSearch";

export const metadata = {
  title: "New Initiative",
};

export const dynamic = "force-dynamic";

export default async function NewInitiativePage() {
  // Server-side auth check — redirect to sign-in if not logged in
  const cookieStore = await cookies();
  const supabase = createServerClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in?next=/initiatives/new");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600">
                <span className="text-xs font-bold text-white">CV</span>
              </div>
              <span className="hidden text-sm font-semibold text-gray-900 sm:block">Civitics</span>
            </Link>
            <nav className="hidden md:flex items-center gap-4">
              {[
                { label: "Officials",   href: "/officials" },
                { label: "Proposals",   href: "/proposals" },
                { label: "Agencies",    href: "/agencies" },
                { label: "Graph",       href: "/graph" },
                { label: "Initiatives", href: "/initiatives" },
              ].map(({ label, href }) => (
                <Link
                  key={href}
                  href={href}
                  className="text-sm font-medium text-gray-600 transition-colors hover:text-gray-900"
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <GlobalSearch variant="nav" />
            <AuthButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-2 text-sm text-gray-500">
          <Link href="/initiatives" className="hover:text-gray-900">Initiatives</Link>
          <span>/</span>
          <span className="text-gray-900">New initiative</span>
        </nav>

        <h1 className="mb-2 text-2xl font-bold text-gray-900">Start a civic initiative</h1>
        <p className="mb-8 text-sm text-gray-500">
          Draft a proposal for community deliberation. It stays in draft until you&apos;re ready
          to open it for discussion.
        </p>

        <CreateInitiativeForm />
      </main>
    </div>
  );
}
