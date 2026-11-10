import { notFound } from "next/navigation";
import { OpportunityDetail } from "@/features/career/OpportunityDetail";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <OpportunityDetail id={id.toLowerCase()} />;
}
