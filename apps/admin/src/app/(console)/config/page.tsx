import { BackendNotConfigured } from "../../../components/BackendNotConfigured";
import { ConfigPage } from "../../../features/config/ConfigPage";
import { requireRoute } from "../../../lib/session";

export default async function Page() {
  if (!(await requireRoute("/config"))) return <BackendNotConfigured />;
  return <ConfigPage />;
}
