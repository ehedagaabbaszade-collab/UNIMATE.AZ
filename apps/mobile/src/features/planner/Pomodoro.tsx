import { DEFAULT_FOCUS_PLAN, DEFAULT_POMODORO_XP, FOCUS_LIMITS, FOCUS_PRESETS, clampMinutes, pomodoroXp, type FocusPlan } from "@unimate/core";
import type { MessageKey } from "@unimate/i18n";
import { zonedDayStart, zonedDayStartOffset } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import * as Notifications from "expo-notifications";
import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, ScrollView, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import FocusLock, { type FocusLockApp, type FocusLockStatus } from "../../../modules/focus-lock";
import { AppText, Button, Card, Dialog, ExpandCard, Input, Notice, Segmented, Skeleton, useToast } from "../../components/ui";
import { durationMs, parsePersisted, planFor, recover, type PersistedFocus, type PresetId } from "../../lib/focus-session";
import type { StudySessionRow } from "../../lib/db";
import { easings, haptic, useReducedMotion } from "../../lib/motion";
import { KEYS, kv } from "../../lib/storage";
import { focusedSeconds, formatClock, nextMode, remainingMs, type TimerMode } from "../../lib/timer";
import { unwrap, useAsync } from "../../lib/use-async";
import { useUser } from "../../state/session";
import { useTheme } from "../../theme/ThemeProvider";

const MODES: TimerMode[] = ["work", "shortBreak", "longBreak"];
const PRESET_LABEL: Record<string, MessageKey> = { classic: "focus.presetClassic", deep: "focus.presetDeep", sprint: "focus.presetSprint", custom: "focus.custom" };
const CUSTOM_FIELDS: { key: keyof FocusPlan; label: MessageKey }[] = [
  { key: "workMin", label: "focus.customMin" },
  { key: "shortMin", label: "focus.customShort" },
  { key: "longMin", label: "focus.customLong" },
];
const END_ID = "um-focus-end";
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function Ring({ progress, size = 236, stroke = 14, label, children }: { progress: number; size?: number; stroke?: number; label: string; children: React.ReactNode }) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = useRef(new Animated.Value(progress)).current;
  useEffect(() => {
    if (reduced) return v.setValue(progress);
    Animated.timing(v, { toValue: progress, duration: 300, easing: easings.out, useNativeDriver: false }).start();
  }, [progress, reduced, v]);
  const dash = v.interpolate({ inputRange: [0, 1], outputRange: [0.001, c] });
  return (
    <View accessible accessibilityRole="timer" accessibilityLabel={label} style={{ width: size, height: size, alignSelf: "center", alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={theme.cardStrong} strokeWidth={stroke} fill="none" />
        <AnimatedCircle cx={size / 2} cy={size / 2} r={r} stroke={theme.active} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={[dash as unknown as number, c]} />
      </Svg>
      {children}
    </View>
  );
}

async function scheduleEnd(at: number, title: string) {
  try {
    await Notifications.cancelScheduledNotificationAsync(END_ID).catch(() => undefined);
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) await Notifications.requestPermissionsAsync();
    if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("focus", { name: "Focus", importance: Notifications.AndroidImportance.HIGH }).catch(() => undefined);
    await Notifications.scheduleNotificationAsync({
      identifier: END_ID,
      content: { title },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at), ...(Platform.OS === "android" ? { channelId: "focus" } : {}) },
    });
  } catch {
    /* notification is best effort; the in-app timer still completes from the wall clock */
  }
}
const cancelEnd = () => void Notifications.cancelScheduledNotificationAsync(END_ID).catch(() => undefined);

/**
 * Pomodoro with presets, wall-clock timing (endAt), background end notification, session recovery after an app kill,
 * weekly stats and the optional strict focus lock (native app blocking; only shown active when the OS confirms it).
 * Finished focus blocks are saved to study_sessions; XP is an on-screen estimate, as on web.
 */
