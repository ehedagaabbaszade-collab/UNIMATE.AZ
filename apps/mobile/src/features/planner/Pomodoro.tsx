import { DEFAULT_POMODORO_XP, pomodoroXp } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { AppText, Button, Card, Notice, Segmented, Skeleton, useToast } from "../../components/ui";
import type { StudySessionRow } from "../../lib/db";
import { DURATION_MS, focusedSeconds, formatClock, nextMode, remainingMs, type TimerMode } from "../../lib/timer";
import { unwrap, useAsync } from "../../lib/use-async";
import { useUser } from "../../state/session";
import { useTheme } from "../../theme/ThemeProvider";

const MODES: TimerMode[] = ["work", "shortBreak", "longBreak"];

function Ring({ value, max, size = 220, stroke = 12, label, children }: { value: number; max: number; size?: number; stroke?: number; label: string; children: React.ReactNode }) {
  const { theme } = useTheme();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <View accessible accessibilityRole="timer" accessibilityLabel={label} style={{ width: size, height: size, alignSelf: "center", alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={theme.cardStrong} strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={theme.active} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} />
      </Svg>
      {children}
    </View>
  );
}

/**
 * Pomodoro. Wall-clock based (endAt), so backgrounding the app cannot make it drift. Finished focus blocks are saved
 * to study_sessions (the only write the database allows); XP shown here is an estimate, the same as on web:
 * the backend has no client-callable XP award for focus sessions.
 */
export function Pomodoro() {
  const { t, dateTime, number } = useI18n();
  const { user, supabase: sb } = useUser();
  const { toast } = useToast();
  const [mode, setMode] = useState<TimerMode>("work");
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(DURATION_MS.work);
  const [lastXp, setLastXp] = useState<number | null>(null);
  const [blocks, setBlocks] = useState(0);
  const endAt = useRef(0);
  const startedAt = useRef<Date | null>(null);

  const sessions = useAsync<StudySessionRow[]>(async () => {
    const since = new Date();
    since.setDate(since.getDate() - 7);
    return unwrap(await sb.from("study_sessions").select("id,started_at,ended_at,duration_seconds").gte("started_at", since.toISOString()).order("started_at", { ascending: false }).limit(30)) as StudySessionRow[];
  }, []);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todays = (sessions.data ?? []).filter((s) => new Date(s.started_at) >= todayStart);
  const todaySeconds = todays.reduce((n, s) => n + (s.duration_seconds ?? 0), 0);
  const earnedToday = todays.reduce((n, s) => n + pomodoroXp(s.duration_seconds ?? 0, 0), 0);

  const save = useCallback(
    async (seconds: number) => {
      if (seconds < DEFAULT_POMODORO_XP.minSeconds || !startedAt.current) return toast(t("focus.tooShort"), "info");
      const { error } = await sb.from("study_sessions").insert({ user_id: user.id, started_at: startedAt.current.toISOString(), ended_at: new Date().toISOString(), duration_seconds: seconds });
      if (error) return toast(t("focus.saveFailed", { reason: error.message }), "error");
      toast(t("focus.saved", { min: Math.floor(seconds / 60) }), "success");
      setLastXp(pomodoroXp(seconds, earnedToday));
      sessions.reload();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user.id, sb, earnedToday, t, toast],
  );

  const complete = useCallback(
    async (finished: TimerMode) => {
      setRunning(false);
      if (finished === "work") {
        await save(focusedSeconds(DURATION_MS.work, 0));
        setBlocks((b) => b + 1);
      }
      const next = nextMode(finished, finished === "work" ? blocks + 1 : blocks);
      setMode(next);
      setRemaining(DURATION_MS[next]);
      startedAt.current = null;
      toast(t("focus.notifyDone"), "info");
    },
    [blocks, save, t, toast],
  );

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const r = remainingMs(endAt.current, Date.now());
      setRemaining(r);
      if (r <= 0) void complete(mode);
    }, 250);
    return () => clearInterval(id);
  }, [running, mode, complete]);

  function start() {
    if (mode === "work" && !startedAt.current) startedAt.current = new Date();
    endAt.current = Date.now() + remaining;
    setRunning(true);
  }
  function pause() {
    setRemaining(remainingMs(endAt.current, Date.now()));
    setRunning(false);
  }
  function reset() {
    setRunning(false);
    setRemaining(DURATION_MS[mode]);
    startedAt.current = null;
  }
  async function finishEarly() {
    const secs = focusedSeconds(DURATION_MS.work, running ? remainingMs(endAt.current, Date.now()) : remaining);
    setRunning(false);
    await save(secs);
    setRemaining(DURATION_MS.work);
    startedAt.current = null;
  }
  function pick(m: TimerMode) {
    if (running) return;
    setMode(m);
    setRemaining(DURATION_MS[m]);
    startedAt.current = null;
  }

  const planned = DURATION_MS[mode];
  const pristine = remaining === planned;
  return (
    <View style={{ gap: 16 }}>
      <AppText muted>{t("focus.subtitle")}</AppText>
      <Card style={{ gap: 16 }}>
        <Segmented label={t("focus.title")} value={mode} onChange={pick} options={MODES.map((m) => ({ value: m, label: t(`focus.${m}`) }))} />
        <Ring value={planned - remaining} max={planned} label={`${t("focus.remaining")}: ${formatClock(remaining)}`}>
          <AppText variant="display" style={{ fontSize: 44, fontVariant: ["tabular-nums"] }}>
            {formatClock(remaining)}
          </AppText>
        </Ring>
        <View style={{ gap: 8 }}>
          {running ? <Button title={t("focus.pause")} onPress={pause} /> : <Button title={pristine ? t("focus.start") : t("focus.resume")} onPress={start} />}
          <Button title={t("focus.reset")} variant="secondary" onPress={reset} disabled={pristine && !running} />
          {mode === "work" && !pristine ? <Button title={t("focus.finishEarly")} variant="ghost" onPress={() => void finishEarly()} /> : null}
        </View>
        {lastXp !== null ? (
          <View style={{ gap: 6 }}>
            <Notice tone="success" text={t("focus.xp", { n: lastXp })} />
            <AppText variant="caption" muted>
              {t("focus.xpNote")}
            </AppText>
          </View>
        ) : null}
      </Card>
      <Card>
        <AppText variant="heading">{t("focus.today")}</AppText>
        <AppText variant="title">{t("dashboard.minutes", { n: number(Math.floor(todaySeconds / 60)) })}</AppText>
      </Card>
      <Card>
        <AppText variant="heading">{t("focus.sessions")}</AppText>
        {sessions.loading && !sessions.data ? (
          <Skeleton height={50} />
        ) : (sessions.data ?? []).length === 0 ? (
          <AppText muted>{t("focus.noSessions")}</AppText>
        ) : (
          (sessions.data ?? []).slice(0, 6).map((s) => (
            <View key={s.id} style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <AppText variant="caption">{dateTime(s.started_at)}</AppText>
              <AppText variant="caption" muted>
                {t("dashboard.minutes", { n: Math.floor((s.duration_seconds ?? 0) / 60) })}
              </AppText>
            </View>
          ))
        )}
      </Card>
    </View>
  );
}
