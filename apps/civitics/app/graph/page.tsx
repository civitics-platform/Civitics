import { GraphPage } from "./GraphPage";
import { PageViewTracker } from "../components/PageViewTracker";

export const metadata = {
  title: "Connection Graph",
  description: "Explore connections between officials, agencies, and legislation.",
};

export default function Page() {
  return (
    <>
      <PageViewTracker entityType="graph" />
      <GraphPage />
    </>
  );
}
