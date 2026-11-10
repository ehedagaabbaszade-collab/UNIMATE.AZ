import { notFound } from "next/navigation";
import { UserPage } from "@/features/campus/UserPage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CampusUserPagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <UserPage id={id.toLowerCase()} />;
}
