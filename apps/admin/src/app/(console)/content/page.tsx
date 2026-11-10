import { BackendNotConfigured } from "../../../components/BackendNotConfigured";
import { ContentPage } from "../../../features/content/ContentPage";
import { requireRoute } from "../../../lib/session";

export default async function Page() {
  if (!(await requireRoute("/content"))) return <BackendNotConfigured />;
  return <ContentPage />;
}
