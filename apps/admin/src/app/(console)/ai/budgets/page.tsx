import { BackendNotConfigured } from "../../../../components/BackendNotConfigured";
import { BudgetsPage } from "../../../../features/ai/BudgetsPage";
import { requireRoute } from "../../../../lib/session";

export default async function Page() {
  if (!(await requireRoute("/ai/budgets"))) return <BackendNotConfigured />;
  return <BudgetsPage />;
}
