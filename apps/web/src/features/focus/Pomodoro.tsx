"use client";

import { Button, Card, Input, ProgressRing, Skeleton, useToast } from "@unimate/ui";
import { DEFAULT_FOCUS_PREF, DEFAULT_POMODORO_XP, FOCUS_LIMITS, FOCUS_PRESETS, clampMinutes, focusPrefSchema, planDurationMs, planFor, pomodoroXp, type FocusPlan, type FocusPresetId } from "@unimate/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useUser } from "@/components/user";
import { useI18n } from "@unimate/i18n/react";
import type { MessageKey } from "@unimate/i18n";
import type { StudySessionRow } from "@/lib/db";
import { useLocalValue } from "@/lib/local-value";
import { getBrowserClient } from "@/lib/supabase/browser";
import { unwrap, useAsync } from "@/lib/use-async";
import { focusedSeconds, formatClock, nextMode, remainingMs, type TimerMode } from "./timer";

const MODES: TimerMode[] = ["work", "shortBreak", "longBreak"];
const PRESET_LABEL: Record<Exclude<FocusPresetId, "custom">, MessageKey> = { classic: "focus.presetClassic", deep: "focus.presetDeep", sprint: "focus.presetSprint" };
const CUSTOM_FIELDS: { key: keyof FocusPlan; label: MessageKey }[] = [
  { key: "workMin", label: "focus.customMin" },
  { key: "shortMin", label: "focus.customShort" },
  { key: "longMin", label: "focus.customLong" },
];

