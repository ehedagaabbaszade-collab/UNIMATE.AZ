import { BackendNotConfigured } from "../../../components/BackendNotConfigured";
import { PromptsPage } from "../../../features/prompts/PromptsPage";
import { requireRoute } from "../../../lib/session";

export default async function Page() {
  if (!(await requireRoute("/prompts"))) return <BackendNotConfigured />;
  return <PromptsPage />;
}
