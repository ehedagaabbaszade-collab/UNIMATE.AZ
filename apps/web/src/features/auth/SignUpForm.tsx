"use client";

import { Button, Input } from "@unimate/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useT } from "@/i18n/provider";
import type { MessageKey } from "@/i18n";
import { fieldErrors, signUpSchema } from "@/lib/schemas";
import { getBrowserClient } from "@/lib/supabase/browser";
import { AcademicPicker, type AcademicValue } from "../academic/AcademicPicker";
import { authErrorKey } from "./auth-errors";

export function SignUpForm() {
  const t = useT();
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});
  const [formError, setFormError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [academic, setAcademic] = useState<AcademicValue>({ universityId: "", facultyId: "", majorId: "" });

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = signUpSchema.safeParse({
      displayName: fd.get("displayName"),
      email: fd.get("email"),
      password: fd.get("password"),
      confirmPassword: fd.get("confirmPassword"),
      universityId: academic.universityId,
      majorId: academic.majorId,
    });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setFormError(null);
    setBusy(true);
    const v = parsed.data;
    // handle_new_user() only copies display_name into profiles. University/major travel as user metadata and are
    // applied to the profile on the first signed-in visit (see (app)/layout.tsx), because email confirmation means
    // there is no session here to update the profile with.
    const { data, error } = await getBrowserClient().auth.signUp({
      email: v.email,
      password: v.password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
        data: { display_name: v.displayName, ...(v.universityId ? { university_id: v.universityId } : {}), ...(v.majorId ? { major_id: v.majorId } : {}) },
      },
    });
    if (error) {
      setBusy(false);
      setFormError(authErrorKey(error, "auth.signUpFailed"));
      return;
    }
    if (data.session) {
      router.replace("/onboarding");
      router.refresh();
    } else {
      router.replace(`/verify-email?email=${encodeURIComponent(v.email)}`);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="stack">
      <div>
        <h1>{t("auth.signUpTitle")}</h1>
        <p className="um-muted">{t("auth.signUpBody")}</p>
      </div>
      {formError ? (
        <p className="err-box" role="alert">
          {t(formError)}
        </p>
      ) : null}
      <Input name="displayName" autoComplete="name" label={t("auth.displayName")} error={errors.displayName && t(errors.displayName)} />
      <Input name="email" type="email" autoComplete="email" label={t("auth.email")} error={errors.email && t(errors.email)} />
      <Input name="password" type="password" autoComplete="new-password" label={t("auth.password")} hint={t("validation.passwordMin")} error={errors.password && t(errors.password)} />
      <Input name="confirmPassword" type="password" autoComplete="new-password" label={t("auth.confirmPassword")} error={errors.confirmPassword && t(errors.confirmPassword)} />
      <AcademicPicker value={academic} onChange={setAcademic} />
      <Button type="submit" block loading={busy}>
        {t("auth.signUpCta")}
      </Button>
      <p className="um-muted" style={{ fontSize: "var(--text-sm)" }}>
        {t("auth.hasAccount")} <Link href="/sign-in">{t("auth.signInCta")}</Link>
      </p>
    </form>
  );
}
