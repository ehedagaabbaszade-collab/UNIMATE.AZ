import { BackendNotConfigured } from "../../../components/BackendNotConfigured";
import { AuditPage } from "../../../features/audit/AuditPage";
import { requireRoute } from "../../../lib/session";

export default async function Page() {
  if (!(await requireRoute("/audit"))) return <BackendNotConfigured />;
  return <AuditPage />;
}
