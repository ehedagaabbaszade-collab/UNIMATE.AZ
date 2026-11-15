import { useI18n } from "@unimate/i18n/react";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import { AppText, Button, Card, Dialog, Notice, PressableScale, Screen, ScreenHeader, useToast } from "../../components/ui";
import { radii } from "../../theme/tokens";
import { LEGAL_LABEL, LEGAL_SLUGS } from "../../lib/legal";
import { unwrap, useAsync } from "../../lib/use-async";
import { useUser } from "../../state/session";
import { useTheme } from "../../theme/ThemeProvider";

/** Privacy and legal: policies, data export and account deletion (moved off the Profile screen so that one never scrolls). */
export function PrivacyScreen() {
  const { t, date } = useI18n();
  const router = useRouter();
  const { theme } = useTheme();
  const { user, supabase: sb } = useUser();
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const info = useAsync(async () => {
    const del = await sb.from("account_deletion_requests").select("scheduled_for").eq("status", "pending").maybeSingle<{ scheduled_for: string }>();
    return { deletionAt: del.data?.scheduled_for ?? null };
  }, [user.id]);

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

  const deletionAt = info.data?.deletionAt;
  return (
    <Screen ambient>
      <ScreenHeader title={t("settings.privacy")} />
      <Card style={{ borderRadius: radii.xxl }}>
        {LEGAL_SLUGS.map((s) => (
          <PressableScale key={s} onPress={() => router.push(`/legal/${s}` as Href)} accessibilityRole="link" style={{ minHeight: 44, justifyContent: "center" }}>
            <AppText style={{ color: theme.active, fontWeight: "600" }}>{t(`legal.${LEGAL_LABEL[s]}`)}</AppText>
          </PressableScale>
        ))}
      </Card>
      <Card style={{ borderRadius: radii.xxl }}>
        <AppText variant="label">{t("settings.exportTitle")}</AppText>
        <AppText muted variant="caption">
          {t("settings.exportBody")}
        </AppText>
        <Button title={t("settings.exportCta")} variant="secondary" onPress={exportData} loading={exporting} />
      </Card>
      <Card style={{ borderRadius: radii.xxl }}>
        <AppText variant="label">{t("settings.deleteTitle")}</AppText>
        {deletionAt ? (
          <>
            <Notice tone="warning" text={t("mobile.profile.deletionPending", { date: date(deletionAt) })} />
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
