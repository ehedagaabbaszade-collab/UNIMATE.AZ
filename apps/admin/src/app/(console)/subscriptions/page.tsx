import { BackendNotConfigured } from "../../../components/BackendNotConfigured";
import { SubscriptionsPage } from "../../../features/subscriptions/SubscriptionsPage";
import { requireRoute } from "../../../lib/session";

export default async function Page() {
  if (!(await requireRoute("/subscriptions"))) return <BackendNotConfigured />;
  return <SubscriptionsPage />;
}
