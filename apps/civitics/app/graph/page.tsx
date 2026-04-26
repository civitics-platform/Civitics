import { GraphPage } from "./GraphPage";
import { PageViewTracker } from "../components/PageViewTracker";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Connection Graph",
  description: "Explore connections between officials, agencies, and legislation.",
};

export default function Page() {
  const aiEnabled = process.env["AI_SUMMARIES_ENABLED"] !== "false";
  return (
    <>
      <PageViewTracker entityType="graph" />
      <GraphPage aiEnabled={aiEnabled} />
    </>
  );
}
