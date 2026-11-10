import { BackendNotConfigured } from "../../../components/BackendNotConfigured";
import { UsersPage } from "../../../features/users/UsersPage";
import { requireRoute } from "../../../lib/session";

export default async function Page() {
  if (!(await requireRoute("/users"))) return <BackendNotConfigured />;
  return <UsersPage />;
}
