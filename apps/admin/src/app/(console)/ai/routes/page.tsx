import { BackendNotConfigured } from "../../../../components/BackendNotConfigured";
import { RoutesPage } from "../../../../features/ai/RoutesPage";
import { requireRoute } from "../../../../lib/session";

export default async function Page() {
  if (!(await requireRoute("/ai/routes"))) return <BackendNotConfigured />;
  return <RoutesPage />;
}
