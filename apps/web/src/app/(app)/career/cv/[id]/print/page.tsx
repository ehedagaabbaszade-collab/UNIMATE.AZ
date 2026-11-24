import { notFound } from "next/navigation";
import { CvPrint } from "@/features/career/CvPrint";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CvPrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mode?: string; autoprint?: string }> }) {
  const { id } = await params;
  const q = await searchParams;
  if (!UUID.test(id)) notFound();
  return <CvPrint id={id.toLowerCase()} mode={q.mode === "ats" ? "ats" : "designed"} autoprint={q.autoprint === "1"} />;
}
