export const dynamic = "force-dynamic";

import { PageViewTracker } from "../components/PageViewTracker";
import { AdvancedSearchPage } from "./components/AdvancedSearchPage";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = await searchParams;
  return (
    <>
      <PageViewTracker entityType="search" />
      <AdvancedSearchPage initialParams={params} />
    </>
  );
}
