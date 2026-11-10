import { BackendNotConfigured } from "../../../components/BackendNotConfigured";
import { JobsPage } from "../../../features/jobs/JobsPage";
import { requireRoute } from "../../../lib/session";

export default async function Page() {
  if (!(await requireRoute("/jobs"))) return <BackendNotConfigured />;
  return <JobsPage />;
}
