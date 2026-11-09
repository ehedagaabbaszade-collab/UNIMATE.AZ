"use client";

import { Button, Input } from "@unimate/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useT } from "@/i18n/provider";
import type { MessageKey } from "@/i18n";
import { fieldErrors, resetSchema } from "@/lib/schemas";
import { getBrowserClient } from "@/lib/supabase/browser";
import { authErrorKey } from "./auth-errors";

export function ResetForm() {
  const t = useT();
  const router = useRouter();
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});
  const [formError, setFormError] = useState<MessageKey | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getBrowserClient()
      .auth.getUser()
      .then(({ data }) => setHasSession(!!data.user));
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = resetSchema.safeParse({ password: fd.get("password"), confirmPassword: fd.get("confirmPassword") });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    const { error } = await getBrowserClient().auth.updateUser({ password: parsed.data.password });
    setBusy(false);
    if (error) {
      setFormError(authErrorKey(error, "common.genericError"));
      return;
    }
    setDone(true);
    router.replace("/dashboard");
    router.refresh();
  }

  if (hasSession === false)
    return (
      <div className="stack">
        <h1>{t("auth.resetTitle")}</h1>
        <p className="err-box" role="alert">
          {t("auth.resetNoSession")}
        </p>
        <Link href="/forgot-password">{t("auth.forgotCta")}</Link>
      </div>
    );

  return (
    <form onSubmit={onSubmit} noValidate className="stack">
      <h1>{t("auth.resetTitle")}</h1>
      {done ? (
        <p className="ok-box" role="status">
          {t("auth.resetDone")}
        </p>
      ) : null}
      {formError ? (
        <p className="err-box" role="alert">
          {t(formError)}
        </p>
      ) : null}
      <Input name="password" type="password" autoComplete="new-password" label={t("auth.password")} hint={t("validation.passwordMin")} error={errors.password && t(errors.password)} />
      <Input name="confirmPassword" type="password" autoComplete="new-password" label={t("auth.confirmPassword")} error={errors.confirmPassword && t(errors.confirmPassword)} />
      <Button type="submit" block loading={busy} disabled={hasSession === null}>
        {t("auth.resetCta")}
      </Button>
    </form>
  );
}
