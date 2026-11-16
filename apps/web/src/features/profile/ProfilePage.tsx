"use client";

import { PRICE_AZN, parseMyProgress } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Avatar, Button, Card, Input, useToast } from "@unimate/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useUser } from "@/components/user";
import { useDemoPlan } from "@/features/plans/demo-plan";
import { getBrowserClient } from "@/lib/supabase/browser";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { planFromSubscription } from "@/lib/usage";
import { useAsync } from "@/lib/use-async";
import { avatarPathFromUrl, isOwnAvatarUrl } from "./avatar-url";
import { saveDisplayName } from "./save-name";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/** Identity (photo, name, email, institution) plus grouped shortcuts, like the mobile profile. Settings, sign out and the mode switch live elsewhere in the web shell. */
export function ProfilePage() {
  const { t } = useI18n();
  const user = useUser();
  const router = useRouter();
  const { toast } = useToast();
  const demo = useDemoPlan(user.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);

  const info = useAsync(async () => {
    const sb = getBrowserClient();
    const prof = await sb.from("profiles").select("avatar_url,university_id").eq("id", user.id).maybeSingle<{ avatar_url: string | null; university_id: string | null }>();
    const [plan, uni, prog] = await Promise.all([
      sb.rpc("my_plan"),
      prof.data?.university_id ? sb.from("universities").select("name").eq("id", prof.data.university_id).maybeSingle<{ name: string }>() : Promise.resolve({ data: null, error: null }),
      sb.rpc("my_progress"),
    ]);
    const supabaseUrl = getSupabaseEnv()?.url ?? null;
    const url = prof.data?.avatar_url ?? null;
    return {
      avatarUrl: isOwnAvatarUrl(url, supabaseUrl) ? url : null,
      plan: planFromSubscription(plan.error ? null : { plan: String(plan.data ?? "free") as "free" | "plus" | "pro", status: "active" }),
      university: uni.data?.name ?? null,
      level: prog.error ? null : parseMyProgress(prog.data).level,
    };
  }, [user.id]);

  const shownPlan = info.data ? (demo.demoPlan ?? info.data.plan) : null;
  const price = shownPlan && shownPlan !== "GROUP" ? PRICE_AZN[shownPlan] : 0;
  const shownName = user.displayName ?? "";

  async function saveName() {
    setSaving(true);
    const res = await saveDisplayName(getBrowserClient(), user.id, draft);
    setSaving(false);
    if (res.ok) {
      setEditing(false);
      setNameError(null);
      router.refresh(); // the shell reads the name from the server layout
    } else if (res.kind === "validation") {
      setNameError(t(res.messageKey as never));
    } else {
      setEditing(false);
      setNameError(t("mobile.profile.nameSaveFailed"));
    }
  }

  /** profiles.avatar_url (public 'avatars' bucket, owner-only writes under `<uid>/`); a failure restores the previous avatar. */
  async function changeAvatar(file: File | undefined, remove = false) {
    const sb = getBrowserClient();
    const supabaseUrl = getSupabaseEnv()?.url ?? null;
    const old = info.data?.avatarUrl ?? null;
    if (file && (!file.type.startsWith("image/") || file.size > MAX_AVATAR_BYTES)) return toast(t("mobile.profile.avatarFailed"), "error");
    setAvatarBusy(true);
    let path: string | null = null;
    try {
      let url: string | null = null;
      if (file) {
        path = `${user.id}/${crypto.randomUUID()}.${file.type === "image/png" ? "png" : "jpg"}`;
        const up = await sb.storage.from("avatars").upload(path, file, { contentType: file.type, upsert: false });
        if (up.error) throw new Error(up.error.message);
        url = sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
      } else if (!remove) return;
      const { error } = await sb.from("profiles").update({ avatar_url: url }).eq("id", user.id).select("id").single();
      if (error) throw new Error(error.message);
      const oldPath = avatarPathFromUrl(old, supabaseUrl);
      if (oldPath) await sb.storage.from("avatars").remove([oldPath]).catch(() => undefined);
      info.setData((d) => (d ? { ...d, avatarUrl: url } : d));
    } catch {
      if (path) await sb.storage.from("avatars").remove([path]).catch(() => undefined);
      toast(t("mobile.profile.avatarFailed"), "error");
    } finally {
      setAvatarBusy(false);
    }
  }

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>{t("brand.module.profile")}</h1>
      </div>

      <Card>
        <div className="stack" style={{ justifyItems: "center", textAlign: "center" }}>
          <Avatar name={shownName || user.email} src={info.data?.avatarUrl ?? null} size={88} />
          <div className="row">
            <label className="um-btn um-btn--secondary um-btn--sm" aria-disabled={avatarBusy}>
              {t("mobile.profile.avatarPick")}
              <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={avatarBusy} onChange={(e) => { void changeAvatar(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            {info.data?.avatarUrl ? <Button variant="ghost" size="sm" loading={avatarBusy} onClick={() => void changeAvatar(undefined, true)}>{t("mobile.profile.avatarRemove")}</Button> : null}
          </div>
          {editing ? (
            <form className="row" onSubmit={(e) => { e.preventDefault(); void saveName(); }}>
              <Input label={t("settings.displayName")} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={120} autoFocus />
              <Button type="submit" size="sm" loading={saving}>{t("mobile.profile.saveName")}</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => { setEditing(false); setNameError(null); }}>{t("mobile.profile.cancelEdit")}</Button>
            </form>
          ) : (
            <div className="row">
              <h2>{shownName || user.email}</h2>
              <Button variant="ghost" size="sm" onClick={() => { setDraft(shownName); setNameError(null); setEditing(true); }}>{t("mobile.profile.editName")}</Button>
            </div>
          )}
          {nameError ? <p className="err-box" role="alert">{nameError}</p> : null}
          <span className="um-hint">{user.email}</span>
          <small className="um-hint">{info.data?.university ?? t("mobile.profile.noInstitution")}</small>
        </div>
      </Card>

      {shownPlan ? (
        <Link className="list-item" href="/plans">
          <div className="list-item__main">
            <span className="list-item__title">{t(`mobile.profile.plans.name.${shownPlan}`)}</span>
            <span className="list-item__meta">{price ? `${t("mobile.profile.plans.price", { amount: price })}${t("mobile.profile.plans.perMonth")}` : t("usage.plan.FREE")}</span>
          </div>
          {shownPlan !== "PRO" ? <span>{t("mobile.profile.plans.cta")} ›</span> : null}
        </Link>
      ) : null}

      <div className="stack">
        <Link className="list-item" href="/documents">{t("nav.documents")}</Link>
        <Link className="list-item" href="/planner">{t("nav.planner")}</Link>
        <Link className="list-item" href="/gamification">{t("gamification.achievementsTitle")}</Link>
      </div>
      <div className="stack">
        <Link className="list-item" href="/settings">{t("nav.settings")}</Link>
        <Link className="list-item" href="/gamification">
          <span>{t("gamification.levelProgress")}</span>
          {info.data?.level ? <span>{t("gamification.level", { n: info.data.level })}</span> : null}
        </Link>
        <Link className="list-item" href="/profile/privacy">{t("mobile.profile.privacyRow")}</Link>
      </div>
    </div>
  );
}
