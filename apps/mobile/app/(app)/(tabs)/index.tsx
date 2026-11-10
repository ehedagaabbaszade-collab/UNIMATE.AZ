import { localDay } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { FlatList, Pressable, View, useWindowDimensions } from "react-native";
import { BrandHeader } from "../../../src/components/Brand";
import { Icon, ModuleIcon } from "../../../src/components/Icon";
import { AppText, Badge, Card, EmptyState, Screen, Skeleton } from "../../../src/components/ui";
import { useSchedule } from "../../../src/features/planner/useSchedule";
import { hasProgress, liveStreak, parseStreak, sumPoints, type ProgressSummary } from "../../../src/lib/progress";
import { heroModules, tileLayout, type ModuleEntry } from "../../../src/lib/registry";
import { upcomingItems } from "../../../src/lib/schedule";
import { unwrap, useAsync } from "../../../src/lib/use-async";
import { useUser } from "../../../src/state/session";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { MIN_TOUCH, radii, spacing } from "../../../src/theme/tokens";

const go = (r: ReturnType<typeof useRouter>, href: string) => r.push(href as Href);

function CircleButton({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={{ width: MIN_TOUCH + 4, height: MIN_TOUCH + 4, borderRadius: (MIN_TOUCH + 4) / 2, backgroundColor: theme.card, borderColor: theme.cardBorder, borderWidth: 1, alignItems: "center", justifyContent: "center" }}>
      {children}
    </Pressable>
  );
}

