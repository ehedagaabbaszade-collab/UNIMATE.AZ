import { notFound } from "next/navigation";
import { AssignmentScreen } from "@/features/classes/AssignmentScreen";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ cls?: string }> }) {
  const [{ id }, { cls }] = await Promise.all([params, searchParams]);
  if (!UUID.test(id) || !cls || !UUID.test(cls)) notFound();
  return <AssignmentScreen id={id.toLowerCase()} cls={cls.toLowerCase()} />;
}
