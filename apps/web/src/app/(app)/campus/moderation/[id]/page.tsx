import { notFound } from "next/navigation";
import { ModerationPage } from "@/features/campus/ModerationPage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CampusModerationPagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <ModerationPage id={id.toLowerCase()} />;
}
