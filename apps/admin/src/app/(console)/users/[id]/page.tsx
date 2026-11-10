import { notFound } from "next/navigation";
import { BackendNotConfigured } from "../../../../components/BackendNotConfigured";
import { UserDetail } from "../../../../features/users/UserDetail";
import { requireRoute } from "../../../../lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  if (!(await requireRoute("/users"))) return <BackendNotConfigured />;
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <UserDetail userId={id.toLowerCase()} />;
}
