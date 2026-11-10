import { BackendNotConfigured } from "../../../components/BackendNotConfigured";
import { CareerPage } from "../../../features/career/CareerPage";
import { requireRoute } from "../../../lib/session";

export default async function Page() {
  if (!(await requireRoute("/career"))) return <BackendNotConfigured />;
  return <CareerPage />;
}
