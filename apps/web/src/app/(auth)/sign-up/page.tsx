import { SignUpForm } from "@/features/auth/SignUpForm";
import { parseMode } from "@/lib/mode";

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  return <SignUpForm as={parseMode((await searchParams).as)} />;
}
