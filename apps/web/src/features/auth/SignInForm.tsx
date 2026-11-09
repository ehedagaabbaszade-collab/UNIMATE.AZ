"use client";

import { Button, Input } from "@unimate/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useT } from "@/i18n/provider";
import type { MessageKey } from "@/i18n";
import { safeNext } from "@/lib/paths";
import { fieldErrors, signInSchema } from "@/lib/schemas";
import { getBrowserClient } from "@/lib/supabase/browser";
import { authErrorKey } from "./auth-errors";

export function SignInForm({ next, callbackError }: { next?: string; callbackError?: boolean }) {
  const t = useT();
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});
  const [formError, setFormError] = useState<MessageKey | null>(callbackError ? "auth.callbackError" : null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = signInSchema.safeParse({ email: fd.get("email"), password: fd.get("password") });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setFormError(null);
    setBusy(true);
    const { error } = await getBrowserClient().auth.signInWithPassword(parsed.data);
    if (error) {
      setBusy(false);
      setFormError(authErrorKey(error, "common.genericError"));
      return;
    }
    router.replace(safeNext(next));
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="stack">
      <div>
        <h1>{t("auth.signInTitle")}</h1>
        <p className="um-muted">{t("auth.signInBody")}</p>
      </div>
      {formError ? (
        <p className="err-box" role="alert">
          {t(formError)}
        </p>
      ) : null}
      <Input name="email" type="email" autoComplete="email" label={t("auth.email")} error={errors.email && t(errors.email)} />
      <Input name="password" type="password" autoComplete="current-password" label={t("auth.password")} error={errors.password && t(errors.password)} />
      <Button type="submit" block loading={busy}>
        {t("auth.signInCta")}
      </Button>
      <p className="um-muted" style={{ fontSize: "var(--text-sm)" }}>
        <Link href="/forgot-password">{t("auth.forgot")}</Link>
      </p>
      <p className="um-muted" style={{ fontSize: "var(--text-sm)" }}>
        {t("auth.noAccount")} <Link href="/sign-up">{t("auth.signUpCta")}</Link>
      </p>
    </form>
  );
}
