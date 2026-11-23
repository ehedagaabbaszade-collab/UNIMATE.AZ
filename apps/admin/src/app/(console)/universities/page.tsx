import { BackendNotConfigured } from "../../../components/BackendNotConfigured";
import { UniversitiesPage } from "../../../features/universities/UniversitiesPage";
import { requireRoute } from "../../../lib/session";

export default async function Page() {
  if (!(await requireRoute("/universities"))) return <BackendNotConfigured />;
  return <UniversitiesPage />;
}
