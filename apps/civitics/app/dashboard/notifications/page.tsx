import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@civitics/db";
import { NotificationsClient } from "./NotificationsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const cookieStore = await cookies();
  const supabase = createServerClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in?next=/dashboard/notifications");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <main id="main-content" className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage who you follow and review recent activity.
        </p>
        <NotificationsClient />
      </main>
    </div>
  );
}
