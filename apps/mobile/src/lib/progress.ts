/**
 * Home "progress" numbers. Only values the backend really has are produced:
 *   - XP = sum of xp_events.points (server-written, owner-readable)
 *   - streak = streaks.current_streak / longest_streak
 * There is NO server field for level, achievements or an overall percentage, so none is computed here:
 * the UI hides those rows instead of inventing them.
 */
export interface StreakRow {
  current_streak: number;
  longest_streak: number;
  last_active_date: string | null;
}

export interface ProgressSummary {
  xp: number | null;
  streak: StreakRow | null;
}

const PAGE = 1000;
const MAX_PAGES = 50;

/** Sums points across pages (PostgREST caps a response at 1000 rows). `fetchPage(from, to)` returns that range's points. */
export async function sumPoints(fetchPage: (from: number, to: number) => Promise<number[]>): Promise<number> {
  let total = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = await fetchPage(page * PAGE, page * PAGE + PAGE - 1);
    for (const p of rows) if (Number.isFinite(p)) total += p;
    if (rows.length < PAGE) break;
  }
  return total;
}

/** A streak is shown only while it can still be alive: last activity today or yesterday (Asia/Baku day strings, YYYY-MM-DD). */
export function liveStreak(row: StreakRow | null, today: string): number | null {
  if (!row || !row.last_active_date || row.current_streak <= 0) return null;
  const last = Date.parse(`${row.last_active_date}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(last) || Number.isNaN(now)) return null;
  const days = Math.round((now - last) / 86_400_000);
  return days === 0 || days === 1 ? row.current_streak : null;
}

export function parseStreak(raw: unknown): StreakRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.current_streak !== "number" || typeof r.longest_streak !== "number") return null;
  return { current_streak: r.current_streak, longest_streak: r.longest_streak, last_active_date: typeof r.last_active_date === "string" ? r.last_active_date : null };
}

/** Whether the progress card has anything real to show. */
export const hasProgress = (p: ProgressSummary, today: string): boolean => (p.xp ?? 0) > 0 || liveStreak(p.streak, today) !== null || (p.streak?.longest_streak ?? 0) > 0;
