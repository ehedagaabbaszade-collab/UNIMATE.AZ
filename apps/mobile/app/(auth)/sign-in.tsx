import type { MessageKey } from "@unimate/i18n";
import { useT } from "@unimate/i18n/react";
import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { AppText, Button, Input, Notice } from "../../src/components/ui";
import { AuthShell } from "../../src/features/auth/AuthShell";
import { authErrorKey } from "../../src/lib/auth-errors";
import { fieldErrors, signInSchema } from "../../src/lib/schemas";
import { useSession } from "../../src/state/session";

export default function SignIn() {
  const t = useT();
  const router = useRouter();
  const { supabase } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});
  const [formError, setFormError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const parsed = signInSchema.safeParse({ email, password });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    setFormError(null);
    setBusy(true);
    const { error } = await supabase!.auth.signInWithPassword(parsed.data);
    setBusy(false);
    if (error) {
      const key = authErrorKey(error, "common.genericError");
      if (key === "auth.emailNotConfirmed") router.push({ pathname: "/verify-email", params: { email } });
      setFormError(key === "auth.invalidCredentials" || key === "auth.emailNotConfirmed" || key === "auth.rateLimited" ? key : "auth.invalidCredentials");
    }
    // Success: the session provider flips to signed-in and the auth guard swaps the navigator.
  }

  return (
    <AuthShell>
      <AppText variant="title" accessibilityRole="header">
        {t("auth.signInTitle")}
      </AppText>
      <AppText muted>{t("auth.signInBody")}</AppText>
      {formError ? <Notice text={t(formError)} /> : null}
      <Input label={t("auth.email")} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" error={errors.email && t(errors.email)} />
      <Input label={t("auth.password")} value={password} onChangeText={setPassword} secure autoCapitalize="none" autoComplete="current-password" textContentType="password" error={errors.password && t(errors.password)} />
      <Button title={t("auth.signInCta")} onPress={submit} loading={busy} />
      <Link href="/forgot-password" accessibilityRole="link">
        <AppText variant="label" style={{ textDecorationLine: "underline" }}>
          {t("auth.forgot")}
        </AppText>
      </Link>
      <AppText muted variant="caption">
        {t("auth.noAccount")}{" "}
        <Link href="/sign-up" accessibilityRole="link">
          <AppText variant="label" style={{ textDecorationLine: "underline" }}>
            {t("auth.signUpCta")}
          </AppText>
        </Link>
      </AppText>
    </AuthShell>
  );
}
