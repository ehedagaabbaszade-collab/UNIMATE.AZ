import { BackendNotConfigured } from "../../../components/BackendNotConfigured";
import { ModerationPage } from "../../../features/moderation/ModerationPage";
import { requireRoute } from "../../../lib/session";

export default async function Page() {
  if (!(await requireRoute("/moderation"))) return <BackendNotConfigured />;
  return <ModerationPage />;
}
