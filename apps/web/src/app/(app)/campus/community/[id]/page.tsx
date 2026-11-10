import { notFound } from "next/navigation";
import { CommunityPage } from "@/features/campus/CommunityPage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CampusCommunityPagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <CommunityPage id={id.toLowerCase()} />;
}
