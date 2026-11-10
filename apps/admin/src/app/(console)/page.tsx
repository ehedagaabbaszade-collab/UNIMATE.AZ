import { BackendNotConfigured } from "../../components/BackendNotConfigured";
import { Dashboard } from "../../features/dashboard/Dashboard";
import { requireRoute } from "../../lib/session";

export default async function Page() {
  if (!(await requireRoute("/"))) return <BackendNotConfigured />;
  return <Dashboard />;
}
