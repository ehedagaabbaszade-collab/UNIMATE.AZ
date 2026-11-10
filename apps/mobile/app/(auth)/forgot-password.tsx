import type { MessageKey } from "@unimate/i18n";
import { useT } from "@unimate/i18n/react";
import { Link } from "expo-router";
import { useState } from "react";
import { AppText, Button, Input, Notice } from "../../src/components/ui";
import { AuthShell } from "../../src/features/auth/AuthShell";
import { authErrorKey } from "../../src/lib/auth-errors";
import { authRedirect } from "../../src/lib/links";
import { fieldErrors, forgotSchema } from "../../src/lib/schemas";
import { useSession } from "../../src/state/session";

export default function Forgot() {
  const t = useT();
  const { supabase } = useSession();
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});
  const [rateLimited, setRateLimited] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const parsed = forgotSchema.safeParse({ email });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    setRateLimited(false);
    setBusy(true);
    const { error } = await supabase!.auth.resetPasswordForEmail(parsed.data.email, { redirectTo: authRedirect("reset-password") });
    setBusy(false);
    // Do not reveal whether the account exists: only rate limiting is surfaced.
    if (error && authErrorKey(error, "common.genericError") === "auth.rateLimited") setRateLimited(true);
    else setSent(true);
  }

  return (
    <AuthShell>
      <AppText variant="title" accessibilityRole="header">
        {t("auth.forgotTitle")}
      </AppText>
      <AppText muted>{t("auth.forgotBody")}</AppText>
      {sent ? <Notice tone="success" text={t("auth.forgotSent")} /> : null}
      {rateLimited ? <Notice text={t("auth.rateLimited")} /> : null}
      <Input label={t("auth.email")} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" error={errors.email && t(errors.email)} />
      <Button title={t("auth.forgotCta")} onPress={submit} loading={busy} />
      <Link href="/sign-in" accessibilityRole="link">
        <AppText variant="label" style={{ textDecorationLine: "underline" }}>
          {t("auth.signInCta")}
        </AppText>
      </Link>
    </AuthShell>
  );
}
