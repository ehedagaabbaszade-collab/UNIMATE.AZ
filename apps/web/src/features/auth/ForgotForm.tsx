"use client";

import { Button, Input } from "@unimate/ui";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useT } from "@unimate/i18n/react";
import type { MessageKey } from "@unimate/i18n";
import { fieldErrors, forgotSchema } from "@/lib/schemas";
import { getBrowserClient } from "@/lib/supabase/browser";
import { authErrorKey } from "./auth-errors";

export function ForgotForm() {
  const t = useT();
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});
  const [formError, setFormError] = useState<MessageKey | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = forgotSchema.safeParse({ email: new FormData(e.currentTarget).get("email") });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setFormError(null);
    setBusy(true);
    const { error } = await getBrowserClient().auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setBusy(false);
    // Do not reveal whether the account exists: only rate limiting is surfaced.
    if (error && authErrorKey(error, "common.genericError") === "auth.rateLimited") setFormError("auth.rateLimited");
    else setSent(true);
  }

  return (
    <form method="post" onSubmit={onSubmit} noValidate className="stack">
      <div>
        <h1>{t("auth.forgotTitle")}</h1>
        <p className="um-muted">{t("auth.forgotBody")}</p>
      </div>
      {sent ? (
        <p className="ok-box" role="status">
          {t("auth.forgotSent")}
        </p>
      ) : null}
      {formError ? (
        <p className="err-box" role="alert">
          {t(formError)}
        </p>
      ) : null}
      <Input name="email" type="email" autoComplete="email" label={t("auth.email")} error={errors.email && t(errors.email)} />
      <Button type="submit" block loading={busy}>
        {t("auth.forgotCta")}
      </Button>
      <Link href="/sign-in">{t("auth.signInCta")}</Link>
    </form>
  );
}
