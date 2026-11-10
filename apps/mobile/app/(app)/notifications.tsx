import { parseNotifications, type NotificationItem } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";
import { Icon } from "../../src/components/Icon";
import { AppText, Button, Card, EmptyState, ErrorState, Screen, ScreenHeader, Skeleton } from "../../src/components/ui";
import { unwrap, useAsync } from "../../src/lib/use-async";
import { useUser } from "../../src/state/session";
import { useTheme } from "../../src/theme/ThemeProvider";

/** Server notifications rendered per the user's profile locale (RPC list_my_notifications). Read-only plus mark-as-read. */
export default function NotificationsRoute() {
  const { t, dateTime } = useI18n();
  const router = useRouter();
  const { theme } = useTheme();
  const { supabase: sb } = useUser();
  const list = useAsync(async () => parseNotifications(unwrap(await sb.rpc("list_my_notifications", { p_limit: 50 }))), []);
  const unread = (list.data ?? []).filter((n) => !n.read_at).length;

  async function markAll() {
    await sb.rpc("mark_notifications_read");
    list.reload();
  }

  async function markOne(id: string) {
    await sb.rpc("mark_notifications_read", { p_ids: [id] });
    list.reload();
  }

  return (
    <Screen>
      <ScreenHeader title={t("mobile.home.notifications")} onBack={() => router.back()} />
      {unread > 0 ? <Button small variant="secondary" title={t("mobile.notifications.markAllRead")} onPress={() => void markAll()} /> : null}
      {list.loading && !list.data ? (
        <Skeleton height={70} />
      ) : list.error ? (
        <ErrorState title={t("common.genericError")} description={list.error} action={<Button title={t("common.retry")} onPress={list.reload} />} />
      ) : list.data?.length === 0 ? (
        <EmptyState title={t("mobile.notifications.empty")} />
      ) : (
        <View style={{ gap: 10 }}>
          {list.data?.map((n: NotificationItem) => (
            <Pressable key={n.id} disabled={!!n.read_at} onPress={() => void markOne(n.id)} accessibilityRole={n.read_at ? "text" : "button"} accessibilityLabel={`${n.title ?? ""}. ${n.body ?? ""}`}>
            <Card>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                {n.kind === "achievement" ? <Icon name="achievements" size="sm" color={theme.warning} /> : null}
                <AppText style={{ fontWeight: n.read_at ? "400" : "700", flex: 1 }}>{n.title}</AppText>
                {!n.read_at ? <View accessibilityElementsHidden style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.danger }} /> : null}
              </View>
              {n.body ? <AppText muted>{n.body}</AppText> : null}
              <AppText variant="caption" muted>
                {dateTime(n.created_at)}
              </AppText>
            </Card>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}
