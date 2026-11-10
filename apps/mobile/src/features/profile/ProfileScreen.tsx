import { planFromSubscription } from "../../lib/usage";
import { useI18n } from "@unimate/i18n/react";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";
import { LanguageSelector } from "../../components/LanguageSelector";
import { ModuleIcon } from "../../components/Icon";
import { AppText, Badge, Button, Card, Dialog, Input, Notice, Screen, Segmented, useToast, PressableScale } from "../../components/ui";
import { LEGAL_LABEL, LEGAL_SLUGS } from "../../lib/legal";
import { fieldErrors, profileNameSchema } from "../../lib/schemas";
import { unwrap, useAsync } from "../../lib/use-async";
import { useSession, useUser } from "../../state/session";
import { useTheme } from "../../theme/ThemeProvider";
import type { ThemePref } from "../../theme/tokens";

/** Settings + account. Plan status is read-only (no billing in the app). */
export function ProfileScreen() {
  const { t, date } = useI18n();
  const router = useRouter();
  const { theme, pref, setPref } = useTheme();
  const { user, profile, supabase: sb } = useUser();
  const { signOut, refreshProfile } = useSession();
  const { toast } = useToast();
  const [name, setName] = useState(profile?.display_name ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const info = useAsync(async () => {
    const [plan, uni, del] = await Promise.all([
      sb.rpc("my_plan"),
      profile?.university_id ? sb.from("universities").select("name").eq("id", profile.university_id).maybeSingle<{ name: string }>() : Promise.resolve({ data: null, error: null }),
      sb.from("account_deletion_requests").select("scheduled_for").eq("status", "pending").maybeSingle<{ scheduled_for: string }>(),
    ]);
    return {
      plan: planFromSubscription(plan.error ? null : { plan: String(plan.data ?? "free") as "free" | "plus" | "pro", status: "active" }),
      university: uni.data?.name ?? null,
      deletionAt: del.data?.scheduled_for ?? null,
    };
  }, [user.id]);

  const reloadInfo = info.reload;
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      reloadInfo();
    }, [reloadInfo]),
  );

  async function saveName() {
    const parsed = profileNameSchema.safeParse({ displayName: name });
    if (!parsed.success) return setNameError(t(fieldErrors(parsed.error).displayName ?? "validation.required"));
    setNameError(null);
    setSaving(true);
    const { error } = await sb.from("profiles").update({ display_name: parsed.data.displayName }).eq("id", user.id);
    setSaving(false);
    if (!error) await refreshProfile();
    toast(error ? t("planner.saveFailed", { reason: error.message }) : t("settings.profileSaved"), error ? "error" : "success");
  }

  /** export_my_data() returns the user's own data as JSON (RLS + explicit owner filters); shared via the OS share sheet. */
  async function exportData() {
    setExporting(true);
    try {
      const json = JSON.stringify(unwrap(await sb.rpc("export_my_data")), null, 2);
      const file = new File(Paths.cache, `unimate-export-${new Date().toISOString().slice(0, 10)}.json`);
      if (file.exists) file.delete();
      file.create();
      file.write(json);
      if (!(await Sharing.isAvailableAsync())) return toast(t("mobile.profile.shareUnavailable"), "error");
      await Sharing.shareAsync(file.uri, { mimeType: "application/json", UTI: "public.json" });
      toast(t("settings.exportDone"), "success");
    } catch (e) {
      toast(t("settings.exportFailed", { reason: e instanceof Error ? e.message : "" }), "error");
    } finally {
      setExporting(false);
    }
  }

  async function requestDeletion() {
    setBusy(true);
    const { error } = await sb.rpc("request_account_deletion");
    setBusy(false);
    setDeleteOpen(false);
    toast(error ? t("common.genericError") : t("mobile.profile.deletionRequested"), error ? "error" : "success");
    info.reload();
  }
  async function cancelDeletion() {
    setBusy(true);
    const { error } = await sb.rpc("cancel_account_deletion");
    setBusy(false);
    toast(error ? t("common.genericError") : t("mobile.profile.deletionCancelled"), error ? "error" : "success");
    info.reload();
  }

  const initials = (profile?.display_name ?? user.email ?? "?").trim().slice(0, 1).toUpperCase();
  return (
    <Screen>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <ModuleIcon icon="profile" module="profile" size={56} label={t("brand.module.profile")} />
        <View style={{ flex: 1 }}>
          <AppText variant="title" accessibilityRole="header" numberOfLines={1}>
            {profile?.display_name ?? initials}
          </AppText>
          {user.email ? (
            <AppText muted variant="caption" numberOfLines={1}>
              {t("settings.signedInAs", { email: user.email })}
            </AppText>
          ) : null}
        </View>
      </View>

      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <AppText variant="heading">{t("mobile.profile.planLabel")}</AppText>
          {info.data ? <Badge tone="primary">{t(`usage.plan.${info.data.plan}`)}</Badge> : null}
        </View>
        <AppText variant="caption" muted>
          {t("mobile.profile.planNote")}
        </AppText>
        <AppText variant="label">{t("mobile.profile.institution")}</AppText>
        <AppText muted>{info.data?.university ?? t("mobile.profile.noInstitution")}</AppText>
      </Card>

      <Card>
        <AppText variant="heading">{t("settings.appearance")}</AppText>
        <Segmented<ThemePref> label={t("theme.label")} value={pref} onChange={setPref} options={[{ value: "dark", label: t("theme.dark") }, { value: "light", label: t("theme.light") }, { value: "system", label: t("theme.system") }]} />
        <AppText variant="label">{t("language.label")}</AppText>
        <LanguageSelector />
      </Card>

      <Card>
        <AppText variant="heading">{t("settings.profile")}</AppText>
        <Input label={t("settings.displayName")} value={name} onChangeText={setName} error={nameError ?? undefined} />
        <Button title={t("settings.saveProfile")} onPress={saveName} loading={saving} />
      </Card>

      <Card>
        <AppText variant="heading">{t("settings.privacy")}</AppText>
        {LEGAL_SLUGS.map((s) => (
          <PressableScale key={s} onPress={() => router.push(`/legal/${s}` as Href)} accessibilityRole="link" style={{ minHeight: 44, justifyContent: "center" }}>
            <AppText style={{ color: theme.active, fontWeight: "600" }}>{t(`legal.${LEGAL_LABEL[s]}`)}</AppText>
          </PressableScale>
        ))}
      </Card>

      <Card>
        <AppText variant="heading">{t("settings.exportTitle")}</AppText>
        <AppText muted variant="caption">
          {t("settings.exportBody")}
        </AppText>
        <Button title={t("settings.exportCta")} variant="secondary" onPress={exportData} loading={exporting} />
      </Card>

      <Card>
        <AppText variant="heading">{t("settings.deleteTitle")}</AppText>
        {info.data?.deletionAt ? (
          <>
            <Notice tone="warning" text={t("mobile.profile.deletionPending", { date: date(info.data.deletionAt) })} />
            <Button title={t("mobile.profile.cancelDeletion")} variant="secondary" onPress={cancelDeletion} loading={busy} />
          </>
        ) : (
          <>
            <AppText muted variant="caption">
              {t("mobile.profile.deleteBody")}
            </AppText>
            <Button title={t("settings.deleteDialogTitle")} variant="danger" onPress={() => setDeleteOpen(true)} />
          </>
        )}
      </Card>

      <Button title={t("nav.signOut")} variant="secondary" onPress={() => void signOut()} />

      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={t("settings.deleteDialogTitle")}
        actions={
          <>
            <Button title={t("mobile.profile.deleteConfirm")} variant="danger" onPress={requestDeletion} loading={busy} />
            <Button title={t("common.cancel")} variant="secondary" onPress={() => setDeleteOpen(false)} />
          </>
        }
      >
        <AppText>{t("mobile.profile.deleteBody")}</AppText>
      </Dialog>
    </Screen>
  );
}
