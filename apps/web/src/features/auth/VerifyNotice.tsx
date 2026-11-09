"use client";

import { Button } from "@unimate/ui";
import Link from "next/link";
import { useState } from "react";
import { useT } from "@/i18n/provider";
import { getBrowserClient } from "@/lib/supabase/browser";
import { authErrorKey } from "./auth-errors";

export function VerifyNotice({ email }: { email?: string }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function resend() {
    if (!email) return;
    setBusy(true);
    const { error } = await getBrowserClient().auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding` },
    });
    setBusy(false);
    setMsg(error ? { ok: false, text: t(authErrorKey(error, "common.genericError")) } : { ok: true, text: t("auth.verifyResent") });
  }

  return (
    <div className="stack">
      <h1>{t("auth.verifyTitle")}</h1>
      <p>{email ? t("auth.verifyBody", { email }) : t("auth.verifyBodyNoEmail")}</p>
      {msg ? (
        <p className={msg.ok ? "ok-box" : "err-box"} role="status">
          {msg.text}
        </p>
      ) : null}
      {email ? (
        <Button variant="secondary" onClick={resend} loading={busy}>
          {t("auth.verifyResend")}
        </Button>
      ) : null}
      <Link href="/sign-in">{t("auth.signInCta")}</Link>
    </div>
  );
}
