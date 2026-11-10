import type { MessageKey } from "@unimate/i18n";
import { formatBytes } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { Icon } from "../../components/Icon";
import { AppText, Badge, Button, Card, EmptyState, ErrorState, Notice, Screen, Skeleton, useToast } from "../../components/ui";
import type { DocumentRow } from "../../lib/db";
import { DOC_COLUMNS, POLL_MS, STATUS_TONE, anyInFlight } from "../../lib/documents";
import { edgeErrorMessageKey } from "../../lib/edge";
import { unwrap, useAsync } from "../../lib/use-async";
import { useUser } from "../../state/session";
import { useTheme } from "../../theme/ThemeProvider";
import { pickDocument, pickImage, uploadDocument, type PickedFile } from "./upload-flow";
import { UsageMeter } from "./UsageMeter";

export function DocumentsScreen() {
  const { t, date, locale } = useI18n();
  const router = useRouter();
  const { theme } = useTheme();
  const { user, supabase: sb } = useUser();
  const { toast } = useToast();
  const docs = useAsync<DocumentRow[]>(async () => unwrap(await sb.from("documents").select(DOC_COLUMNS).order("created_at", { ascending: false })), []);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Live status: poll while anything is still being processed (Realtime is not enabled for these tables).
  const inFlight = anyInFlight(docs.data);
  const reload = docs.reload;
  useEffect(() => {
    if (!inFlight) return;
    const id = setInterval(reload, POLL_MS);
    return () => clearInterval(id);
  }, [inFlight, reload]);

  async function start(pick: () => Promise<PickedFile | null>) {
    setUploadError(null);
    const file = await pick().catch(() => null);
    if (!file) return;
    setUploading(true);
    const out = await uploadDocument(sb, user.id, file);
    setUploading(false);
    if (out.kind === "rejected") setUploadError(t(`documents.upload_errors.${out.error}` as MessageKey));
    else if (out.kind === "failed") setUploadError(out.message || t("common.genericError"));
    else if (out.kind === "uploaded") {
      if (out.processError) toast(t("documents.processStartFailed", { reason: t(edgeErrorMessageKey(out.processError), { message: out.processError.message ?? "" }) }), "error");
      else toast(t("documents.uploaded"), "success");
      docs.reload();
    }
  }

  function confirmRemove(d: DocumentRow) {
    Alert.alert(t("documents.deleteConfirm"), d.title, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: async () => {
          const del = await sb.from("documents").delete().eq("id", d.id);
          if (del.error) return toast(del.error.message, "error");
          await sb.storage.from("documents").remove([d.storage_path]);
          toast(t("documents.deleted"), "success");
          docs.reload();
        },
      },
    ]);
  }

  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <AppText variant="display" accessibilityRole="header">
          {t("brand.module.aiStudy")}
        </AppText>
        <AppText muted>{t("documents.subtitle")}</AppText>
      </View>

      <UsageMeter />

      <Card>
        <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
          <Icon name="upload" size="lg" color={theme.active} />
          <View style={{ flex: 1 }}>
            <AppText variant="heading">{t("documents.upload")}</AppText>
            <AppText variant="caption" muted>
              {t("documents.uploadHint")}
            </AppText>
          </View>
        </View>
        <Button title={uploading ? t("documents.uploading") : t("documents.dropTitle")} onPress={() => void start(pickDocument)} loading={uploading} />
        <Button title={t("mobile.documents.pickImage")} variant="secondary" onPress={() => void start(pickImage)} disabled={uploading} />
        {uploadError ? <Notice text={uploadError} /> : null}
      </Card>

      {docs.loading && !docs.data ? (
        <View style={{ gap: 12 }}>
          <Skeleton height={110} />
          <Skeleton height={110} />
        </View>
      ) : docs.error ? (
        <ErrorState title={t("documents.loadFailed")} description={docs.error} action={<Button title={t("common.retry")} onPress={docs.reload} />} />
      ) : docs.data && docs.data.length === 0 ? (
        <EmptyState title={t("documents.empty")} description={t("documents.emptyBody")} />
      ) : (
        <View style={{ gap: 12 }}>
          {inFlight ? (
            <AppText muted variant="caption" accessibilityLiveRegion="polite">
              {t("documents.refreshing")}
            </AppText>
          ) : null}
          {docs.data?.map((d) => (
            <Card key={d.id}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Badge tone={STATUS_TONE[d.status]}>{t(`documents.status.${d.status}`)}</Badge>
                <AppText variant="caption" muted>
                  {date(d.created_at)}
                </AppText>
              </View>
              <AppText variant="heading">{d.title}</AppText>
              <AppText variant="caption" muted>
                {[d.page_count != null ? t("documents.pages", { n: d.page_count }) : null, d.size_bytes != null ? formatBytes(locale, d.size_bytes) : null].filter(Boolean).join(" · ")}
              </AppText>
              {d.status === "failed" && d.error ? <Notice text={d.error} /> : null}
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Button small title={t("documents.open")} variant="secondary" onPress={() => router.push({ pathname: "/documents/[id]", params: { id: d.id } })} />
                <Button small title={t("common.delete")} variant="ghost" onPress={() => confirmRemove(d)} />
              </View>
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}
