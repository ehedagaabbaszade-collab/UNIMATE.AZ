import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { BackendNotConfigured } from "@/components/BackendNotConfigured";
import { UserProvider } from "@/components/user";
import { onboardingSkipped, requireSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  if (!session) return <BackendNotConfigured />;
  if (!session.profile?.university_id && !(await onboardingSkipped())) redirect("/onboarding");
  const displayName = session.profile?.display_name ?? null;
  return (
    <UserProvider user={{ id: session.user.id, email: session.user.email ?? null, displayName }}>
      <AppShell displayName={displayName ?? session.user.email ?? null}>{children}</AppShell>
    </UserProvider>
  );
}
