import { parseMode } from "@/lib/mode";
import { SignInForm } from "@/features/auth/SignInForm";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; as?: string }> }) {
  const sp = await searchParams;
  return <SignInForm as={parseMode(sp.as)} {...(sp.next ? { next: sp.next } : {})} callbackError={sp.error === "callback"} />;
}
