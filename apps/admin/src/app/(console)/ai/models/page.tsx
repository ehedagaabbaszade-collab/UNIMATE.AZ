import { BackendNotConfigured } from "../../../../components/BackendNotConfigured";
import { ModelsPage } from "../../../../features/ai/ModelsPage";
import { requireRoute } from "../../../../lib/session";

export default async function Page() {
  if (!(await requireRoute("/ai/models"))) return <BackendNotConfigured />;
  return <ModelsPage />;
}
