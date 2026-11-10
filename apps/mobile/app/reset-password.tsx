import type { MessageKey } from "@unimate/i18n";
import { useT } from "@unimate/i18n/react";
import { Link, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { AppText, Button, Input, Notice } from "../src/components/ui";
import { AuthShell } from "../src/features/auth/AuthShell";
import { authErrorKey } from "../src/lib/auth-errors";
import { fieldErrors, resetSchema } from "../src/lib/schemas";
import { useSession } from "../src/state/session";

/** Reachable only through the recovery deep link (which created a session); otherwise explains the link is invalid. */
export default function ResetPassword() {
  const t = useT();
  const router = useRouter();
  const { supabase } = useSession();
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [f, setF] = useState({ password: "", confirmPassword: "" });
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});
  const [formError, setFormError] = useState<MessageKey | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void supabase?.auth.getUser().then(({ data }) => setHasSession(!!data.user));
  }, [supabase]);

  async function submit() {
    const parsed = resetSchema.safeParse(f);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    setBusy(true);
    const { error } = await supabase!.auth.updateUser({ password: parsed.data.password });
    setBusy(false);
    if (error) return setFormError(authErrorKey(error, "common.genericError"));
    setDone(true);
    router.replace("/");
  }

  if (hasSession === false)
    return (
      <AuthShell>
        <AppText variant="title" accessibilityRole="header">
          {t("auth.resetTitle")}
        </AppText>
        <Notice text={t("auth.resetNoSession")} />
        <Link href="/forgot-password" accessibilityRole="link">
          <AppText variant="label" style={{ textDecorationLine: "underline" }}>
            {t("auth.forgotCta")}
          </AppText>
        </Link>
      </AuthShell>
    );

  return (
    <AuthShell>
      <AppText variant="title" accessibilityRole="header">
        {t("auth.resetTitle")}
      </AppText>
      {done ? <Notice tone="success" text={t("auth.resetDone")} /> : null}
      {formError ? <Notice text={t(formError)} /> : null}
      <Input label={t("auth.password")} value={f.password} onChangeText={(v) => setF((s) => ({ ...s, password: v }))} secure autoCapitalize="none" autoComplete="new-password" hint={t("validation.passwordMin")} error={errors.password && t(errors.password)} />
      <Input label={t("auth.confirmPassword")} value={f.confirmPassword} onChangeText={(v) => setF((s) => ({ ...s, confirmPassword: v }))} secure autoCapitalize="none" autoComplete="new-password" error={errors.confirmPassword && t(errors.confirmPassword)} />
      <Button title={t("auth.resetCta")} onPress={submit} loading={busy} disabled={hasSession === null} />
    </AuthShell>
  );
}
