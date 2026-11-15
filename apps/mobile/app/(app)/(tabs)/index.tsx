import { absenceStatus, buildAgenda, localDay, parseMyProgress } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useCallback, useRef, type ComponentRef } from "react";
import { Image, Text, View } from "react-native";
import type { MessageKey } from "@unimate/i18n";
import { ModuleDeck } from "../../../src/features/home/ModuleDeck";
import { ProgressRing } from "../../../src/components/ProgressRing";
import type { IconName } from "@unimate/ui/icons";

/** Modules that are also tab-bar tabs use the same glyph as their tab (SF sparkles / building.columns / briefcase). */
const TAB_ICON: Partial<Record<string, IconName>> = { aiStudy: "sparkles", campus: "institution", career: "jobs" };
import { useAvatar } from "../../../src/features/profile/avatar";
import { SpotlightTour } from "../../../src/features/tour/SpotlightTour";
import { Icon } from "../../../src/components/Icon";
import { AppText, Pill, PressableScale, Reveal, RoundAction, Screen, Skeleton } from "../../../src/components/ui";
import { useSchedule } from "../../../src/features/planner/useSchedule";
import { tileLayout } from "../../../src/lib/registry";
import { useLocalValue } from "../../../src/lib/local-store";
import { EMPTY_COURSES, coursesKey, coursesStoreSchema } from "../../../src/features/semester/store";
import { useAsync } from "../../../src/lib/use-async";
import { useUser } from "../../../src/state/session";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { MIN_TOUCH, radii, spacing } from "../../../src/theme/tokens";

const go = (r: ReturnType<typeof useRouter>, href: string) => r.push(href as Href);

function RoundButton({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={{ width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: MIN_TOUCH / 2, backgroundColor: theme.card, alignItems: "center", justifyContent: "center" }}>
      {children}
    </PressableScale>
  );
}

interface Item {
  key: string;
  title: string;
  meta: string;
  danger?: boolean;
  warn?: boolean;
  today?: boolean;
  onPress: () => void;
}

/**
 * Home: typography-led day page. Oversized light headline, today's date, the one thing that is next as a big card,
 * the rest as a quiet list, a single dark progress card, then modules in one accent.
 */