function HeroCarousel({ items }: { items: ModuleEntry[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const cardW = width - spacing.lg * 2;
  const [page, setPage] = useState(0);
  const listRef = useRef<FlatList<ModuleEntry>>(null);
  if (items.length === 0) return null;
  return (
    <View style={{ gap: spacing.sm }}>
      <FlatList
        ref={listRef}
        data={items}
        horizontal
        pagingEnabled={false}
        snapToInterval={cardW + spacing.md}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        keyExtractor={(m) => m.id}
        ItemSeparatorComponent={() => <View style={{ width: spacing.md }} />}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / (cardW + spacing.md)))}
        accessibilityLabel={t("mobile.home.modules")}
        renderItem={({ item, index }) => (
          <LinearGradient colors={[...theme.gradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: cardW, borderRadius: radii.xl, padding: spacing.lg, flexDirection: "row", gap: spacing.md, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.25)" }} accessibilityLabel={t("mobile.home.heroPage", { a: index + 1, b: items.length })}>
            <View style={{ flex: 1, gap: spacing.sm }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <Icon name={item.icon} size="md" color="#FFFFFF" />
                <AppText variant="title" style={{ color: "#FFFFFF", flexShrink: 1 }}>
                  {t(item.labelKey)}
                </AppText>
              </View>
              <AppText style={{ color: "#EEF0FF" }}>{t(item.hero!.bodyKey)}</AppText>
              <Pressable onPress={() => go(router, item.href)} accessibilityRole="button" accessibilityLabel={`${t(item.labelKey)}: ${t(item.hero!.ctaKey)}`} style={{ alignSelf: "flex-start", minHeight: MIN_TOUCH, borderRadius: radii.pill, backgroundColor: "#FFFFFF", paddingHorizontal: spacing.lg, justifyContent: "center", flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <AppText variant="label" style={{ color: "#3B2FC9", fontWeight: "800" }}>
                  {t(item.hero!.ctaKey)}
                </AppText>
                <AppText variant="label" style={{ color: "#3B2FC9", fontWeight: "800" }}>
                  {"→"}
                </AppText>
              </Pressable>
            </View>
            <View style={{ alignSelf: "center" }}>
              <ModuleIcon icon={item.icon} {...(item.module ? { module: item.module } : {})} size={72} />
            </View>
          </LinearGradient>
        )}
      />
      {items.length > 1 ? (
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 8 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {items.map((m, i) => (
            <View key={m.id} style={{ width: i === page ? 22 : 8, height: 8, borderRadius: 4, backgroundColor: i === page ? theme.active : theme.border }} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function TileGrid({ items, hasMore }: { items: ModuleEntry[]; hasMore: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const tileW = Math.floor((width - spacing.lg * 2 - spacing.md * 2) / 3);
  const box = { width: tileW, minHeight: 92, borderRadius: radii.lg, borderWidth: 1, borderColor: theme.cardBorder, alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.sm } as const;
  return (
    <View accessibilityRole="menu" accessibilityLabel={t("mobile.home.modules")} style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
      {items.map((m, i) => (
        <Pressable key={m.id} onPress={() => go(router, m.href)} accessibilityRole="button" accessibilityLabel={t(m.labelKey)} style={{ ...box, backgroundColor: i === 0 ? theme.primarySoft : theme.card }}>
          <ModuleIcon icon={m.icon} {...(m.module ? { module: m.module } : {})} {...(m.tileColors ? { colors: m.tileColors } : {})} size={40} />
          <AppText variant="label" numberOfLines={2} style={{ textAlign: "center" }}>
            {t(m.labelKey)}
          </AppText>
        </Pressable>
      ))}
      {hasMore ? (
        <Pressable onPress={() => router.push("/more")} accessibilityRole="button" accessibilityLabel={t("nav.more")} style={{ ...box, backgroundColor: theme.card }}>
          <ModuleIcon icon="more" colors={["#475569", "#334155"]} size={40} />
          <AppText variant="label" style={{ textAlign: "center" }}>
            {t("nav.more")}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function Home() {
  const { t, date, dateTime, number } = useI18n();
  const router = useRouter();
  const { theme } = useTheme();
  const { user, profile, supabase: sb } = useUser();
  const schedule = useSchedule();
  const layout = tileLayout();

  const extras = useAsync(async () => {
    const [unread, streakRes, xp] = await Promise.all([
      sb.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
      sb.from("streaks").select("current_streak,longest_streak,last_active_date").eq("user_id", user.id).maybeSingle(),
      sumPoints(async (from, to) => ((unwrap(await sb.from("xp_events").select("points").eq("user_id", user.id).range(from, to)) as { points: number }[]) ?? []).map((r) => r.points)),
    ]);
    const progress: ProgressSummary = { xp, streak: parseStreak(streakRes.data) };
    return { unread: unread.count ?? 0, progress };
  }, [user.id]);

  // Tab screens stay mounted: refresh server data whenever Home regains focus (new XP, tasks, notifications).
  const reloadExtras = extras.reload;
  const reloadSchedule = schedule.reload;
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      reloadExtras();
      reloadSchedule();
    }, [reloadExtras, reloadSchedule]),
  );

  const now = new Date();
  const today = localDay(now);
  const upcoming = schedule.data ? upcomingItems(schedule.data.tasks, schedule.data.exams, now, 3) : [];
  const progress = extras.data?.progress;
  const streak = progress ? liveStreak(progress.streak, today) : null;
  const name = profile?.display_name?.trim();

  return (
    <Screen>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md }}>
        <BrandHeader />
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <CircleButton label={(extras.data?.unread ?? 0) > 0 ? t("mobile.home.notificationsUnread") : t("mobile.home.notifications")} onPress={() => router.push("/notifications")}>
            <Icon name="notifications" color={theme.text} />
            {(extras.data?.unread ?? 0) > 0 ? <View style={{ position: "absolute", top: 8, right: 9, width: 10, height: 10, borderRadius: 5, backgroundColor: theme.danger }} /> : null}
          </CircleButton>
          <CircleButton label={t("brand.module.profile")} onPress={() => router.navigate("/profile")}>
            <Icon name="profile" color={theme.text} />
          </CircleButton>
        </View>
      </View>

      <View style={{ gap: 4 }}>
        <AppText variant="display" accessibilityRole="header">
          {name ? t("mobile.home.greeting", { name }) : t("mobile.home.greetingAnon")} {"👋"}
        </AppText>
        <AppText muted>{t("mobile.home.subtitle")}</AppText>
      </View>

      <HeroCarousel items={heroModules()} />
      <TileGrid items={layout.tiles} hasMore={layout.overflow.length > 0} />

      <Card accessibilityRole="summary">
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <AppText variant="heading">{t("mobile.home.progressTitle")}</AppText>
          {progress && (progress.xp ?? 0) > 0 ? (
            <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
              <Icon name="xp" size="sm" color={theme.warning} />
              <AppText variant="label">{t("mobile.home.xp", { n: number(progress.xp ?? 0) })}</AppText>
            </View>
          ) : null}
        </View>
        {extras.loading && !extras.data ? (
          <Skeleton height={48} />
        ) : progress && hasProgress(progress, today) ? (
          <View style={{ gap: spacing.sm }}>
            {streak !== null ? (
              <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center", backgroundColor: theme.cardStrong, borderRadius: radii.pill, paddingHorizontal: spacing.md, minHeight: 40 }}>
                <Icon name="streak" size="sm" color={theme.warning} />
                <AppText>{t("mobile.home.streak", { n: streak })}</AppText>
              </View>
            ) : null}
            {progress.streak && progress.streak.longest_streak > 0 ? (
              <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center", backgroundColor: theme.cardStrong, borderRadius: radii.pill, paddingHorizontal: spacing.md, minHeight: 40 }}>
                <Icon name="achievements" size="sm" color={theme.active} />
                <AppText>{t("mobile.home.bestStreak", { n: progress.streak.longest_streak })}</AppText>
              </View>
            ) : null}
          </View>
        ) : extras.error ? (
          <AppText muted>{t("dashboard.loadFailed")}</AppText>
        ) : (
          <AppText muted>{t("mobile.home.progressEmpty")}</AppText>
        )}
      </Card>

      <View style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <AppText variant="heading" accessibilityRole="header">
            {t("mobile.home.upcomingTitle")}
          </AppText>
          <Pressable onPress={() => router.navigate("/planner")} accessibilityRole="link" hitSlop={10}>
            <AppText variant="label" style={{ color: theme.active }}>
              {t("mobile.home.seeAll")}
            </AppText>
          </Pressable>
        </View>
        {schedule.loading && !schedule.data ? (
          <Skeleton height={64} />
        ) : upcoming.length === 0 ? (
          <EmptyState title={t("dashboard.nothingUpcoming")} />
        ) : (
          upcoming.map((u) => {
            const isToday = localDay(new Date(u.at)) === today;
            const overdue = new Date(u.at).getTime() < now.getTime();
            return (
              <Card key={`${u.kind}-${u.id}`} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                <Icon name={u.kind === "exam" ? "exams" : "tasks"} color={theme.active} />
                <View style={{ flex: 1 }}>
                  <AppText style={{ fontWeight: "600" }}>{u.title}</AppText>
                  <AppText variant="caption" muted>
                    {u.kind === "exam" ? dateTime(u.at) : date(u.at, { day: "numeric", month: "long" })}
                  </AppText>
                </View>
                {overdue && u.kind === "task" ? <Badge tone="danger">{t("planner.overdue")}</Badge> : isToday ? <Badge tone="warning">{t("mobile.home.dueToday")}</Badge> : u.kind === "exam" ? <Badge tone="warning">{t("planner.tabs.exams")}</Badge> : null}
              </Card>
            );
          })
        )}
      </View>
    </Screen>
  );
}
