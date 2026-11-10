import {
  ACHIEVEMENT_ICON_FALLBACK,
  localizedText,
  parseAchievements,
  parseLeaderboard,
  parseMyProgress,
  type AchievementItem,
  type LeaderRow,
  type LeaderboardPeriod,
  type LeaderboardScope,
} from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { ICON_PATHS, type IconName } from "@unimate/ui/icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Switch, View } from "react-native";
import { Icon, ModuleIcon } from "../../components/Icon";
import { ProgressRing } from "../../components/ProgressRing";
import { AppText, Button, Card, EmptyState, ErrorState, Screen, ScreenHeader, Segmented, Skeleton, useToast } from "../../components/ui";
import { unwrap, useAsync } from "../../lib/use-async";
import { useUser } from "../../state/session";
import { useTheme } from "../../theme/ThemeProvider";
import { radii, spacing } from "../../theme/tokens";

const iconFor = (key: string): IconName => ((key in ICON_PATHS ? key : ACHIEVEMENT_ICON_FALLBACK) as IconName);

function Bar({ fraction, color, track }: { fraction: number; color: string; track: string }) {
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: track, overflow: "hidden" }}>
      <View style={{ width: `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`, height: 8, backgroundColor: color }} />
    </View>
  );
}

function AchievementTile({ a, width }: { a: AchievementItem; width: number }) {
  const { t, locale, date, number } = useI18n();
  const { theme } = useTheme();
  const done = a.unlocked_at !== null;
  const name = localizedText(a.name, locale);
  const desc = localizedText(a.description, locale);
  return (
    <View
      accessible
      accessibilityLabel={`${name}. ${desc}. ${done ? t("gamification.unlockedOn", { date: date(a.unlocked_at!) }) : t("gamification.locked")}`}
      style={{ width, borderRadius: radii.lg, borderWidth: 1, borderColor: done ? theme.active : theme.cardBorder, backgroundColor: theme.card, padding: spacing.sm, alignItems: "center", gap: 6, opacity: done ? 1 : 0.72 }}
    >
      {done ? <ModuleIcon icon={iconFor(a.icon)} colors={["#B45309", "#C2410C"]} size={44} /> : <ModuleIcon icon="locked" colors={["#475569", "#334155"]} size={44} />}
      <AppText variant="label" numberOfLines={2} style={{ textAlign: "center" }}>
        {name}
      </AppText>
      <AppText variant="caption" muted numberOfLines={3} style={{ textAlign: "center" }}>
        {done ? t("gamification.unlockedOn", { date: date(a.unlocked_at!, { day: "numeric", month: "short" }) }) : t("gamification.progressOf", { a: number(a.current), b: number(a.target) })}
      </AppText>
    </View>
  );
}

function Leaderboard({ optedIn, hasUniversity }: { optedIn: boolean; hasUniversity: boolean }) {
  const { t, number } = useI18n();
  const { theme } = useTheme();
  const { supabase: sb } = useUser();
  const [scope, setScope] = useState<LeaderboardScope>(hasUniversity ? "university" : "global");
  const [period, setPeriod] = useState<LeaderboardPeriod>("week");
  const board = useAsync(async () => parseLeaderboard(unwrap(await sb.rpc("leaderboard", { p_scope: scope, p_period: period }))), [scope, period, optedIn]);
  const rows = board.data ?? [];
  const me = rows.find((r: LeaderRow) => r.is_me);
  return (
    <View style={{ gap: spacing.sm }}>
      <Segmented<LeaderboardScope> label={t("gamification.leaderboardTitle")} value={scope} onChange={setScope} options={[{ value: "university", label: t("gamification.scopeUniversity") }, { value: "global", label: t("gamification.scopeGlobal") }]} />
      <Segmented<LeaderboardPeriod> label={t("gamification.leaderboardTitle")} value={period} onChange={setPeriod} options={[{ value: "week", label: t("gamification.periodWeek") }, { value: "all", label: t("gamification.periodAll") }]} />
      {scope === "university" && !hasUniversity ? (
        <AppText muted>{t("gamification.noUniversity")}</AppText>
      ) : board.loading && !board.data ? (
        <Skeleton height={56} />
      ) : board.error ? (
        <ErrorState title={t("common.genericError")} description={board.error} action={<Button title={t("common.retry")} onPress={board.reload} />} />
      ) : (
        <>
          {rows.filter((r) => r.rank !== null).length === 0 ? <AppText muted>{t("gamification.leaderboardEmpty")}</AppText> : null}
          {rows.map((r, i) => (
            <View key={`${r.rank ?? "me"}-${i}`} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: r.is_me ? theme.primarySoft : theme.card, borderColor: theme.cardBorder, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, minHeight: 48 }}>
              <AppText variant="label" style={{ width: 36 }}>
                {r.rank !== null ? `#${number(r.rank)}` : "–"}
              </AppText>
              <AppText style={{ flex: 1 }} numberOfLines={1}>
                {r.is_me ? t("gamification.you") : r.display_name ?? t("gamification.anonymous")}
              </AppText>
              <AppText variant="label">{t("gamification.xp", { n: number(r.xp) })}</AppText>
            </View>
          ))}
          {me && me.rank === null ? <AppText muted>{t("gamification.notRanked")}</AppText> : null}
        </>
      )}
    </View>
  );
}

