import { notFound } from "next/navigation";
import { DocumentWorkspace } from "@/features/documents/DocumentWorkspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <DocumentWorkspace documentId={id.toLowerCase()} />;
}
