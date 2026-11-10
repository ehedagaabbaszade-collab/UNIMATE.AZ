import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { AppText, Button, Card, EmptyState, ErrorState, Screen, ScreenHeader, Skeleton } from "../../src/components/ui";
import { unwrap, useAsync } from "../../src/lib/use-async";
import { useUser } from "../../src/state/session";
import { useTheme } from "../../src/theme/ThemeProvider";

interface NotificationRow {
  id: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
}

/** Server notifications rendered per the user's profile locale (view notifications_rendered). Read-only plus mark-as-read. */
export default function NotificationsRoute() {
  const { t, dateTime } = useI18n();
  const router = useRouter();
  const { theme } = useTheme();
  const { supabase: sb } = useUser();
  const list = useAsync(async () => unwrap(await sb.from("notifications_rendered").select("id,title,body,read_at,created_at").order("created_at", { ascending: false }).limit(50)) as NotificationRow[], []);
  const unread = (list.data ?? []).filter((n) => !n.read_at).length;

  async function markAll() {
    await sb.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
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
          {list.data?.map((n) => (
            <Card key={n.id}>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                <AppText style={{ fontWeight: n.read_at ? "400" : "700", flex: 1 }}>{n.title}</AppText>
                {!n.read_at ? <View accessibilityElementsHidden style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.danger }} /> : null}
              </View>
              {n.body ? <AppText muted>{n.body}</AppText> : null}
              <AppText variant="caption" muted>
                {dateTime(n.created_at)}
              </AppText>
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}
