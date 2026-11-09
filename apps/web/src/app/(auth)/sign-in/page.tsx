import { SignInForm } from "@/features/auth/SignInForm";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  return <SignInForm {...(sp.next ? { next: sp.next } : {})} callbackError={sp.error === "callback"} />;
}
