import { BackendNotConfigured } from "../../../components/BackendNotConfigured";
import { AcademicPage } from "../../../features/academic/AcademicPage";
import { requireRoute } from "../../../lib/session";

export default async function Page() {
  if (!(await requireRoute("/academic"))) return <BackendNotConfigured />;
  return <AcademicPage />;
}