/** Level, XP, streak, achievements, challenges and the opt-in leaderboard. Every number comes from the my_progress / my_achievements / leaderboard RPCs. */
export function GamificationScreen() {
  const { t, locale, date, number, percent } = useI18n();
  const router = useRouter();
  const { theme } = useTheme();
  const { toast } = useToast();
  const { profile, supabase: sb } = useUser();
  const data = useAsync(async () => {
    const [progress, achievements] = await Promise.all([sb.rpc("my_progress"), sb.rpc("my_achievements")]);
    return { progress: parseMyProgress(unwrap(progress)), achievements: parseAchievements(unwrap(achievements)) };
  }, []);
  const [saving, setSaving] = useState(false);
  const reload = data.reload;

  async function toggleOptIn(next: boolean) {
    setSaving(true);
    const { error } = await sb.rpc("set_leaderboard_opt_in", { p_opt_in: next });
    setSaving(false);
    if (error) toast(t("common.genericError"), "error");
    else reload();
  }

  const p = data.data?.progress;
  const tileW = 104;
  return (
    <Screen>
      <ScreenHeader title={t("brand.module.gamification")} onBack={() => router.back()} />
      {data.loading && !data.data ? (
        <Skeleton height={140} />
      ) : data.error || !p ? (
        <ErrorState title={t("gamification.loadFailed")} description={data.error ?? undefined} action={<Button title={t("common.retry")} onPress={reload} />} />
      ) : (
        <View style={{ gap: spacing.lg }}>
          <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.lg }}>
            <ProgressRing fraction={p.level_progress} track={theme.cardStrong} from="#22D3EE" to="#A855F7" label={t("gamification.levelProgress")}>
              {percent(p.level_progress, { maximumFractionDigits: 0 })}
            </ProgressRing>
            <View style={{ flex: 1, gap: 6 }}>
              <AppText variant="title">{t("gamification.level", { n: p.level })}</AppText>
              <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                <Icon name="xp" size="sm" color={theme.warning} />
                <AppText variant="label">{t("gamification.xp", { n: number(p.xp) })}</AppText>
              </View>
              <AppText variant="caption" muted>
                {p.next_level_xp === null ? t("gamification.maxLevel") : t("gamification.xpToNext", { n: number(p.xp_to_next), next: p.level + 1 })}
              </AppText>
              <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                <Icon name="streak" size="sm" color={theme.warning} />
                <AppText variant="caption">{p.streak.current > 0 ? t("gamification.streak", { n: p.streak.current }) : t("gamification.noStreak")}</AppText>
              </View>
              {p.streak.longest > 0 ? (
                <AppText variant="caption" muted>
                  {t("gamification.bestStreak", { n: p.streak.longest })}
                </AppText>
              ) : null}
            </View>
          </Card>

          <View style={{ gap: spacing.sm }}>
            <AppText variant="heading" accessibilityRole="header">
              {t("gamification.achievementsTitle")} · {t("gamification.progressOf", { a: p.achievements.unlocked, b: p.achievements.total })}
            </AppText>
            {data.data!.achievements.length === 0 ? (
              <EmptyState title={t("gamification.achievementsEmpty")} />
            ) : (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                {data.data!.achievements.map((a) => (
                  <AchievementTile key={a.code} a={a} width={tileW} />
                ))}
              </View>
            )}
          </View>

          <View style={{ gap: spacing.sm }}>
            <AppText variant="heading" accessibilityRole="header">
              {t("gamification.challengesTitle")}
            </AppText>
            {p.challenges.length === 0 ? (
              <AppText muted>{t("gamification.challengesEmpty")}</AppText>
            ) : (
              p.challenges.map((c) => (
                <Card key={c.id}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <Icon name={c.completed ? "success" : "challenges"} color={c.completed ? theme.success : theme.active} />
                    <AppText variant="label" style={{ flex: 1 }}>
                      {localizedText(c.title, locale)}
                    </AppText>
                  </View>
                  <AppText muted>{localizedText(c.description, locale)}</AppText>
                  <Bar fraction={c.target > 0 ? c.progress / c.target : 0} color={c.completed ? theme.success : theme.active} track={theme.cardStrong} />
                  <AppText variant="caption" muted>
                    {c.completed ? t("gamification.completed") : t("gamification.progressOf", { a: number(c.progress), b: number(c.target) })} · {t("gamification.endsOn", { date: date(c.ends_at, { day: "numeric", month: "short" }) })}
                  </AppText>
                </Card>
              ))
            )}
          </View>

          <View style={{ gap: spacing.sm }}>
            <AppText variant="heading" accessibilityRole="header">
              {t("gamification.leaderboardTitle")}
            </AppText>
            <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <View style={{ flex: 1, gap: 4 }}>
                <AppText variant="label">{t("gamification.optInLabel")}</AppText>
                <AppText variant="caption" muted>
                  {t("gamification.optInBody")}
                </AppText>
              </View>
              <Switch value={p.leaderboard_opt_in} disabled={saving} onValueChange={(v) => void toggleOptIn(v)} accessibilityLabel={t("gamification.optInLabel")} />
            </Card>
            <Leaderboard optedIn={p.leaderboard_opt_in} hasUniversity={!!profile?.university_id} />
          </View>
        </View>
      )}
    </Screen>
  );
}
