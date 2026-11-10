/**
 * Level curve (mirrored by SQL `public.level_from_xp`, migration 20260101004000; equality-tested in packages/db).
 *   XP needed to REACH level n = 25 * n * (n - 1)   ->  L1 = 0, L2 = 50, L3 = 150, L7 = 1050, L8 = 1400.
 * Each level costs 50 XP more than the previous one. Max level is 100 (no next level, progress is 1).
 */
export const MAX_LEVEL = 100;

export const xpForLevel = (level: number): number => 25 * level * (level - 1);

export interface LevelInfo {
  level: number;
  /** XP at which this level starts. */
  startXp: number;
  /** XP at which the next level starts; null at the max level. */
  nextXp: number | null;
  xpIntoLevel: number;
  /** 0 at the max level. */
  xpToNext: number;
  /** 0..1 progress inside the level; 1 at the max level. */
  progress: number;
}

export function levelFromXp(xp: number): LevelInfo {
  const x = Number.isFinite(xp) ? Math.max(0, Math.floor(xp)) : 0;
  let level = Math.min(MAX_LEVEL, Math.max(1, Math.floor((1 + Math.sqrt(1 + (4 * x) / 25)) / 2)));
  while (level > 1 && xpForLevel(level) > x) level--;
  while (level < MAX_LEVEL && xpForLevel(level + 1) <= x) level++;
  const startXp = xpForLevel(level);
  const nextXp = level >= MAX_LEVEL ? null : xpForLevel(level + 1);
  return {
    level,
    startXp,
    nextXp,
    xpIntoLevel: x - startXp,
    xpToNext: nextXp === null ? 0 : nextXp - x,
    progress: nextXp === null ? 1 : (x - startXp) / (nextXp - startXp),
  };
}