export function Pomodoro() {
  const { t, dateTime, number } = useI18n();
  const { user, supabase: sb } = useUser();
  const { toast } = useToast();
  const { theme } = useTheme();
  const [preset, setPreset] = useState<PresetId>("classic");
  const [custom, setCustom] = useState<FocusPlan>(DEFAULT_FOCUS_PLAN);
  const [mode, setMode] = useState<TimerMode>("work");
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(25 * 60_000);
  const [planned, setPlanned] = useState(25 * 60_000);
  const [blocks, setBlocks] = useState(0);
  const [lastXp, setLastXp] = useState<number | null>(null);
  const [lockWanted, setLockWanted] = useState(false);
  const [lockStatus, setLockStatus] = useState<FocusLockStatus | null>(null);
  const [lockActive, setLockActive] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [apps, setApps] = useState<FocusLockApp[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const endAt = useRef(0);
  const startedAt = useRef<Date | null>(null);
  const plan = planFor(preset, custom);

  const refreshLock = useCallback(async () => setLockStatus(await FocusLock.getStatus()), []);

  const sessions = useAsync<StudySessionRow[]>(async () => {
    const since = zonedDayStartOffset(new Date(), -6);
    return unwrap(await sb.from("study_sessions").select("id,started_at,ended_at,duration_seconds").gte("started_at", since.toISOString()).order("started_at", { ascending: false }).limit(60)) as StudySessionRow[];
  }, []);

  const todayStart = zonedDayStart(new Date());
  const todays = (sessions.data ?? []).filter((s) => new Date(s.started_at) >= todayStart);
  const todaySeconds = todays.reduce((n, s) => n + (s.duration_seconds ?? 0), 0);
  const weekSeconds = (sessions.data ?? []).reduce((n, s) => n + (s.duration_seconds ?? 0), 0);
  const earnedToday = todays.reduce((n, s) => n + pomodoroXp(s.duration_seconds ?? 0, 0), 0);
  const perDay = Array.from({ length: 7 }, (_, i) => {
    const d = zonedDayStartOffset(todayStart, i - 6);
    const next = zonedDayStartOffset(todayStart, i - 5);
    const sec = (sessions.data ?? []).filter((s) => new Date(s.started_at) >= d && new Date(s.started_at) < next).reduce((n, s) => n + (s.duration_seconds ?? 0), 0);
    return { key: d.toISOString(), sec };
  });
  const maxDay = Math.max(1, ...perDay.map((d) => d.sec));

  const save = useCallback(
    async (seconds: number) => {
      if (seconds < DEFAULT_POMODORO_XP.minSeconds || !startedAt.current) return toast(t("focus.tooShort"), "info");
      const { error } = await sb.from("study_sessions").insert({ user_id: user.id, started_at: startedAt.current.toISOString(), ended_at: new Date().toISOString(), duration_seconds: seconds });
      if (error) return toast(t("focus.saveFailed", { reason: error.message }), "error");
      toast(t("focus.saved", { min: Math.floor(seconds / 60) }), "success");
      haptic.success();
      setLastXp(pomodoroXp(seconds, earnedToday));
      sessions.reload();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user.id, sb, earnedToday, t, toast],
  );

  /** Apply (or clear) the native lock for the current mode. Sets lockActive only when the OS confirms blocking. */
  const applyLock = useCallback(
    async (m: TimerMode, end: number, wanted: boolean) => {
      if (!wanted || m !== "work") {
        await FocusLock.stopBlocking();
        setLockActive(false);
        return;
      }
      const ok = await FocusLock.startBlocking(end);
      setLockActive(ok);
      if (!ok) toast(t("focus.lockNotActive"), "error");
      void refreshLock();
    },
    [refreshLock, t, toast],
  );

  const goTo = useCallback(
    (m: TimerMode, p = plan) => {
      setMode(m);
      setRemaining(durationMs(m, p));
      setPlanned(durationMs(m, p));
      setRunning(false);
    },
    [plan],
  );

  const complete = useCallback(
    async (finished: TimerMode) => {
      setRunning(false);
      cancelEnd();
      await FocusLock.stopBlocking();
      setLockActive(false);
      if (finished === "work") {
        await save(Math.floor(planned / 1000));
        setBlocks((b) => b + 1);
      }
      const next = nextMode(finished, finished === "work" ? blocks + 1 : blocks);
      startedAt.current = null;
      goTo(next);
      haptic.success();
      toast(t(finished === "work" ? "focus.doneFocus" : "focus.doneBreak"), "info");
    },
    [blocks, goTo, planned, save, t, toast],
  );

  // tick from the wall clock
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const r = remainingMs(endAt.current, Date.now());
      setRemaining(r);
      if (r <= 0) void complete(mode);
    }, 250);
    return () => clearInterval(id);
  }, [running, mode, complete]);

  // recovery after app kill / background: restore, or finish if the block ended meanwhile
  useEffect(() => {
    void (async () => {
      const saved = parsePersisted(await kv.getItem(KEYS.focus).catch(() => null));
      void refreshLock();
      if (saved) {
        setPreset(saved.preset);
        setCustom(saved.custom);
        setBlocks(saved.blocks);
        setLockWanted(saved.lock);
        setMode(saved.mode);
        setPlanned(saved.plannedMs ?? durationMs(saved.mode, planFor(saved.preset, saved.custom)));
        if (saved.startedAt) startedAt.current = new Date(saved.startedAt);
        const rec = recover(saved, Date.now());
        if (rec.kind === "running") {
          endAt.current = saved.endAt as number;
          setRemaining(rec.remainingMs);
          setRunning(true);
          toast(t("focus.recovered"), "info");
          const st = await FocusLock.getStatus();
          setLockActive(st.blocking && saved.mode === "work");
        } else if (rec.kind === "paused") setRemaining(rec.remainingMs);
        else {
          endAt.current = Date.now();
          setRemaining(0);
          setRunning(true);
        }
      } else {
        setRemaining(durationMs("work", DEFAULT_FOCUS_PLAN));
        setPlanned(durationMs("work", DEFAULT_FOCUS_PLAN));
      }
      setHydrated(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // persist on structural changes (not every tick: the wall-clock endAt is enough to rebuild the timer)
  useEffect(() => {
    if (!hydrated) return;
    const s: PersistedFocus = { v: 1, preset, custom, mode, endAt: running ? endAt.current : null, remainingMs: remaining, plannedMs: planned, startedAt: startedAt.current?.toISOString() ?? null, blocks, lock: lockWanted };
    void kv.setItem(KEYS.focus, JSON.stringify(s)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, preset, custom, mode, running, blocks, lockWanted]);

  async function start() {
    if (mode === "work" && !startedAt.current) startedAt.current = new Date();
    endAt.current = Date.now() + remaining;
    setRunning(true);
    haptic.medium();
    void scheduleEnd(endAt.current, t(mode === "work" ? "focus.doneFocus" : "focus.doneBreak"));
    await applyLock(mode, endAt.current, lockWanted);
  }
  function pause() {
    setRemaining(remainingMs(endAt.current, Date.now()));
    setRunning(false);
    cancelEnd();
    void applyLock(mode, 0, false);
    haptic.tap();
  }
  function reset() {
    setRunning(false);
    cancelEnd();
    void applyLock(mode, 0, false);
    startedAt.current = null;
    setRemaining(durationMs(mode, plan));
    setPlanned(durationMs(mode, plan));
  }
  async function finishEarly() {
    setConfirmEnd(false);
    const secs = focusedSeconds(planned, running ? remainingMs(endAt.current, Date.now()) : remaining);
    setRunning(false);
    cancelEnd();
    await applyLock("work", 0, false);
    await save(secs);
    startedAt.current = null;
    setRemaining(durationMs("work", plan));
    setPlanned(durationMs("work", plan));
  }
  async function emergencyExit() {
    haptic.warning();
    await FocusLock.stopBlocking();
    setLockActive(false);
    setLockWanted(false);
    toast(t("focus.emergencyDone"), "info");
    void refreshLock();
  }
  function pickMode(m: TimerMode) {
    if (running) return;
    startedAt.current = null;
    goTo(m);
  }
  /** A preset/custom change is stored at once; an untouched idle timer follows it, otherwise it applies on the next reset or mode switch. */
  function pickPreset(p: PresetId) {
    setPreset(p);
    if (running || remaining !== planned) return;
    startedAt.current = null;
    setMode("work");
    const ms = durationMs("work", planFor(p, custom));
    setRemaining(ms);
    setPlanned(ms);
  }
  function setCustomPart(part: keyof FocusPlan, raw: string) {
    const n = clampMinutes(Number(raw.replace(/\D/g, "")) || 1, FOCUS_LIMITS[part]);
    const next = { ...custom, [part]: n };
    setCustom(next);
    if (preset === "custom" && !running && remaining === planned) {
      const ms = durationMs(mode, next);
      setRemaining(ms);
      setPlanned(ms);
    }
  }

  async function enableLock() {
    setLockWanted(true);
    const st = await FocusLock.getStatus();
    setLockStatus(st);
    if (st.supported && !st.authorized) {
      const ok = await FocusLock.requestAuthorization();
      void refreshLock();
      if (!ok) toast(t("focus.lockNeedsPermission"), "error");
    }
  }
  async function toggleLock() {
    if (!lockWanted) return enableLock();
    setLockWanted(false);
    await FocusLock.stopBlocking();
    setLockActive(false);
  }
  async function pickApps() {
    if (Platform.OS === "ios") {
      await FocusLock.pickApps();
      void refreshLock();
      return;
    }
    setApps(await FocusLock.listApps());
  }
  async function saveApps() {
    await FocusLock.setBlockedApps(chosen);
    setApps(null);
    void refreshLock();
  }

  const pristine = remaining === planned;
  const presetLabel = (id: PresetId) => t(PRESET_LABEL[id] as MessageKey);
  const lockProblem = lockWanted && !lockActive ? (!lockStatus?.supported ? t("focus.lockNeedsBuild") : !lockStatus.authorized ? t("focus.lockNeedsPermission") : null) : null;
  const presetIds: PresetId[] = [...FOCUS_PRESETS.map((p) => p.id), "custom"];

  return (
    <View style={{ gap: 16 }}>
      <AppText muted>{t("focus.subtitlePlan", { work: plan.workMin, brk: plan.shortMin })}</AppText>
      <Card style={{ gap: 16 }}>
        <AppText variant="label" muted>
          {t("focus.presets")}
        </AppText>
        <Segmented label={t("focus.presets")} value={preset} onChange={pickPreset} options={presetIds.map((id) => ({ value: id, label: presetLabel(id) }))} />
        {preset === "custom" ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {CUSTOM_FIELDS.map(({ key, label }) => (
              <View key={key} style={{ flexGrow: 1, flexBasis: 96, minWidth: 0 }}>
                <Input label={t(label)} keyboardType="number-pad" value={String(custom[key])} onChangeText={(v) => setCustomPart(key, v)} />
              </View>
            ))}
          </View>
        ) : null}
        {(running || remaining !== planned) && planned !== durationMs(mode, plan) ? (
          <AppText variant="caption" muted>
            {t("focus.planNote")}
          </AppText>
        ) : null}
        <Segmented label={t("focus.title")} value={mode} onChange={pickMode} options={MODES.map((m) => ({ value: m, label: t(`focus.${m}`) }))} />
        <Ring progress={planned > 0 ? (planned - remaining) / planned : 0} label={`${t("focus.remaining")}: ${formatClock(remaining)}`}>
          <AppText variant="display" style={{ fontSize: 48, fontVariant: ["tabular-nums"] }}>
            {formatClock(remaining)}
          </AppText>
          <AppText variant="caption" muted>
            {lockActive ? t("focus.lockOn") : t(`focus.${mode}`)}
          </AppText>
        </Ring>
        <View style={{ gap: 8 }}>
          {running ? <Button title={t("focus.pause")} onPress={pause} /> : <Button title={pristine ? t("focus.start") : t("focus.resume")} onPress={() => void start()} />}
          <Button title={t("focus.reset")} variant="secondary" onPress={reset} disabled={pristine && !running} />
          {mode === "work" && !pristine ? <Button title={t("focus.finishEarly")} variant="ghost" onPress={() => (running ? setConfirmEnd(true) : void finishEarly())} /> : null}
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
        <AppText variant="heading">{t("focus.lockTitle")}</AppText>
        <AppText variant="caption" muted>
          {t("focus.lockHint")}
        </AppText>
        <Button title={t("focus.lockToggle") + (lockWanted ? " ✓" : "")} variant={lockWanted ? "primary" : "secondary"} onPress={() => void toggleLock()} disabled={running} />
        {lockWanted ? (
          <>
            <Button title={t("focus.lockPick")} variant="secondary" onPress={() => void pickApps()} disabled={running || !lockStatus?.supported} />
            {lockStatus?.supported ? (
              <AppText variant="caption" muted>
                {t("focus.lockApps", { n: lockStatus.blockedCount })}
              </AppText>
            ) : null}
            {lockProblem ? <Notice tone="warning" text={lockProblem} /> : null}
            {lockStatus?.supported && !lockStatus.authorized ? <Button title={t("focus.lockGrant")} variant="secondary" onPress={() => void enableLock()} /> : null}
          </>
        ) : null}
        {lockActive || lockStatus?.blocking ? <Button title={t("focus.emergency")} variant="danger" onPress={() => void emergencyExit()} /> : null}
      </Card>

      <Card>
        <AppText variant="heading">{t("focus.today")}</AppText>
        <AppText variant="title">{t("dashboard.minutes", { n: number(Math.floor(todaySeconds / 60)) })}</AppText>
        <AppText variant="caption" muted>
          {t("focus.week")}: {t("dashboard.minutes", { n: number(Math.floor(weekSeconds / 60)) })}
        </AppText>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, height: 64, marginTop: 8 }}>
          {perDay.map((d) => (
            <View key={d.key} style={{ flex: 1, height: Math.max(4, (d.sec / maxDay) * 64), borderRadius: 6, backgroundColor: d.sec > 0 ? theme.active : theme.cardStrong }} />
          ))}
        </View>
      </Card>
      <ExpandCard label={t("focus.sessions")} header={<AppText variant="heading">{t("focus.sessions")}</AppText>}>
        {sessions.loading && !sessions.data ? (
          <Skeleton height={50} />
        ) : (sessions.data ?? []).length === 0 ? (
          <AppText muted>{t("focus.noSessions")}</AppText>
        ) : (
          (sessions.data ?? []).slice(0, 12).map((s) => (
            <View key={s.id} style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <AppText variant="caption">{dateTime(s.started_at)}</AppText>
              <AppText variant="caption" muted>
                {t("dashboard.minutes", { n: Math.floor((s.duration_seconds ?? 0) / 60) })}
              </AppText>
            </View>
          ))
        )}
      </ExpandCard>

      <Dialog
        open={confirmEnd}
        title={t("focus.endTitle")}
        onClose={() => setConfirmEnd(false)}
        actions={
          <>
            <Button title={t("focus.endYes")} variant="danger" onPress={() => void finishEarly()} />
            <Button title={t("focus.keepGoing")} variant="secondary" onPress={() => setConfirmEnd(false)} />
            {lockActive ? (
              <Button
                title={t("focus.emergency")}
                variant="ghost"
                onPress={() => {
                  setConfirmEnd(false);
                  void emergencyExit();
                }}
              />
            ) : null}
          </>
        }
      >
        <AppText>{t("focus.endBody")}</AppText>
      </Dialog>

      <Dialog
        open={apps !== null}
        title={t("focus.lockPick")}
        onClose={() => setApps(null)}
        actions={
          <>
            <Button title={t("common.save")} onPress={() => void saveApps()} />
            <Button title={t("focus.keepGoing")} variant="secondary" onPress={() => setApps(null)} />
          </>
        }
      >
        <ScrollView style={{ maxHeight: 320 }}>
          {(apps ?? []).map((a) => {
            const on = chosen.includes(a.id);
            return (
              <Pressable
                key={a.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => {
                  haptic.select();
                  setChosen((c) => (on ? c.filter((x) => x !== a.id) : [...c, a.id]));
                }}
                style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10 }}
              >
                <AppText>{on ? "☑" : "☐"}</AppText>
                <AppText style={{ flex: 1 }}>{a.label}</AppText>
              </Pressable>
            );
          })}
        </ScrollView>
      </Dialog>
    </View>
  );
}