export function Pomodoro() {
  const { t, dateTime, number } = useI18n();
  const user = useUser();
  const { toast } = useToast();
  const [mode, setMode] = useState<TimerMode>("work");
  const [running, setRunning] = useState(false);
  const pref = useLocalValue(`um.focus.plan.${user.id}`, focusPrefSchema, DEFAULT_FOCUS_PREF);
  const plan = planFor(pref.value);
  const dur = (m: TimerMode) => planDurationMs(m, plan);
  const [remaining, setRemaining] = useState(dur("work"));
  // length of the block on screen: fixed when it is set up, so a plan change never alters a running or paused block
  const [planned, setPlanned] = useState(dur("work"));
  const [lastXp, setLastXp] = useState<number | null>(null);
  const [blocks, setBlocks] = useState(0);
  const endAt = useRef(0);
  const startedAt = useRef<Date | null>(null);

  // stored choice arrives after mount: adopt it while the timer is still untouched
  useEffect(() => {
    if (!pref.ready || running || remaining !== planned) return;
    setRemaining(dur(mode));
    setPlanned(dur(mode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pref.ready]);

  const sessions = useAsync<StudySessionRow[]>(async () => {
    const since = new Date();
    since.setDate(since.getDate() - 7);
    return unwrap(await getBrowserClient().from("study_sessions").select("id,started_at,ended_at,duration_seconds").gte("started_at", since.toISOString()).order("started_at", { ascending: false }).limit(30)) as StudySessionRow[];
  }, []);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todays = (sessions.data ?? []).filter((s) => new Date(s.started_at) >= todayStart);
  const todaySeconds = todays.reduce((n, s) => n + (s.duration_seconds ?? 0), 0);
  const earnedToday = todays.reduce((n, s) => n + pomodoroXp(s.duration_seconds ?? 0, 0), 0);

  const save = useCallback(
    async (seconds: number) => {
      if (seconds < DEFAULT_POMODORO_XP.minSeconds || !startedAt.current) return toast(t("focus.tooShort"), "info");
      const ended = new Date();
      const { error } = await getBrowserClient().from("study_sessions").insert({ user_id: user.id, started_at: startedAt.current.toISOString(), ended_at: ended.toISOString(), duration_seconds: seconds });
      if (error) return toast(t("focus.saveFailed", { reason: error.message }), "error");
      toast(t("focus.saved", { min: Math.floor(seconds / 60) }), "success");
      setLastXp(pomodoroXp(seconds, earnedToday));
      sessions.reload();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user.id, earnedToday, t, toast],
  );

  const complete = useCallback(
    async (finished: TimerMode) => {
      setRunning(false);
      if (finished === "work") {
        await save(focusedSeconds(planned, 0));
        setBlocks((b) => b + 1);
      }
      const next = nextMode(finished, finished === "work" ? blocks + 1 : blocks);
      setMode(next);
      setRemaining(dur(next));
      setPlanned(dur(next));
      startedAt.current = null;
      toast(t("focus.notifyDone"), "info");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blocks, planned, plan.workMin, plan.shortMin, plan.longMin, save, t, toast],
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
    setRemaining(dur(mode));
    setPlanned(dur(mode));
    startedAt.current = null;
  }
  async function finishEarly() {
    const secs = focusedSeconds(planned, running ? remainingMs(endAt.current, Date.now()) : remaining);
    setRunning(false);
    await save(secs);
    setRemaining(dur("work"));
    setPlanned(dur("work"));
    startedAt.current = null;
  }
  function pick(m: TimerMode) {
    if (running) return;
    setMode(m);
    setRemaining(dur(m));
    setPlanned(dur(m));
    startedAt.current = null;
  }
  /** Persist a new choice; an untouched idle timer follows it at once, otherwise it applies on the next reset or mode switch. */
  function choose(next: (p: typeof pref.value) => typeof pref.value) {
    if (!pref.update(next)) return;
    if (!running && remaining === planned) {
      const p = planFor(next(pref.value));
      const ms = planDurationMs(mode, p);
      setRemaining(ms);
      setPlanned(ms);
    }
  }
  const pristine = remaining === planned;
  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>{t("focus.title")}</h1>
        <p>{t("focus.subtitlePlan", { work: plan.workMin, brk: plan.shortMin })}</p>
      </div>
      <Card className="timer-card">
        <div className="seg__row" role="group" aria-label={t("focus.presets")}>
          {[...FOCUS_PRESETS.map((p) => p.id), "custom" as const].map((id) => (
            <button key={id} type="button" className="um-tab" aria-pressed={pref.value.preset === id} onClick={() => choose((v) => ({ ...v, preset: id }))}>
              {id === "custom" ? t("focus.custom") : t(PRESET_LABEL[id])}
            </button>
          ))}
        </div>
        {pref.value.preset === "custom" ? (
          <div className="grid-2" style={{ width: "100%", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 140px), 1fr))", textAlign: "start" }}>
            {CUSTOM_FIELDS.map(({ key, label }) => {
              const [lo, hi] = FOCUS_LIMITS[key];
              const val = pref.value.custom[key];
              return (
                <div key={`${key}-${val}`} style={{ minWidth: 0 }}>
                  <Input type="number" inputMode="numeric" min={lo} max={hi} label={t(label)} defaultValue={val} onBlur={(e) => choose((v) => ({ ...v, custom: { ...v.custom, [key]: clampMinutes(Number(e.target.value), [lo, hi]) } }))} />
                </div>
              );
            })}
          </div>
        ) : null}
        {(running || remaining !== planned) && planned !== dur(mode) ? <p className="um-hint">{t("focus.planNote")}</p> : null}
        <div className="seg__row" role="group" aria-label={t("focus.title")}>
          {MODES.map((m) => (
            <button key={m} type="button" className="um-tab" aria-pressed={mode === m} disabled={running} onClick={() => pick(m)}>
              {t(`focus.${m}`)}
            </button>
          ))}
        </div>
        <ProgressRing value={planned - remaining} max={planned} size={220} stroke={12} label={`${t("focus.remaining")}: ${formatClock(remaining)}`}>
          <span className="timer-time" aria-live="off">{formatClock(remaining)}</span>
        </ProgressRing>
        <div className="row" style={{ justifyContent: "center" }}>
          {running ? <Button onClick={pause}>{t("focus.pause")}</Button> : <Button onClick={start}>{pristine ? t("focus.start") : t("focus.resume")}</Button>}
          <Button variant="secondary" onClick={reset} disabled={pristine && !running}>{t("focus.reset")}</Button>
          {mode === "work" && !pristine ? <Button variant="ghost" onClick={() => void finishEarly()}>{t("focus.finishEarly")}</Button> : null}
        </div>
        {lastXp !== null ? (
          <div className="stack" role="status">
            <p className="ok-box">{t("focus.xp", { n: lastXp })}</p>
            <p className="um-hint">{t("focus.xpNote")}</p>
          </div>
        ) : null}
      </Card>

      <div className="grid-2">
        <Card>
          <h2>{t("focus.today")}</h2>
          <p className="stat" style={{ marginTop: "var(--space-2)" }}>{t("dashboard.minutes", { n: number(Math.floor(todaySeconds / 60)) })}</p>
        </Card>
        <Card>
          <h2>{t("focus.sessions")}</h2>
          {sessions.loading && !sessions.data ? <Skeleton height={60} /> : (sessions.data ?? []).length === 0 ? (
            <p className="um-muted" style={{ marginTop: "var(--space-2)" }}>{t("focus.noSessions")}</p>
          ) : (
            <ul className="list" style={{ marginTop: "var(--space-3)" }}>
              {(sessions.data ?? []).slice(0, 6).map((s) => (
                <li key={s.id} className="list-item">
                  <span>{dateTime(s.started_at)}</span>
                  <span className="um-muted">{t("dashboard.minutes", { n: Math.floor((s.duration_seconds ?? 0) / 60) })}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
