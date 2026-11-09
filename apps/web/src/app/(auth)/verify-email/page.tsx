import { VerifyNotice } from "@/features/auth/VerifyNotice";

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  return <VerifyNotice {...(email && email.length <= 254 ? { email } : {})} />;
}
