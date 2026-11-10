"use client";

import { Button, Input } from "@unimate/ui";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useT } from "@unimate/i18n/react";
import type { MessageKey } from "@unimate/i18n";
import { safeNext } from "../../lib/guard";
import { fieldErrors, signInSchema } from "../../lib/schemas";
import { getBrowserClient } from "../../lib/supabase/browser";
import { authErrorKey } from "./auth-errors";

/**
 * Staff sign-in (email + password). Signing in only creates a session: whether the account is staff is decided on the
 * server afterwards (proxy.ts, the console layout and the database RPCs), so a student account sees "access denied".
 */
export function SignInForm({ next }: { next?: string }) {
  const t = useT();
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});
  const [formError, setFormError] = useState<MessageKey | null>(null);
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
        <h1>{t("admin.signIn.title")}</h1>
        <p className="um-muted">{t("admin.signIn.body")}</p>
      </div>
      {formError ? (
        <p className="err-box" role="alert">
          {t(formError)}
        </p>
      ) : null}
      <Input name="email" type="email" autoComplete="username" label={t("auth.email")} error={errors.email && t(errors.email)} />
      <Input name="password" type="password" autoComplete="current-password" label={t("auth.password")} error={errors.password && t(errors.password)} />
      <Button type="submit" block loading={busy}>
        {t("auth.signInCta")}
      </Button>
    </form>
  );
}
