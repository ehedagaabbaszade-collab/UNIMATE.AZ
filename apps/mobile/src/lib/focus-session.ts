import { DURATION_MS, type TimerMode } from "./timer";

/** Focus/break presets in minutes. `custom` is user-defined. */
export const PRESETS = [
  { id: "25-5", work: 25, brk: 5 },
  { id: "45-10", work: 45, brk: 10 },
  { id: "60-10", work: 60, brk: 10 },
  { id: "90-15", work: 90, brk: 15 },
] as const;
export type PresetId = (typeof PRESETS)[number]["id"] | "custom";

export const clampMinutes = (n: number, lo = 1, hi = 240): number => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : lo);

export interface FocusPlan {
  workMin: number;
  breakMin: number;
}
export const planFor = (id: PresetId, custom: FocusPlan): FocusPlan => {
  const p = PRESETS.find((x) => x.id === id);
  return p ? { workMin: p.work, breakMin: p.brk } : { workMin: clampMinutes(custom.workMin), breakMin: clampMinutes(custom.breakMin, 1, 60) };
};
export const durationMs = (mode: TimerMode, plan: FocusPlan): number =>
  mode === "work" ? plan.workMin * 60_000 : mode === "shortBreak" ? plan.breakMin * 60_000 : Math.max(plan.breakMin * 3, 15) * 60_000;

/** What survives an app kill: enough to rebuild the timer from the wall clock. */
export interface PersistedFocus {
  v: 1;
  preset: PresetId;
  custom: FocusPlan;
  mode: TimerMode;
  /** epoch ms the running block ends; null when paused/idle */
  endAt: number | null;
  /** ms left when paused/idle */
  remainingMs: number;
  /** ISO start of the current focus block, for saving the session */
  startedAt: string | null;
  blocks: number;
  lock: boolean;
}

const MODES: readonly TimerMode[] = ["work", "shortBreak", "longBreak"];
export function parsePersisted(raw: string | null): PersistedFocus | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<PersistedFocus>;
    if (o.v !== 1 || !MODES.includes(o.mode as TimerMode)) return null;
    const preset = o.preset === "custom" || PRESETS.some((p) => p.id === o.preset) ? (o.preset as PresetId) : "25-5";
    const num = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? x : d);
    return {
      v: 1,
      preset,
      custom: { workMin: clampMinutes(num(o.custom?.workMin, 25)), breakMin: clampMinutes(num(o.custom?.breakMin, 5), 1, 60) },
      mode: o.mode as TimerMode,
      endAt: o.endAt === null || o.endAt === undefined ? null : num(o.endAt, 0) || null,
      remainingMs: Math.max(0, num(o.remainingMs, DURATION_MS.work)),
      startedAt: typeof o.startedAt === "string" ? o.startedAt : null,
      blocks: Math.max(0, Math.floor(num(o.blocks, 0))),
      lock: o.lock === true,
    };
  } catch {
    return null;
  }
}

export type Recovery = { kind: "running"; remainingMs: number } | { kind: "expired" } | { kind: "paused"; remainingMs: number };
export function recover(s: PersistedFocus, now: number): Recovery {
  if (s.endAt === null) return { kind: "paused", remainingMs: s.remainingMs };
  return s.endAt > now ? { kind: "running", remainingMs: s.endAt - now } : { kind: "expired" };
}
