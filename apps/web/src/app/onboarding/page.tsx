import { BackendNotConfigured } from "@/components/BackendNotConfigured";
import { Onboarding } from "@/features/onboarding/Onboarding";
import { AppLogo } from "@/components/brand";
import { LocaleSync } from "@/i18n/LocaleSync";
import { requireSession } from "@/lib/session";

export default async function OnboardingPage() {
  const session = await requireSession();
  if (!session) return <BackendNotConfigured />;
  const p = session.profile;
  return (
    <main className="center-page" id="main">
      <LocaleSync userId={session.user.id} profileLocale={p?.locale ?? null} localeSetAt={p?.locale_set_at ?? null} />
      <div className="brand-screen" style={{ width: "min(560px, 100%)" }}>
        <AppLogo kind="logo" height={96} />
        <div className="um-card" style={{ width: "100%" }}>
          <Onboarding userId={session.user.id} initial={{ universityId: p?.university_id ?? "", majorId: p?.major_id ?? "", studyYear: p?.study_year ?? null }} />
        </div>
      </div>
    </main>
  );
}
