import type { MessageKey } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { AppText, Button, Input, Notice } from "../../src/components/ui";
import { AcademicPicker, type AcademicValue } from "../../src/features/academic/AcademicPicker";
import { AuthShell } from "../../src/features/auth/AuthShell";
import { authErrorKey } from "../../src/lib/auth-errors";
import { authRedirect } from "../../src/lib/links";
import { fieldErrors, signUpSchema } from "../../src/lib/schemas";
import { useSession } from "../../src/state/session";

export default function SignUp() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { supabase } = useSession();
  const [f, setF] = useState({ displayName: "", email: "", password: "", confirmPassword: "" });
  const [academic, setAcademic] = useState<AcademicValue>({ universityId: "", facultyId: "", majorId: "" });
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});
  const [formError, setFormError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  async function submit() {
    const parsed = signUpSchema.safeParse({ ...f, universityId: academic.universityId, majorId: academic.majorId });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    setFormError(null);
    setBusy(true);
    const v = parsed.data;
    // handle_new_user() only copies display_name into profiles. University/major travel as user metadata and are applied
    // to the profile on the first signed-in load (state/session.tsx), because email confirmation means there is no session yet.
    const { data, error } = await supabase!.auth.signUp({
      email: v.email,
      password: v.password,
      options: { emailRedirectTo: authRedirect(), data: { display_name: v.displayName, locale, ...(v.universityId ? { university_id: v.universityId } : {}), ...(v.majorId ? { major_id: v.majorId } : {}) } },
    });
    setBusy(false);
    if (error) return setFormError(authErrorKey(error, "auth.signUpFailed"));
    if (!data.session) router.replace({ pathname: "/verify-email", params: { email: v.email } });
  }

  return (
    <AuthShell>
      <AppText variant="title" accessibilityRole="header">
        {t("auth.signUpTitle")}
      </AppText>
      <AppText muted>{t("auth.signUpBody")}</AppText>
      {formError ? <Notice text={t(formError)} /> : null}
      <Input label={t("auth.displayName")} value={f.displayName} onChangeText={set("displayName")} autoComplete="name" error={errors.displayName && t(errors.displayName)} />
      <Input label={t("auth.email")} value={f.email} onChangeText={set("email")} autoCapitalize="none" autoComplete="email" keyboardType="email-address" error={errors.email && t(errors.email)} />
      <Input label={t("auth.password")} value={f.password} onChangeText={set("password")} secure autoCapitalize="none" autoComplete="new-password" hint={t("validation.passwordMin")} error={errors.password && t(errors.password)} />
      <Input label={t("auth.confirmPassword")} value={f.confirmPassword} onChangeText={set("confirmPassword")} secure autoCapitalize="none" autoComplete="new-password" error={errors.confirmPassword && t(errors.confirmPassword)} />
      <AcademicPicker value={academic} onChange={setAcademic} />
      <Button title={t("auth.signUpCta")} onPress={submit} loading={busy} />
      <AppText muted variant="caption">
        {t("auth.hasAccount")}{" "}
        <Link href="/sign-in" accessibilityRole="link">
          <AppText variant="label" style={{ textDecorationLine: "underline" }}>
            {t("auth.signInCta")}
          </AppText>
        </Link>
      </AppText>
    </AuthShell>
  );
}
