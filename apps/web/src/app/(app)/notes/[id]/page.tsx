import { notFound } from "next/navigation";
import { NoteDetail } from "@/features/notes/NoteDetail";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <NoteDetail id={id.toLowerCase()} />;
}
