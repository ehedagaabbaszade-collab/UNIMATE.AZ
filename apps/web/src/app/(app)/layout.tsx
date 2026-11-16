import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { BackendNotConfigured } from "@/components/BackendNotConfigured";
import { ModeProvider, UserProvider } from "@/components/user";
import { LocaleSync } from "@/i18n/LocaleSync";
import { MODE_COOKIE, parseMode } from "@/lib/mode";
import { onboardingSkipped, requireSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  if (!session) return <BackendNotConfigured />;
  if (!session.profile?.university_id && !(await onboardingSkipped())) redirect("/onboarding");
  const mode = parseMode((await cookies()).get(MODE_COOKIE)?.value);
  const displayName = session.profile?.display_name ?? null;
  return (
    <UserProvider user={{ id: session.user.id, email: session.user.email ?? null, displayName }}>
      <LocaleSync userId={session.user.id} profileLocale={session.profile?.locale ?? null} localeSetAt={session.profile?.locale_set_at ?? null} />
      <ModeProvider value={mode}>
        <AppShell mode={mode} displayName={displayName ?? session.user.email ?? null}>{children}</AppShell>
      </ModeProvider>
    </UserProvider>
  );
}
