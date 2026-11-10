import { BackendNotConfigured } from "@/components/BackendNotConfigured";
import { Onboarding } from "@/features/onboarding/Onboarding";
import { LocaleSync } from "@/i18n/LocaleSync";
import { requireSession } from "@/lib/session";

export default async function OnboardingPage() {
  const session = await requireSession();
  if (!session) return <BackendNotConfigured />;
  const p = session.profile;
  return (
    <main className="center-page" id="main">
      <LocaleSync userId={session.user.id} profileLocale={p?.locale ?? null} localeSetAt={p?.locale_set_at ?? null} />
      <div className="um-card" style={{ width: "min(560px, 100%)" }}>
        <Onboarding userId={session.user.id} initial={{ universityId: p?.university_id ?? "", majorId: p?.major_id ?? "", studyYear: p?.study_year ?? null }} />
      </div>
    </main>
  );
}
