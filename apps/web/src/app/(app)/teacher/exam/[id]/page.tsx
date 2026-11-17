import { notFound } from "next/navigation";
import { ExamEditor } from "@/features/teacher/ExamEditor";

// Exam ids are device-local (newId() or a UUID), or "new".
const ID = /^[\w-]{1,64}$/;

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ID.test(id)) notFound();
  return <ExamEditor id={id} />;
}
