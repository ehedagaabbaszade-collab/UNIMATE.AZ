import { BackendNotConfigured } from "../../../components/BackendNotConfigured";
import { AnalyticsPage } from "../../../features/analytics/AnalyticsPage";
import { requireRoute } from "../../../lib/session";

export default async function Page() {
  if (!(await requireRoute("/analytics"))) return <BackendNotConfigured />;
  return <AnalyticsPage />;
}
