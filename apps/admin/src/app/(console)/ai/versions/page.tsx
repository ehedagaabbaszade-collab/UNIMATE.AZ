import { BackendNotConfigured } from "../../../../components/BackendNotConfigured";
import { VersionsPage } from "../../../../features/ai/VersionsPage";
import { requireRoute } from "../../../../lib/session";

export default async function Page() {
  if (!(await requireRoute("/ai/versions"))) return <BackendNotConfigured />;
  return <VersionsPage />;
}
