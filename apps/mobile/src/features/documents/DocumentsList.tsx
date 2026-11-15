import { formatBytes } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { Alert, View } from "react-native";
import type { IconName } from "@unimate/ui/icons";
import { AppText, Button, EmptyState, ErrorState, ListGroup, ListRow, Screen, ScreenHeader, Skeleton, useToast } from "../../components/ui";
import type { DocumentRow } from "../../lib/db";
import { DOC_COLUMNS, POLL_MS, STATUS_TONE, anyInFlight } from "../../lib/documents";
import { unwrap, useAsync } from "../../lib/use-async";
import { useUser } from "../../state/session";
import { useTheme } from "../../theme/ThemeProvider";
import { UsageMeter } from "./UsageMeter";

const FILE_ICON: Record<string, IconName> = {
  "application/pdf": "file-pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "file-docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "file-pptx",
  "image/png": "file-image",
  "image/jpeg": "file-image",
};

/** All documents with status, long-press delete and the monthly usage meter (upload lives in the AI Study composer). */
export function DocumentsList() {
  const { t, date, locale } = useI18n();
  const router = useRouter();
  const { theme } = useTheme();
  const { supabase: sb } = useUser();
  const { toast } = useToast();
  const docs = useAsync<DocumentRow[]>(async () => unwrap(await sb.from("documents").select(DOC_COLUMNS).order("created_at", { ascending: false })), []);

  // Live status: poll while anything is still being processed (Realtime is not enabled for these tables).
  const inFlight = anyInFlight(docs.data);
  const reload = docs.reload;
  useEffect(() => {
    if (!inFlight) return;
    const id = setInterval(reload, POLL_MS);
    return () => clearInterval(id);
  }, [inFlight, reload]);

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
      <ScreenHeader title={t("mobile.aiStudy.myDocs")} />
      <UsageMeter />
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
        <ListGroup title={t("documents.title")} footer={inFlight ? t("documents.refreshing") : t("documents.longPressHint")}>
          {(docs.data ?? []).map((d) => {
            const meta = [date(d.created_at), d.page_count != null ? t("documents.pages", { n: d.page_count }) : null, d.size_bytes != null ? formatBytes(locale, d.size_bytes) : null].filter(Boolean).join(" · ");
            const status = d.status === "ready" ? null : t(`documents.status.${d.status}`);
            const statusColor = STATUS_TONE[d.status] === "danger" ? theme.danger : STATUS_TONE[d.status] === "warning" ? theme.warning : theme.active;
            return (
              <ListRow
                key={d.id}
                icon={FILE_ICON[d.mime_type] ?? "materials"}
                iconColor={d.status === "failed" ? theme.danger : undefined}
                title={d.title}
                subtitle={d.status === "failed" && d.error ? d.error : meta}
                subtitleColor={d.status === "failed" ? theme.danger : undefined}
                trailing={status ? <AppText variant="caption" style={{ color: statusColor, fontWeight: "600" }}>{status}</AppText> : undefined}
                onPress={() => router.push({ pathname: "/documents/[id]", params: { id: d.id } })}
                onLongPress={() => confirmRemove(d)}
                longPressLabel={t("common.delete")}
              />
            );
          })}
        </ListGroup>
      )}
    </Screen>
  );
}
