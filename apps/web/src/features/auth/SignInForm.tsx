"use client";

import { Button, Input } from "@unimate/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useT } from "@unimate/i18n/react";
import type { MessageKey } from "@unimate/i18n";
import { homeFor, setModeCookie, type AppMode } from "@/lib/mode";
import { safeNext } from "@/lib/paths";
import { fieldErrors, signInSchema } from "@/lib/schemas";
import { getBrowserClient } from "@/lib/supabase/browser";
import { authErrorKey } from "./auth-errors";
import { RoleSwitch } from "./RoleSwitch";

export function SignInForm({ as, next, callbackError }: { as: AppMode; next?: string; callbackError?: boolean }) {
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
    setModeCookie(as);
    router.replace(safeNext(next, homeFor(as)));
    router.refresh();
  }

  return (
    <form method="post" onSubmit={onSubmit} noValidate className="stack">
      <RoleSwitch as={as} path="/sign-in" {...(next ? { next } : {})} />
      <div>
        <h1>{t(as === "teacher" ? "auth.teacherSignInTitle" : "auth.signInTitle")}</h1>
        <p className="um-muted">{t(as === "teacher" ? "auth.teacherSignInBody" : "auth.signInBody")}</p>
      </div>
      {formError ? (
        <p className="err-box" role="alert">
          {t(formError)}
        </p>
      ) : null}
      <Input name="email" type="email" autoComplete="email" label={t("auth.email")} error={errors.email && t(errors.email)} />
      <Input name="password" type="password" reveal={{ show: t("mobile.auth.showPassword"), hide: t("mobile.auth.hidePassword") }} autoComplete="current-password" label={t("auth.password")} error={errors.password && t(errors.password)} />
      <Button type="submit" block loading={busy}>
        {t("auth.signInCta")}
      </Button>
      <p className="um-muted" style={{ fontSize: "var(--text-sm)" }}>
        <Link href="/forgot-password">{t("auth.forgot")}</Link>
      </p>
      <p className="um-muted" style={{ fontSize: "var(--text-sm)" }}>
        {t("auth.noAccount")} <Link href={as === "teacher" ? "/sign-up?as=teacher" : "/sign-up"}>{t("auth.signUpCta")}</Link>
      </p>
    </form>
  );
}
