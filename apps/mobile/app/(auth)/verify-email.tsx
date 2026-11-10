import { useT } from "@unimate/i18n/react";
import { Link, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { AppText, Button, Notice } from "../../src/components/ui";
import { AuthShell } from "../../src/features/auth/AuthShell";
import { authErrorKey } from "../../src/lib/auth-errors";
import { authRedirect } from "../../src/lib/links";
import { useSession } from "../../src/state/session";

/** Shown after sign-up (and when sign-in says the email is not confirmed). Resend uses the real Supabase auth call. */
export default function VerifyEmail() {
  const t = useT();
  const { email } = useLocalSearchParams<{ email?: string }>();
  const { supabase } = useSession();
  const [msg, setMsg] = useState<{ text: string; tone: "success" | "danger" } | null>(null);
  const [busy, setBusy] = useState(false);

  async function resend() {
    if (!email) return;
    setBusy(true);
    const { error } = await supabase!.auth.resend({ type: "signup", email, options: { emailRedirectTo: authRedirect() } });
    setBusy(false);
    setMsg(error ? { text: t(authErrorKey(error, "common.genericError")), tone: "danger" } : { text: t("auth.verifyResent"), tone: "success" });
  }

  return (
    <AuthShell>
      <AppText variant="title" accessibilityRole="header">
        {t("auth.verifyTitle")}
      </AppText>
      <AppText>{email ? t("auth.verifyBody", { email }) : t("auth.verifyBodyNoEmail")}</AppText>
      {msg ? <Notice tone={msg.tone} text={msg.text} /> : null}
      {email ? <Button title={t("auth.verifyResend")} variant="secondary" onPress={resend} loading={busy} /> : null}
      <Link href="/sign-in" accessibilityRole="link">
        <AppText variant="label" style={{ textDecorationLine: "underline" }}>
          {t("auth.signInCta")}
        </AppText>
      </Link>
    </AuthShell>
  );
}
