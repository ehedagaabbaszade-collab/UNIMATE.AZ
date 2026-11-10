import { BackendNotConfigured } from "../../../../components/BackendNotConfigured";
import { CostPage } from "../../../../features/ai/CostPage";
import { requireRoute } from "../../../../lib/session";

export default async function Page() {
  if (!(await requireRoute("/ai/cost"))) return <BackendNotConfigured />;
  return <CostPage />;
}