export default function Home() {
  const { t, date, dateTime, number, percent } = useI18n();
  const router = useRouter();
  const { theme } = useTheme();
  const { user, profile, supabase: sb } = useUser();
  const avatar = useAvatar(user.id);
  const schedule = useSchedule();
  const layout = tileLayout();
  const tourActions = useRef<ComponentRef<typeof View>>(null);
  const tourGreeting = useRef<ComponentRef<typeof View>>(null);
  const tourAgenda = useRef<ComponentRef<typeof View>>(null);
  const tourTiles = useRef<ComponentRef<typeof View>>(null);

  const extras = useAsync(async () => {
    const [unread, prog] = await Promise.all([sb.rpc("unread_notification_count"), sb.rpc("my_progress")]);
    return { unread: typeof unread.data === "number" ? unread.data : 0, progress: prog.error ? null : parseMyProgress(prog.data) };
  }, [user.id]);

  // Tab screens stay mounted: refresh server data whenever Home regains focus (new XP, tasks, notifications).
  const courses = useLocalValue(coursesKey(user.id), coursesStoreSchema, EMPTY_COURSES);
  const reloadExtras = extras.reload;
  const reloadSchedule = schedule.reload;
  const reloadCourses = courses.reload;
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      reloadExtras();
      reloadSchedule();
      reloadCourses();
    }, [reloadExtras, reloadSchedule, reloadCourses]),
  );

  const now = new Date();
  const today = localDay(now);
  // "Up next": absence-limit warnings from My courses first (device-local), then the ranked planner agenda.
  const risks = courses.value.courses
    .map((c) => ({ c, s: absenceStatus(c.totalHours, c.missedHours, courses.value.rules) }))
    .filter((x) => x.s.level !== "ok")
    .sort((a, b) => a.s.remainingHours - b.s.remainingHours)
    .slice(0, 2);
  const agenda = (schedule.data ? buildAgenda(schedule.data.tasks, schedule.data.exams, 0, now, 4 - risks.length) : []).filter((u) => u.kind !== "cards");
  const items: Item[] = [
    ...risks.map(({ c, s }) => ({
      key: `risk-${c.id}`,
      title: c.name,
      meta: s.level === "over" ? t("semester.level.over") : t("semester.remaining", { n: Math.max(0, s.remainingHours) }),
      danger: s.level === "over",
      warn: s.level !== "over",
      onPress: () => go(router, "/courses"),
    })),
    ...agenda.map((u) => ({
      key: `${u.kind}-${u.id}`,
      title: u.title,
      meta: u.kind === "overdue" ? t("dashboard.agenda.overdue", { date: date(u.at, { day: "numeric", month: "long" }) }) : u.kind === "exam" ? t("dashboard.agenda.examIn", { n: u.days }) : t("dashboard.agenda.due", { date: dateTime(u.at) }),
      danger: u.kind === "overdue",
      today: localDay(new Date(u.at)) === today && u.kind !== "overdue",
      onPress: () => router.navigate("/planner"),
    })),
  ];
  const head = items[0];
  const more = items.length - 1;
  const progress = extras.data?.progress ?? null;
  const name = profile?.display_name?.trim();
  const unread = extras.data?.unread ?? 0;
  const metaColor = (i: Item) => (i.danger ? theme.danger : i.warn ? theme.warning : theme.textMuted);
  const pct = progress ? percent(progress.level_progress, { maximumFractionDigits: 0 }) : "";

  // One screen, no scroll: header, today's next item as the headline, the module deck, then progress.
  // A fixed page keeps the deck's vertical swipes from ever moving the screen.
  return (
    <Screen ambient scroll={false} style={{ gap: spacing.lg }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="caption" muted>
            {t("mobile.home.welcomeBack")}
          </AppText>
          <AppText numberOfLines={1} style={{ fontWeight: "600", fontSize: 18 }}>
            {name || t("mobile.home.greetingAnon")}
          </AppText>
        </View>
        <View ref={tourActions} collapsable={false} style={{ flexDirection: "row", gap: spacing.sm }}>
          <RoundButton label={unread > 0 ? t("mobile.home.notificationsUnread") : t("mobile.home.notifications")} onPress={() => router.push("/notifications")}>
            <Icon name="notifications" color={theme.text} />
            {unread > 0 ? <View style={{ position: "absolute", top: 10, right: 11, width: 9, height: 9, borderRadius: 5, backgroundColor: theme.danger, borderWidth: 2, borderColor: theme.card }} /> : null}
          </RoundButton>
          <RoundButton label={t("brand.module.profile")} onPress={() => router.push("/profile")}>
            {avatar.uri ? <Image source={{ uri: avatar.uri }} accessibilityIgnoresInvertColors style={{ width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: MIN_TOUCH / 2 }} /> : <Icon name="profile" color={theme.text} />}
          </RoundButton>
        </View>
      </View>

      {/* "Yaxın işlər" headline: the next item IS the headline, in the same light large type. */}
      <View ref={tourGreeting} collapsable={false}>
        <View ref={tourAgenda} collapsable={false} style={{ gap: spacing.md }}>
          {schedule.loading && !schedule.data ? (
            <Skeleton height={130} radius={radii.xl} />
          ) : (
            <Reveal>
              <PressableScale
                onPress={head ? head.onPress : () => router.navigate("/planner")}
                accessibilityRole="button"
                accessibilityLabel={head ? `${t("mobile.home.heroStrong")}: ${head.title}. ${head.meta}` : `${t("mobile.home.heroStrong")}. ${t("dashboard.nothingUpcoming")}`}
                style={{ gap: 2 }}
              >
                <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                  <Text maxFontSizeMultiplier={1.2} style={{ color: theme.textMuted, fontSize: 34, lineHeight: 40, fontWeight: "300", letterSpacing: -0.8 }}>
                    {t("mobile.home.heroStrong")}
                  </Text>
                  <Text maxFontSizeMultiplier={1.2} style={{ color: theme.textMuted, fontSize: 15, fontWeight: "400", marginLeft: 4, marginTop: 2 }}>
                    ({items.length})
                  </Text>
                </View>
                <Text maxFontSizeMultiplier={1.2} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7} style={{ color: theme.text, fontSize: 34, lineHeight: 40, fontWeight: "300", letterSpacing: -0.8 }}>
                  {head ? head.title : t("dashboard.nothingUpcoming")}
                </Text>
                <AppText variant="caption" numberOfLines={1} style={{ color: head ? metaColor(head) : theme.textMuted }}>
                  {head ? (more > 0 ? `${head.meta} · +${more}` : head.meta) : t("dashboard.agenda.clear")}
                </AppText>
              </PressableScale>
            </Reveal>
          )}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Pill tone="accent" label={`${date(now, { weekday: "short" })}, ${date(now, { day: "numeric", month: "long" })}`} />
            <RoundAction label={t("brand.module.planner")} icon={<Icon name="add" size={24} />} onPress={() => router.navigate("/planner")} />
          </View>
        </View>
      </View>

      <View ref={tourTiles} collapsable={false}>
        <ModuleDeck
          items={[
            ...layout.tiles.map((m) => ({ id: m.id, icon: TAB_ICON[m.id] ?? m.icon, title: t(m.labelKey), blurb: t(`mobile.home.moduleBlurb.${m.id}` as MessageKey), onPress: () => go(router, m.href) })),
            ...(layout.overflow.length > 0 ? [{ id: "more", icon: "more" as const, title: t("nav.more"), blurb: t("mobile.home.moduleBlurb.more"), onPress: () => router.navigate("/more") }] : []),
          ]}
        />
      </View>

      {/* Progress in the reference's ring-card form, in brand indigo. */}
      {extras.loading && !extras.data ? (
        <Skeleton height={150} radius={radii.xxl} />
      ) : progress ? (
        <PressableScale
          onPress={() => go(router, "/gamification")}
          accessibilityRole="button"
          accessibilityLabel={`${t("mobile.home.progressTitle")}. ${t("gamification.level", { n: progress.level })}. ${pct}`}
          style={{ flexDirection: "row", alignItems: "center", gap: spacing.lg, padding: spacing.lg, borderRadius: radii.xxl, borderCurve: "continuous", backgroundColor: theme.mode === "dark" ? theme.secondary : theme.primary }}
        >
          <ProgressRing fraction={progress.level_progress} size={92} stroke={11} track="rgba(255,255,255,0.22)" from="#FFFFFF" to="#C7D2FE" labelColor="#FFFFFF" label={t("gamification.levelProgress")}>
            {pct}
          </ProgressRing>
          <View style={{ flex: 1, gap: spacing.sm }}>
            <Text maxFontSizeMultiplier={1.2} numberOfLines={2} style={{ color: "#FFFFFF", fontSize: 22, lineHeight: 26, fontWeight: "300", letterSpacing: -0.4 }}>
              {t("mobile.home.progressTitle")}
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              <View style={{ paddingHorizontal: 12, minHeight: 28, justifyContent: "center", borderRadius: 999, backgroundColor: "#FFFFFF" }}>
                <Text maxFontSizeMultiplier={1.2} style={{ color: "#1E1B4B", fontSize: 12, fontWeight: "700" }}>
                  {t("gamification.level", { n: progress.level })}
                </Text>
              </View>
              <View style={{ paddingHorizontal: 12, minHeight: 28, justifyContent: "center", borderRadius: 999, borderWidth: 1, borderColor: "rgba(255,255,255,0.6)" }}>
                <Text maxFontSizeMultiplier={1.2} style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "600" }}>
                  {t("mobile.home.xp", { n: number(progress.xp) })}
                </Text>
              </View>
            </View>
            <AppText variant="caption" numberOfLines={1} style={{ color: "rgba(255,255,255,0.8)" }}>
              {progress.streak.current > 0 ? t("gamification.streak", { n: progress.streak.current }) : t("gamification.noStreak")}
            </AppText>
          </View>
        </PressableScale>
      ) : null}

      <SpotlightTour
        uid={user.id}
        steps={[
          { ref: tourGreeting, title: t("teach.tour.s1"), body: t("teach.tour.s1b") },
          { ref: tourActions, title: t("teach.tour.s2"), body: t("teach.tour.s2b") },
          { ref: tourAgenda, title: t("teach.tour.s3"), body: t("teach.tour.s3b") },
          { ref: tourTiles, title: t("teach.tour.s4"), body: t("teach.tour.s4b") },
        ]}
      />
    </Screen>
  );
}
