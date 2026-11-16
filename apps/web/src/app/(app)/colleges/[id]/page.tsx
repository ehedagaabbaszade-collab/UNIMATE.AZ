import { CollegePage } from "@/features/colleges/CollegesPage";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CollegePage id={id} />;
}
