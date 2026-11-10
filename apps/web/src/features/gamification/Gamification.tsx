"use client";

import {
  ACHIEVEMENT_ICON_FALLBACK,
  localizedText,
  parseAchievements,
  parseLeaderboard,
  parseMyProgress,
  type LeaderboardPeriod,
  type LeaderboardScope,
} from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, ICON_NAMES, Icon, ProgressRing, Skeleton, useToast, type IconName } from "@unimate/ui";
import { useId, useState } from "react";
import { useUser } from "@/components/user";
import { getBrowserClient } from "@/lib/supabase/browser";
import { unwrap, useAsync } from "@/lib/use-async";

const iconFor = (key: string): IconName => (ICON_NAMES.includes(key as IconName) ? (key as IconName) : ACHIEVEMENT_ICON_FALLBACK);

function Seg<T extends string>({ legend, value, onChange, options }: { legend: string; value: T; onChange: (v: T) => void; options: readonly { value: T; label: string }[] }) {
  const name = useId();
  return (
    <fieldset className="seg">
      <legend className="um-sr-only">{legend}</legend>
      <div className="seg__row">
        {options.map((o) => (
          <label key={o.value} className="seg__item">
            <input type="radio" className="um-sr-only" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Leaderboard({ optedIn, hasUniversity }: { optedIn: boolean; hasUniversity: boolean }) {
  const { t, number } = useI18n();
  const [scope, setScope] = useState<LeaderboardScope>(hasUniversity ? "university" : "global");
  const [period, setPeriod] = useState<LeaderboardPeriod>("week");
  const board = useAsync(async () => parseLeaderboard(unwrap(await getBrowserClient().rpc("leaderboard", { p_scope: scope, p_period: period }))), [scope, period, optedIn]);
  const rows = board.data ?? [];
  const me = rows.find((r) => r.is_me);
  return (
    <div className="stack">
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Seg<LeaderboardScope> legend={t("gamification.leaderboardTitle")} value={scope} onChange={setScope} options={[{ value: "university", label: t("gamification.scopeUniversity") }, { value: "global", label: t("gamification.scopeGlobal") }]} />
        <Seg<LeaderboardPeriod> legend={t("gamification.leaderboardTitle")} value={period} onChange={setPeriod} options={[{ value: "week", label: t("gamification.periodWeek") }, { value: "all", label: t("gamification.periodAll") }]} />
      </div>
      {scope === "university" && !hasUniversity ? (
        <p className="um-muted">{t("gamification.noUniversity")}</p>
      ) : board.loading && !board.data ? (
        <Skeleton height={56} />
      ) : board.error ? (
        <ErrorState title={t("gamification.loadFailed")} description={board.error} action={<Button onClick={board.reload}>{t("common.retry")}</Button>} />
      ) : (
        <>
          {rows.every((r) => r.rank === null) ? <p className="um-muted">{t("gamification.leaderboardEmpty")}</p> : null}
          <ol className="list" style={{ listStyle: "none", padding: 0 }}>
            {rows.map((r, i) => (
              <li key={`${r.rank ?? "me"}-${i}`} className="list-item" aria-current={r.is_me ? "true" : undefined} style={r.is_me ? { background: "var(--primary-soft)" } : undefined}>
                <span className="stat" style={{ fontSize: "var(--text-md)", minWidth: 48 }}>
                  {r.rank !== null ? `#${number(r.rank)}` : "–"}
                </span>
                <Avatar name={r.display_name} src={r.avatar_url} size={32} />
                <span className="list-item__title" style={{ flex: 1 }}>
                  {r.is_me ? t("gamification.you") : (r.display_name ?? t("gamification.anonymous"))}
                </span>
                <span className="um-muted">{t("gamification.xp", { n: number(r.xp) })}</span>
              </li>
            ))}
          </ol>
          {me && me.rank === null ? <p className="um-muted">{t("gamification.notRanked")}</p> : null}
        </>
      )}
    </div>
  );
}

/** Level, XP, streak, achievements, challenges and the opt-in leaderboard. Every number comes from the my_progress / my_achievements / leaderboard RPCs. */
export function Gamification() {
  const { t, locale, date, number, percent } = useI18n();
  const user = useUser();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const data = useAsync(async () => {
    const sb = getBrowserClient();
    const [progress, achievements, profile] = await Promise.all([sb.rpc("my_progress"), sb.rpc("my_achievements"), sb.from("profiles").select("university_id").eq("id", user.id).maybeSingle()]);
    return {
      progress: parseMyProgress(unwrap(progress)),
      achievements: parseAchievements(unwrap(achievements)),
      hasUniversity: !!(profile.data as { university_id: string | null } | null)?.university_id,
    };
  }, [user.id]);

  async function toggleOptIn(next: boolean) {
    setSaving(true);
    const { error } = await getBrowserClient().rpc("set_leaderboard_opt_in", { p_opt_in: next });
    setSaving(false);
    if (error) toast(t("common.genericError"), "error");
    else data.reload();
  }

  const p = data.data?.progress;
  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>{t("brand.module.gamification")}</h1>
      </div>
      {data.loading && !data.data ? (
        <Skeleton height={140} />
      ) : data.error || !p ? (
        <ErrorState title={t("gamification.loadFailed")} description={data.error ?? undefined} action={<Button onClick={data.reload}>{t("common.retry")}</Button>} />
      ) : (
        <>
          <Card>
            <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
              <ProgressRing value={p.level_progress * 100} label={t("gamification.levelProgress")}>
                {percent(p.level_progress, { maximumFractionDigits: 0 })}
              </ProgressRing>
              <div className="stack">
                <p className="stat">{t("gamification.level", { n: p.level })}</p>
                <p>
                  <Icon name="xp" size={18} /> {t("gamification.xp", { n: number(p.xp) })}
                </p>
                <p className="um-muted">{p.next_level_xp === null ? t("gamification.maxLevel") : t("gamification.xpToNext", { n: number(p.xp_to_next), next: p.level + 1 })}</p>
                <p>
                  <Icon name="streak" size={18} /> {p.streak.current > 0 ? t("gamification.streak", { n: p.streak.current }) : t("gamification.noStreak")}
                  {p.streak.longest > 0 ? <span className="um-muted"> · {t("gamification.bestStreak", { n: p.streak.longest })}</span> : null}
                </p>
              </div>
            </div>
          </Card>

          <section aria-labelledby="ach-h" className="stack">
            <h2 id="ach-h">
              {t("gamification.achievementsTitle")} <Badge>{t("gamification.progressOf", { a: p.achievements.unlocked, b: p.achievements.total })}</Badge>
            </h2>
            {data.data!.achievements.length === 0 ? (
              <EmptyState title={t("gamification.achievementsEmpty")} />
            ) : (
              <ul className="grid-stats" style={{ listStyle: "none", padding: 0 }}>
                {data.data!.achievements.map((a) => {
                  const done = a.unlocked_at !== null;
                  return (
                    <li key={a.code}>
                      <Card style={{ opacity: done ? 1 : 0.75, height: "100%" }}>
                        <Icon name={done ? iconFor(a.icon) : "locked"} size={28} />
                        <p className="list-item__title">{localizedText(a.name, locale)}</p>
                        <p className="um-muted">{localizedText(a.description, locale)}</p>
                        <p className="um-muted">{done ? t("gamification.unlockedOn", { date: date(a.unlocked_at!, { dateStyle: "medium" }) }) : t("gamification.progressOf", { a: number(a.current), b: number(a.target) })}</p>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="chal-h" className="stack">
            <h2 id="chal-h">{t("gamification.challengesTitle")}</h2>
            {p.challenges.length === 0 ? (
              <p className="um-muted">{t("gamification.challengesEmpty")}</p>
            ) : (
              <ul className="list" style={{ listStyle: "none", padding: 0 }}>
                {p.challenges.map((c) => (
                  <li key={c.id} className="list-item" style={{ display: "grid", gap: 6 }}>
                    <span className="list-item__title">
                      <Icon name={c.completed ? "success" : "challenges"} size={18} /> {localizedText(c.title, locale)}
                    </span>
                    <span className="um-muted">{localizedText(c.description, locale)}</span>
                    <div className="quiz-progress" role="progressbar" aria-valuemin={0} aria-valuemax={c.target} aria-valuenow={c.progress} aria-label={localizedText(c.title, locale)}>
                      <span style={{ width: `${c.target > 0 ? Math.min(100, (c.progress / c.target) * 100) : 0}%` }} />
                    </div>
                    <span className="um-muted">
                      {c.completed ? t("gamification.completed") : t("gamification.progressOf", { a: number(c.progress), b: number(c.target) })} · {t("gamification.endsOn", { date: date(c.ends_at, { dateStyle: "medium" }) })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="lb-h" className="stack">
            <h2 id="lb-h">{t("gamification.leaderboardTitle")}</h2>
            <Card>
              <label style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <input type="checkbox" checked={p.leaderboard_opt_in} disabled={saving} onChange={(e) => void toggleOptIn(e.target.checked)} style={{ marginTop: 4 }} />
                <span className="stack" style={{ gap: 4 }}>
                  <span className="list-item__title">{t("gamification.optInLabel")}</span>
                  <span className="um-muted">{t("gamification.optInBody")}</span>
                </span>
              </label>
            </Card>
            <Leaderboard optedIn={p.leaderboard_opt_in} hasUniversity={data.data!.hasUniversity} />
          </section>
        </>
      )}
    </div>
  );
}
