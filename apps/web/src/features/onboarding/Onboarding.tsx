"use client";

import { Button, Select, useToast } from "@unimate/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LOCALES, LOCALE_NAMES, type Locale } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import { persistLocale } from "@/i18n/client";
import { writeCookie } from "@/lib/cookies";
import { getBrowserClient } from "@/lib/supabase/browser";
import { AcademicPicker, type AcademicValue } from "../academic/AcademicPicker";

const GOALS = ["goalGpa", "goalExams", "goalOrganise", "goalNotes"] as const;
export const GOALS_STORAGE_KEY = "um-goals";
export const SKIP_COOKIE = "um-onboarding-skipped";
const STEPS = 4;

export function Onboarding({ userId, initial }: { userId: string; initial: { universityId: string; majorId: string; studyYear: number | null } }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [academic, setAcademic] = useState<AcademicValue>({ universityId: initial.universityId, facultyId: "", majorId: initial.majorId });
  const [year, setYear] = useState<string>(initial.studyYear ? String(initial.studyYear) : "");
  const [goals, setGoals] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const { toast } = useToast();
  // Persist on change (profiles.locale + cookie), not only at the end, so the choice survives leaving the flow.
  const setLocale = (l: Locale) => {
    void persistLocale(l, userId).then((ok) => {
      if (!ok) toast(t("language.saveFailed"), "error");
    });
    router.refresh();
  };

  async function finish() {
    setBusy(true);
    setError(false);
    const { error: err } = await getBrowserClient()
      .from("profiles")
      .update({
        locale,
        university_id: academic.universityId || null,
        major_id: academic.majorId || null,
        study_year: year ? Number(year) : null,
      })
      .eq("id", userId);
    if (err) {
      setBusy(false);
      setError(true);
      return;
    }
    try {
      localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(goals));
    } catch {
      /* storage unavailable: goals are optional */
    }
    // Without a chosen university the (app) layout would bounce back here, so completing the flow also clears the gate.
    writeCookie(SKIP_COOKIE, "1");
    router.replace("/dashboard");
    router.refresh();
  }

  function skip() {
    writeCookie(SKIP_COOKIE, "1");
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <div className="stack-lg">
      <div className="stack">
        <h1>{t("onboarding.title")}</h1>
        <div className="steps" aria-hidden="true">
          {Array.from({ length: STEPS }, (_, i) => (
            <span key={i} data-done={i <= step} />
          ))}
        </div>
        <p className="um-muted">{t("onboarding.step", { a: step + 1, b: STEPS })}</p>
      </div>

      {step === 0 ? (
        <fieldset className="seg" style={{ minWidth: 0 }}>
          <legend className="um-label" style={{ marginBottom: "var(--space-3)", fontSize: "var(--text-lg)" }}>
            {t("onboarding.languageTitle")}
          </legend>
          <div className="choice-grid">
            {LOCALES.map((l) => (
              <label key={l} className="choice">
                <input type="radio" name="locale" checked={locale === l} onChange={() => setLocale(l)} />
                <span lang={l}>{LOCALE_NAMES[l]}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {step === 1 ? (
        <div className="stack">
          <h2>{t("onboarding.universityTitle")}</h2>
          <AcademicPicker value={academic} onChange={setAcademic} showMajor={false} />
        </div>
      ) : null}

      {step === 2 ? (
        <div className="stack">
          <h2>{t("onboarding.majorTitle")}</h2>
          <AcademicPicker value={academic} onChange={setAcademic} />
          <Select label={t("onboarding.studyYear")} value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">{t("common.select")}</option>
            {[1, 2, 3, 4, 5, 6].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      {step === 3 ? (
        <fieldset className="seg" style={{ minWidth: 0 }}>
          <legend className="um-label" style={{ fontSize: "var(--text-lg)" }}>
            {t("onboarding.goalsTitle")}
          </legend>
          <p className="um-muted" style={{ margin: "var(--space-2) 0 var(--space-3)" }}>
            {t("onboarding.goalsBody")}
          </p>
          <div className="choice-grid">
            {GOALS.map((g) => (
              <label key={g} className="choice">
                <input type="checkbox" checked={goals.includes(g)} onChange={(e) => setGoals((cur) => (e.target.checked ? [...cur, g] : cur.filter((x) => x !== g)))} />
                <span>{t(`onboarding.${g}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {error ? (
        <p className="err-box" role="alert">
          {t("onboarding.saveFailed")}
        </p>
      ) : null}

      <div className="row row--between">
        <Button variant="ghost" onClick={step === 0 ? skip : () => setStep(step - 1)}>
          {step === 0 ? t("common.close") : t("common.back")}
        </Button>
        {step < STEPS - 1 ? (
          <Button onClick={() => setStep(step + 1)}>{t("common.next")}</Button>
        ) : (
          <Button onClick={finish} loading={busy}>
            {t("common.finish")}
          </Button>
        )}
      </div>
    </div>
  );
}
