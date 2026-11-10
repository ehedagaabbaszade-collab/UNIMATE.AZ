import type { Locale } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { LanguageSelector } from "../../src/components/LanguageSelector";
import { PickerField } from "../../src/components/PickerField";
import { AppText, Button, Card, Notice, Screen, Segmented } from "../../src/components/ui";
import { AcademicPicker, type AcademicValue } from "../../src/features/academic/AcademicPicker";
import { KEYS, kv, onboardingSkipKey } from "../../src/lib/storage";
import { useUser, useSession } from "../../src/state/session";

const GOALS = ["goalGpa", "goalExams", "goalOrganise", "goalNotes"] as const;
const STEPS = 4;

export default function Onboarding() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { user, profile, supabase } = useUser();
  const { refreshProfile } = useSession();
  const [step, setStep] = useState(0);
  const [academic, setAcademic] = useState<AcademicValue>({ universityId: profile?.university_id ?? "", facultyId: "", majorId: profile?.major_id ?? "" });
  const [year, setYear] = useState(profile?.study_year ? String(profile.study_year) : "");
  const [goals, setGoals] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const leave = async (persistSkip: boolean) => {
    if (persistSkip) await kv.setItem(onboardingSkipKey(user.id), "1").catch(() => undefined);
    await refreshProfile();
    router.replace("/");
  };

  async function finish() {
    setBusy(true);
    setError(false);
    const { error: err } = await supabase
      .from("profiles")
      .update({ locale: locale as Locale, university_id: academic.universityId || null, major_id: academic.majorId || null, study_year: year ? Number(year) : null })
      .eq("id", user.id);
    if (err) {
      setBusy(false);
      return setError(true);
    }
    await kv.setItem(`${KEYS.theme}.goals`, JSON.stringify(goals)).catch(() => undefined); // goals stay on the device: no DB field
    setBusy(false);
    await leave(true);
  }

  return (
    <Screen>
      <AppText variant="title" accessibilityRole="header">
        {t("onboarding.title")}
      </AppText>
      <AppText muted accessibilityLiveRegion="polite">
        {t("onboarding.step", { a: step + 1, b: STEPS })}
      </AppText>

      {step === 0 ? (
        <Card>
          <AppText variant="heading">{t("onboarding.languageTitle")}</AppText>
          <LanguageSelector />
        </Card>
      ) : null}
      {step === 1 ? (
        <Card>
          <AppText variant="heading">{t("onboarding.universityTitle")}</AppText>
          <AcademicPicker value={academic} onChange={setAcademic} showMajor={false} />
        </Card>
      ) : null}
      {step === 2 ? (
        <Card>
          <AppText variant="heading">{t("onboarding.majorTitle")}</AppText>
          <AcademicPicker value={academic} onChange={setAcademic} />
          <PickerField label={t("onboarding.studyYear")} sections={[{ data: [1, 2, 3, 4, 5, 6].map((y) => ({ id: String(y), label: String(y) })) }]} value={year} onChange={setYear} />
        </Card>
      ) : null}
      {step === 3 ? (
        <Card>
          <AppText variant="heading">{t("onboarding.goalsTitle")}</AppText>
          <AppText muted>{t("onboarding.goalsBody")}</AppText>
          <View style={{ gap: 8 }}>
            {GOALS.map((g) => (
              <Segmented key={g} label={t(`onboarding.${g}`)} value={goals.includes(g) ? "on" : "off"} options={[{ value: "on", label: t(`onboarding.${g}`) }]} onChange={() => setGoals((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]))} />
            ))}
          </View>
        </Card>
      ) : null}

      {error ? <Notice text={t("onboarding.saveFailed")} /> : null}

      <View style={{ gap: 10 }}>
        {step < STEPS - 1 ? <Button title={t("common.next")} onPress={() => setStep(step + 1)} /> : <Button title={t("common.finish")} onPress={finish} loading={busy} />}
        {step > 0 ? <Button title={t("common.back")} variant="secondary" onPress={() => setStep(step - 1)} /> : null}
        <Button title={t("common.close")} variant="ghost" onPress={() => void leave(true)} />
      </View>
    </Screen>
  );
}
