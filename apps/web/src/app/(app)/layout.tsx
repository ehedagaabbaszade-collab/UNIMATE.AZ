import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { BackendNotConfigured } from "@/components/BackendNotConfigured";
import { UserProvider } from "@/components/user";
import { LocaleSync } from "@/i18n/LocaleSync";
import { onboardingSkipped, requireSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  if (!session) return <BackendNotConfigured />;
  if (!session.profile?.university_id && !(await onboardingSkipped())) redirect("/onboarding");
  const displayName = session.profile?.display_name ?? null;
  return (
    <UserProvider user={{ id: session.user.id, email: session.user.email ?? null, displayName }}>
      <LocaleSync userId={session.user.id} profileLocale={session.profile?.locale ?? null} localeSetAt={session.profile?.locale_set_at ?? null} />
      <AppShell displayName={displayName ?? session.user.email ?? null}>{children}</AppShell>
    </UserProvider>
  );
}
